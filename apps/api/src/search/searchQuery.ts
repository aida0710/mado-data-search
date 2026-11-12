/** 検索の条件をClickHouseのWHERE句にする。値はすべてパラメータで渡す。 */
import type { SearchField, SearchRequest } from '@mds/contracts';
import type { AttributeDefinition } from '../sources/sourceConfig.js';
import { attributeFilterConditions } from './attributeFilterConditions.js';
import { conditionFieldsByName } from './conditionFields.js';
import { branchConditions } from './conditionTree.js';
import { InvalidConditionError, type LeafCondition } from './leafCondition.js';
import { peerCondition } from './peerCondition.js';

/** 結果を取る条件の1つ。 */
export interface SearchAlternative {
  where: string;
  /**
   * whereに当たる行をすべて含み、索引だけで決まる条件。上位の行の境目を速く求めるのに使う。
   * IDの条件は当たる行が少なく、境目が要らないのでnull。
   */
  boundaryWhere: string | null;
}

export interface SearchCondition {
  /**
   * どれかに当たる行が結果になる。同じ行が2つに当たることがある。
   * ORで1つにつなぐと、索引の種類が違う条件が混ざってClickHouseが索引を使えず全行を読むので、分けて返す。
   */
  alternatives: SearchAlternative[];
  /** 件数を数える条件。互いに重ならないので、条件ごとの件数を足せる。 */
  countAlternatives: string[];
  /** 件数の条件が索引だけで決まり、語が続けて現れない行も数えているとき。 */
  countIsUpperBound: boolean;
  parameters: Record<string, unknown>;
}

/** 条件を組むのに要る、取り込み元の情報。サービスの絞り込みはパーティション（取り込み元）で効かせる。 */
export interface SourceOfService {
  id: string;
  service: string;
  identity: string;
}

/** 1回の検索で読む条件の数の上限。条件ごとにSELECTが1つ走る。 */
const MAXIMUM_SEARCH_ALTERNATIVES = 24;

/** 検索語を空白で分ける。全部の語を含む行を探す。 */
export function splitTerms(query: string): string[] {
  return query.split(/\s+/u).filter((term) => term.length > 0);
}

/** LIKEの中で特別な意味を持つ文字を、ただの文字として扱う。 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** 索引は2文字ごとに切っているので、1文字の語は索引で絞れず、ILIKEだけで探す。 */
const TEXT_INDEX_GRAM_CHARACTERS = 2;

type TextColumn = 'title' | 'channel_name';
/**
 * exact: 語が続けて現れる行だけ。
 * indexOnly: 索引だけで決める。列を読まないので速いが、3文字以上の語では余分な行も通す。
 */
type TermMatching = 'exact' | 'indexOnly';

/** 3文字以上の語は2文字の組に分かれるので、索引だけでは語が続けて現れるかが分からない。 */
function isSplitIntoSeveralGrams(term: string): boolean {
  return [...term].length > TEXT_INDEX_GRAM_CHARACTERS;
}

/**
 * hasAllTokensは索引で候補を絞るが、2文字の組を全部含むだけの行も通す（musicにはmusci icも当たる）。
 * exactではILIKEで語が続けて現れる行に絞る。2文字の語は索引の1つの組そのものなので、ILIKEは要らない。
 */
function termMatch(column: TextColumn, term: string, index: number, matching: TermMatching): string {
  const like = `${column} ILIKE {termLike${index}:String}`;
  if ([...term].length < TEXT_INDEX_GRAM_CHARACTERS) return like;
  const indexed = `hasAllTokens(${column}, {term${index}:String})`;
  if (matching === 'indexOnly' || !isSplitIntoSeveralGrams(term)) return indexed;
  return `${indexed} AND ${like}`;
}

/** key_number（UInt64）に収まる数字だけの語。 */
function isKeyNumber(text: string): boolean {
  return /^\d{1,20}$/.test(text) && BigInt(text) <= 18446744073709551615n;
}

