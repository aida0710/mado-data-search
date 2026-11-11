/** 検索の条件をClickHouseのWHERE句にする。値はすべてパラメータで渡す。 */
import type { SearchField, SearchRequest } from '@mds/contracts';

export interface SearchCondition {
  /**
   * それぞれが1つのWHERE句で、どれかに当たる行が結果になる。同じ行が2つに当たることは無い。
   * ORで1つにつなぐと、索引の種類が違う条件が混ざってClickHouseが索引を使えず全行を読むので、分けて返す。
   */
  alternatives: string[];
  parameters: Record<string, unknown>;
}

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

/**
 * hasAllTokensは索引で候補を絞るが、2文字の組を全部含むだけの行も通す（musicにはmusci icも当たる）。
 * ILIKEで語が続けて現れる行に絞る。
 */
function termMatch(column: 'title' | 'channel_name', term: string, index: number): string {
  const like = `${column} ILIKE {termLike${index}:String}`;
  if ([...term].length < TEXT_INDEX_GRAM_CHARACTERS) return like;
  return `hasAllTokens(${column}, {term${index}:String}) AND ${like}`;
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

function fieldAlternatives(field: SearchField, terms: string[], parameters: Record<string, unknown>): string[] {
  terms.forEach((term, index) => {
    parameters[`term${index}`] = term;
    parameters[`termLike${index}`] = `%${escapeLikePattern(term)}%`;
  });
  const allTermsIn = (column: 'title' | 'channel_name') =>
    terms.map((term, index) => termMatch(column, term, index)).join(' AND ');
  const exactId = terms.join(' ');
  switch (field) {
    case 'title':
      return [allTermsIn('title')];
    case 'channel':
      return [allTermsIn('channel_name')];
    case 'id':
      return idAlternatives(exactId, parameters);
    case 'all':
      return [allTermsIn('title'), allTermsIn('channel_name'), ...idAlternatives(exactId, parameters)];
  }
}

/** 前の条件に当たった行を後ろの条件から外す。件数を足すだけで数えられ、結果にも同じ行が2回出ない。 */
function withoutOverlap(termConditions: string[]): string[] {
  return termConditions.map((termCondition, index) =>
    [`(${termCondition})`, ...termConditions.slice(0, index).map((earlier) => `NOT (${earlier})`)].join(' AND '),
  );
}

function membershipCondition(column: string, parameterName: string, values: string[], parameters: Record<string, unknown>): string[] {
  if (values.length === 0) return [];
  parameters[parameterName] = values;
  return [`${column} IN {${parameterName}:Array(String)}`];
}

export function buildSearchCondition(request: SearchRequest): SearchCondition {
  const parameters: Record<string, unknown> = {};
  const conditions: string[] = [];
  const terms = splitTerms(request.query);
  const termAlternatives = terms.length > 0 ? fieldAlternatives(request.field, terms, parameters) : [];
  conditions.push(...membershipCondition('service', 'services', request.services, parameters));
  conditions.push(...membershipCondition('kind', 'kinds', request.kinds, parameters));
  conditions.push(...membershipCondition('language', 'languages', request.languages, parameters));
  if (request.publishedFrom) {
    parameters.publishedFrom = `${request.publishedFrom} 00:00:00`;
    conditions.push('published_at >= {publishedFrom:DateTime}');
  }
  if (request.publishedTo) {
    parameters.publishedTo = `${request.publishedTo} 23:59:59`;
    conditions.push('published_at <= {publishedTo:DateTime}');
  }
  if (termAlternatives.length === 0) {
    return { alternatives: [conditions.length > 0 ? conditions.join(' AND ') : '1'], parameters };
  }
  return {
    alternatives: withoutOverlap(termAlternatives).map((termCondition) => [termCondition, ...conditions].join(' AND ')),
    parameters,
  };
}
