/** 検索の条件をClickHouseのWHERE句にする。値はすべてパラメータで渡す。 */
import type { SearchField, SearchRequest } from '@mds/contracts';

export interface SearchCondition {
  where: string;
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

function fieldCondition(field: SearchField, terms: string[], parameters: Record<string, unknown>): string {
  terms.forEach((term, index) => {
    parameters[`term${index}`] = term;
    parameters[`termLike${index}`] = `%${escapeLikePattern(term)}%`;
  });
  const allTermsIn = (column: 'title' | 'channel_name') =>
    terms.map((term, index) => termMatch(column, term, index)).join(' AND ');
  parameters.exactId = terms.join(' ');
  const idMatch = '(external_id = {exactId:String} OR row_key = {exactId:String})';
  switch (field) {
    case 'title':
      return `(${allTermsIn('title')})`;
    case 'channel':
      return `(${allTermsIn('channel_name')})`;
    case 'id':
      return idMatch;
    case 'all':
      return `((${allTermsIn('title')}) OR (${allTermsIn('channel_name')}) OR ${idMatch})`;
  }
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
  if (terms.length > 0) conditions.push(fieldCondition(request.field, terms, parameters));
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
  return { where: conditions.length > 0 ? conditions.join(' AND ') : '1', parameters };
}