/**
 * IDの検索。外部のIDは索引で、行のキーは数字のときだけ主キーで引く。
 * 文字のキーの表はrow_keyに索引が無いので、外部のIDで探す。
 */
function idAlternatives(exactId: string, parameters: Record<string, unknown>): string[] {
  parameters.exactId = exactId;
  if (!isKeyNumber(exactId)) return ['external_id = {exactId:String}'];
  parameters.exactKeyNumber = exactId;
  return ['external_id = {exactId:String}', 'key_number = {exactKeyNumber:UInt64}'];
}

function allTermsIn(column: TextColumn, terms: string[], matching: TermMatching): string {
  return terms.map((term, index) => termMatch(column, term, index, matching)).join(' AND ');
}

function textColumnsOf(field: SearchField): TextColumn[] {
  switch (field) {
    case 'title':
      return ['title'];
    case 'channel':
      return ['channel_name'];
    case 'id':
      return [];
    case 'all':
      return ['title', 'channel_name'];
  }
}

function searchesId(field: SearchField): boolean {
  return field === 'id' || field === 'all';
}

/** 前の条件に当たった行を後ろの条件から外す。件数を足すだけで数えられる。 */
function withoutOverlap(termConditions: string[]): string[] {
  return termConditions.map((termCondition, index) =>
    [`(${termCondition})`, ...termConditions.slice(0, index).map((earlier) => `NOT (${earlier})`)].join(' AND '),
  );
}

interface TermAlternatives {
  alternatives: SearchAlternative[];
  countAlternatives: string[];
  countIsUpperBound: boolean;
}

function termAlternativesOf(field: SearchField, terms: string[], parameters: Record<string, unknown>): TermAlternatives {
  terms.forEach((term, index) => {
    parameters[`term${index}`] = term;
    parameters[`termLike${index}`] = `%${escapeLikePattern(term)}%`;
  });
  const textColumns = textColumnsOf(field);
  const ids = searchesId(field) ? idAlternatives(terms.join(' '), parameters) : [];
  // 索引だけの条件は列を読まないので、ORでつないでも全行を読まない。1つにまとめて、題名とチャンネル名の両方に当たる行を1回だけ数える。
  const countOfTextColumns = textColumns.map((column) => `(${allTermsIn(column, terms, 'indexOnly')})`).join(' OR ');
  return {
    alternatives: [
      ...textColumns.map((column) => ({
        where: allTermsIn(column, terms, 'exact'),
        boundaryWhere: allTermsIn(column, terms, 'indexOnly'),
      })),
      ...ids.map((where) => ({ where, boundaryWhere: null })),
    ],
    countAlternatives: withoutOverlap([...(countOfTextColumns ? [countOfTextColumns] : []), ...ids]),
    countIsUpperBound: textColumns.length > 0 && terms.some(isSplitIntoSeveralGrams),
  };
}

function membershipCondition(column: string, parameterName: string, values: string[], parameters: Record<string, unknown>): string[] {
  parameters[parameterName] = values;
  return [`${column} IN {${parameterName}:Array(String)}`];
}

/** サービスはパーティション（取り込み元）で絞る。service列で絞ると、全部のパーティションの索引を読んでしまう。 */
function serviceCondition(services: string[], sources: SourceOfService[], parameters: Record<string, unknown>): string[] {
  if (services.length === 0) return [];
  const sourceIds = sources.filter((source) => services.includes(source.service)).map((source) => source.id);
  return membershipCondition('source', 'sourcesOfServices', sourceIds, parameters);
}

/** 条件を組み立てるのに要る、設定の中身。 */
export interface SearchCatalog {
  sources: SourceOfService[];
  attributes: AttributeDefinition[];
  /** sourceごとの行数の見積もり。突き合わせで、メモリに載せる側を小さくするのに使う。 */
  sourceRows?: ReadonlyMap<string, number>;
}

/** 何も絞らない枝。ANDとORの条件が無いときに、枝が1つあるものとして扱う。 */
const UNCONDITIONAL_BRANCH: LeafCondition = { exact: '', indexOnly: '', isIndexOnlyBroader: false };

