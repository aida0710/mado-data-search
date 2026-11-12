/** 検索でClickHouseへ流すSQL文を作る。上位の行を、当たった行すべてを並べずに取り出す。 */
import type { SearchRequest } from '@mds/contracts';
import type { SearchAlternative } from './searchQuery.js';

const ENTRY_KEY = 'source, key_number, row_key';
const ENTRY_RESULT_COLUMNS = `${ENTRY_KEY}, service, kind, external_id, title, channel_name, language,
  duration_seconds, published_at, url, ingested_at`;

/**
 * 境目は索引だけの条件で求めるので、語が続けて現れない行や、まだマージされていない古い版も数に入る。
 * その分だけ、返す行の数より深いところに境目を置く。
 */
export const BOUNDARY_ROWS_PER_RESULT_ROW = 20;

/** 条件ごとの、上位の行が収まる公開日時の境目。境目が無い条件はnull。 */
export type Boundaries = (string | null)[];

function sortDirection(sort: SearchRequest['sort']): 'ASC' | 'DESC' {
  return sort === 'oldest' ? 'ASC' : 'DESC';
}

/**
 * 行のキーまで使って並べると、当たった行すべてのキーの列を読むことになり遅い。
 * 先に公開日時だけで上位の境目を求め、結果は境目より内側の行だけを読んで並べる。
 * 当たる行が境目の深さに満たない条件は、境目がNULLになる。
 */
export function boundariesQuery(alternatives: SearchAlternative[], sort: SearchRequest['sort']): string {
  return alternatives
    .map(({ boundaryWhere }, index) => {
      if (boundaryWhere === null) return `SELECT ${index} AS alternative, CAST(NULL AS Nullable(DateTime)) AS boundary`;
      return `SELECT ${index} AS alternative, (SELECT published_at FROM entries WHERE ${boundaryWhere}
        ORDER BY published_at ${sortDirection(sort)} LIMIT 1 OFFSET {boundaryOffset:UInt32}) AS boundary`;
    })
    .join(' UNION ALL ');
}

function boundaryParameterName(index: number): string {
  return `boundary${index}`;
}

export function boundaryParameters(boundaries: Boundaries): Record<string, string> {
  return Object.fromEntries(
    boundaries.flatMap((boundary, index) => (boundary === null ? [] : [[boundaryParameterName(index), boundary]])),
  );
}

/**
 * 条件ごとに上位の行だけを取り、合わせてから並べ直す。全体の上位は、どれかの条件の上位に必ず入っている。
 * 2つの条件に当たった行と、まだマージされていない同じ行の古い版は、行のキーで1つにする。
 */
export function entriesQuery(alternatives: SearchAlternative[], sort: SearchRequest['sort'], boundaries: Boundaries): string {
  const insideBoundary = sort === 'oldest' ? '<=' : '>=';
  const newestVersionOfEachEntry = `ORDER BY published_at ${sortDirection(sort)}, ${ENTRY_KEY}, ingested_at DESC LIMIT 1 BY ${ENTRY_KEY}`;
  const topOfEachAlternative = alternatives
    .map(({ where }, index) => {
      const withinBoundary =
        boundaries[index] === null ? where : `${where} AND published_at ${insideBoundary} {${boundaryParameterName(index)}:DateTime}`;
      return `SELECT * FROM (SELECT ${ENTRY_RESULT_COLUMNS} FROM entries WHERE ${withinBoundary}
        ${newestVersionOfEachEntry} LIMIT {alternativeLimit:UInt32})`;
    })
    .join(' UNION ALL ');
  return `SELECT ${ENTRY_RESULT_COLUMNS} FROM (${topOfEachAlternative})
    ${newestVersionOfEachEntry}
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;
}

/**
 * 境目の内側だけを読んだ結果が、全部を読んだ結果と同じになるか。
 * 境目より内側の行は漏れなく読んでいるので、ページが埋まり、その最後の行がどの境目よりも内側なら同じになる。
 */
export function isPageWithinBoundaries(
  page: { published_at: string }[],
  request: Pick<SearchRequest, 'limit' | 'sort'>,
  boundaries: Boundaries,
): boolean {
  const usedBoundaries = boundaries.filter((boundary) => boundary !== null);
  if (usedBoundaries.length === 0) return true;
  const lastRow = page.at(-1);
  if (!lastRow || page.length < request.limit) return false;
  // 日時は同じ桁数の文字列なので、文字列のまま比べられる。
  return request.sort === 'oldest'
    ? usedBoundaries.every((boundary) => lastRow.published_at <= boundary)
    : usedBoundaries.every((boundary) => lastRow.published_at >= boundary);
}

/** 条件は互いに重ならないので、条件ごとの件数を足す。 */
export function countQuery(countAlternatives: string[]): string {
  const countOfEachAlternative = countAlternatives
    .map((where) => `SELECT count() AS matches FROM entries WHERE ${where}`)
    .join(' UNION ALL ');
  return `SELECT sum(matches) AS matches FROM (${countOfEachAlternative})`;
}
