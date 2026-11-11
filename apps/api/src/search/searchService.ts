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

  async function countMatches(where: string, parameters: Record<string, unknown>): Promise<number | null> {
    try {
      const result = await clickhouse.query({
        query: `SELECT count() AS matches FROM entries WHERE ${where}`,
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
      const { where, parameters } = buildSearchCondition(request);
      const direction = request.sort === 'oldest' ? 'ASC' : 'DESC';
      const entriesPromise = clickhouse.query({
        query: `SELECT source, service, kind, row_key, external_id, title, channel_name, language,
            duration_seconds, published_at, url
          FROM entries
          WHERE ${where}
          ORDER BY published_at ${direction}, source, key_number, row_key
          LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        format: 'JSONEachRow',
        query_params: { ...parameters, limit: request.limit, offset: request.offset },
        clickhouse_settings: SEARCH_SETTINGS,
      });
      const [entriesResult, total] = await Promise.all([entriesPromise, countMatches(where, parameters)]);
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