function joinWithAnd(conditions: (string | null)[]): string {
  const present = conditions.filter((condition): condition is string => Boolean(condition));
  return present.length > 0 ? present.join(' AND ') : '1';
}

/** 絞り込みの欄（サービス、種類、言語、項目の選択肢、公開日）の条件。 */
function filterConditions(request: SearchRequest, catalog: SearchCatalog, parameters: Record<string, unknown>): string[] {
  const filters: string[] = [];
  filters.push(...serviceCondition(request.services, catalog.sources, parameters));
  if (request.kinds.length > 0) filters.push(...membershipCondition('kind', 'kinds', request.kinds, parameters));
  if (request.languages.length > 0) filters.push(...membershipCondition('language', 'languages', request.languages, parameters));
  const fieldByName = conditionFieldsByName(catalog.attributes);
  filters.push(...attributeFilterConditions({ filters: request.attributeFilters, fieldByName, parameters, parameterPrefix: 'attribute' }));
  if (request.peer) {
    filters.push(
      peerCondition(request.peer, {
        sources: catalog.sources,
        selectedServices: request.services,
        fieldByName,
        sourceRows: catalog.sourceRows ?? new Map(),
        parameters,
      }),
    );
  }
  if (request.publishedFrom) {
    parameters.publishedFrom = `${request.publishedFrom} 00:00:00`;
    filters.push('published_at >= {publishedFrom:DateTime}');
  }
  if (request.publishedTo) {
    parameters.publishedTo = `${request.publishedTo} 23:59:59`;
    filters.push('published_at <= {publishedTo:DateTime}');
  }
  return filters;
}

/**
 * 検索語、ANDとORの条件、絞り込みの欄を合わせる。
 * 検索語の探し方（題名・チャンネル名・ID）とORの枝は、組み合わせごとに別の条件にする。
 */
export function buildSearchCondition(request: SearchRequest, catalog: SearchCatalog): SearchCondition {
  const parameters: Record<string, unknown> = {};
  const filters = filterConditions(request, catalog, parameters);
  const terms = splitTerms(request.query);
  const branches = request.condition
    ? branchConditions(request.condition, {
        fieldByName: conditionFieldsByName(catalog.attributes),
        sourceIdsOfService: (service) => catalog.sources.filter((source) => source.service === service).map((source) => source.id),
        parameters,
      })
    : [UNCONDITIONAL_BRANCH];
  const termAlternatives: TermAlternatives =
    terms.length > 0
      ? termAlternativesOf(request.field, terms, parameters)
      : { alternatives: [{ where: '', boundaryWhere: '' }], countAlternatives: [''], countIsUpperBound: false };
  if (termAlternatives.alternatives.length * branches.length > MAXIMUM_SEARCH_ALTERNATIVES) {
    throw new InvalidConditionError(`検索語とORの組み合わせが多すぎます（${MAXIMUM_SEARCH_ALTERNATIVES}まで）`);
  }
  const wrapped = (condition: string) => (condition ? `(${condition})` : '');
  const alternatives = termAlternatives.alternatives.flatMap(({ where, boundaryWhere }) =>
    branches.map((branch) => ({
      where: joinWithAnd([wrapped(where), wrapped(branch.exact), ...filters]),
      boundaryWhere: boundaryWhere === null ? null : joinWithAnd([wrapped(boundaryWhere), wrapped(branch.indexOnly), ...filters]),
    })),
  );
  // 件数は索引だけの条件で数える。ORの枝は重なることがあるので、足さずに1つの条件にまとめて数える。
  const branchesForCount = branches.length === 1 ? wrapped(branches[0]?.indexOnly ?? '') : `(${branches.map((branch) => `(${branch.indexOnly})`).join(' OR ')})`;
  return {
    alternatives,
    countAlternatives: termAlternatives.countAlternatives.map((termCondition) => joinWithAnd([termCondition, branchesForCount, ...filters])),
    countIsUpperBound: termAlternatives.countIsUpperBound || branches.some((branch) => branch.isIndexOnlyBroader),
    parameters,
  };
}
