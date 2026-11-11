/** ClickHouseへの検索。ほかのサービスと同じVMで動かせるよう、1回の検索が使える資源に上限を付ける。 */
import type { ClickHouseClient } from '@clickhouse/client';
import type { OverviewResponse, SearchEntry, SearchRequest, SearchResponse } from '@mds/contracts';
import { sourceUrl, type SourceConfig } from '../sources/sourceConfig.js';
import { buildSearchCondition } from './searchQuery.js';

const SEARCH_SETTINGS = {
  readonly: '1',
  max_execution_time: 20,
  max_threads: 4,
  max_memory_usage: '2000000000',
  use_skip_indexes: 1,
} as const;
/** 件数は結果より長く待たない。間に合わなければ件数を出さずに結果だけ返す。 */
const COUNT_TIMEOUT_SECONDS = 5;
const EPOCH_TEXT = '1970-01-01 00:00:00';

const ENTRY_KEY = 'source, key_number, row_key';
const ENTRY_RESULT_COLUMNS = `${ENTRY_KEY}, service, kind, external_id, title, channel_name, language,
  duration_seconds, published_at, url, ingested_at`;

/**
 * 条件ごとに上位の行だけを取り、合わせてから並べ直す。全体の上位は、どれかの条件の上位に必ず入っている。
 * まだマージされていない同じ行の古い版は、行のキーで1つにする。
 */
export function entriesQuery(alternatives: string[], sort: SearchRequest['sort']): string {
  const direction = sort === 'oldest' ? 'ASC' : 'DESC';
  const order = `published_at ${direction}, ${ENTRY_KEY}, ingested_at DESC`;
  const topOfEachAlternative = alternatives
    .map(
      (where) =>
        `SELECT * FROM (SELECT ${ENTRY_RESULT_COLUMNS} FROM entries WHERE ${where} ORDER BY ${order} LIMIT {alternativeLimit:UInt32})`,
    )
    .join(' UNION ALL ');
  return `SELECT ${ENTRY_RESULT_COLUMNS} FROM (${topOfEachAlternative})
    ORDER BY ${order}
    LIMIT 1 BY ${ENTRY_KEY}
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;
}

/** 条件は互いに重ならないので、条件ごとの件数を足す。 */
export function countQuery(alternatives: string[]): string {
  const countOfEachAlternative = alternatives
    .map((where) => `SELECT count() AS matches FROM entries WHERE ${where}`)
    .join(' UNION ALL ');
  return `SELECT sum(matches) AS matches FROM (${countOfEachAlternative})`;
}

interface EntryResultRow {
  source: string;
  service: string;
  kind: string;
  row_key: string;
  external_id: string;
  title: string;
  channel_name: string;
  language: string;
  duration_seconds: number | string;
  published_at: string;
  url: string;
}

export function createSearchService(clickhouse: ClickHouseClient, sources: SourceConfig[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  function toEntry(row: EntryResultRow): SearchEntry {
    const source = sourceById.get(row.source);
    return {
      source: row.source,
      service: row.service,
      kind: row.kind,
      rowKey: row.row_key,
      externalId: row.external_id,
      title: row.title,
      channelName: row.channel_name,
      language: row.language,
      durationSeconds: Number(row.duration_seconds),
      publishedAt: row.published_at === EPOCH_TEXT ? null : row.published_at,
      url: source ? sourceUrl(source, row.external_id, row.url) : row.url || null,
    };
  }

  async function countMatches(alternatives: string[], parameters: Record<string, unknown>): Promise<number | null> {
    try {
      const result = await clickhouse.query({
        query: countQuery(alternatives),
        format: 'JSONEachRow',
        query_params: parameters,
        clickhouse_settings: { ...SEARCH_SETTINGS, max_execution_time: COUNT_TIMEOUT_SECONDS },
      });
      const [row] = await result.json<{ matches: string | number }>();
      return row ? Number(row.matches) : 0;
    } catch {
      // 件数は補助の情報なので、時間切れなら結果だけ返す。
      return null;
    }
  }

  return {
    async search(request: SearchRequest): Promise<SearchResponse> {
      const startedAt = Date.now();
      const { alternatives, parameters } = buildSearchCondition(request);
      const entriesPromise = clickhouse.query({
        query: entriesQuery(alternatives, request.sort),
        format: 'JSONEachRow',
        query_params: {
          ...parameters,
          limit: request.limit,
          offset: request.offset,
          alternativeLimit: request.offset + request.limit,
        },
        clickhouse_settings: SEARCH_SETTINGS,
      });
      const [entriesResult, total] = await Promise.all([entriesPromise, countMatches(alternatives, parameters)]);
      const rows = await entriesResult.json<EntryResultRow>();
      return { entries: rows.map(toEntry), total, elapsedMilliseconds: Date.now() - startedAt };
    },

    async overview(): Promise<OverviewResponse> {
      const facet = async (column: string) => {
        const result = await clickhouse.query({
          query: `SELECT ${column} AS value, count() AS count FROM entries WHERE ${column} != '' GROUP BY value ORDER BY count DESC LIMIT 100`,
          format: 'JSONEachRow',
          clickhouse_settings: SEARCH_SETTINGS,
        });
        const rows = await result.json<{ value: string; count: string | number }>();
        return rows.map((row) => ({ value: row.value, count: Number(row.count) }));
      };
      const [services, kinds, languages] = await Promise.all([facet('service'), facet('kind'), facet('language')]);
      return {
        totalEntries: services.reduce((sum, service) => sum + service.count, 0),
        services,
        kinds,
        languages,
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
