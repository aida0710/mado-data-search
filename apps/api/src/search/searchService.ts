/** ClickHouseへの検索。ほかのサービスと同じVMで動かせるよう、1回の検索が使える資源に上限を付ける。 */
import type { ClickHouseClient } from '@clickhouse/client';
import type {
  OverviewResponse,
  SearchCountResponse,
  SearchEntry,
  SearchRequest,
  SearchResponse,
} from '@mds/contracts';
import { sourceUrl, type SourceConfig } from '../sources/sourceConfig.js';
import { buildSearchCondition } from './searchQuery.js';
import {
  BOUNDARY_ROWS_PER_RESULT_ROW,
  VERSIONS_READ_PER_ENTRY,
  boundariesQuery,
  boundaryParameters,
  countQuery,
  entriesQuery,
  isPageWithinBoundaries,
  type Boundaries,
} from './searchStatements.js';

const SEARCH_SETTINGS = {
  readonly: '1',
  max_execution_time: 20,
  max_memory_usage: '2000000000',
  use_skip_indexes: 1,
} as const;
/** 当たる行が多い語は数えきれないので、ここで打ち切って件数なしで返す。 */
const COUNT_TIMEOUT_SECONDS = 5;
/** 件数は結果と同時に数える。結果の取得からCPUを奪わないよう、少ないスレッドで数える。 */
const COUNT_THREADS = 2;
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

export interface SearchServiceOptions {
  /** 1回の検索が使うスレッドの数。 */
  maximumThreads: number;
}

export function createSearchService(clickhouse: ClickHouseClient, sources: SourceConfig[], options: SearchServiceOptions) {
  const searchSettings = { ...SEARCH_SETTINGS, max_threads: options.maximumThreads };
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

  return {
    async count(request: SearchRequest): Promise<SearchCountResponse> {
      const { countAlternatives, countIsUpperBound, parameters } = buildSearchCondition(request, sources);
      try {
        const result = await clickhouse.query({
          query: countQuery(countAlternatives),
          format: 'JSONEachRow',
          query_params: parameters,
          clickhouse_settings: { ...searchSettings, max_execution_time: COUNT_TIMEOUT_SECONDS, max_threads: COUNT_THREADS },
        });
        const [row] = await result.json<{ matches: string | number }>();
        return { total: row ? Number(row.matches) : 0, isUpperBound: countIsUpperBound };
      } catch {
        // 件数は補助の情報なので、時間切れなら件数なしで返す。
        return { total: null, isUpperBound: false };
      }
    },

    async search(request: SearchRequest): Promise<SearchResponse> {
      const startedAt = Date.now();
      const { alternatives, parameters } = buildSearchCondition(request, sources);
      const alternativeLimit = request.offset + request.limit;

      async function findBoundaries(): Promise<Boundaries> {
        const result = await clickhouse.query({
          query: boundariesQuery(alternatives, request.sort),
          format: 'JSONEachRow',
          query_params: { ...parameters, boundaryOffset: alternativeLimit * BOUNDARY_ROWS_PER_RESULT_ROW - 1 },
          clickhouse_settings: searchSettings,
        });
        const rows = await result.json<{ alternative: number; boundary: string | null }>();
        const boundaries: Boundaries = alternatives.map(() => null);
        for (const row of rows) boundaries[Number(row.alternative)] = row.boundary;
        return boundaries;
      }

      async function readPage(boundaries: Boundaries): Promise<EntryResultRow[]> {
        const result = await clickhouse.query({
          query: entriesQuery(alternatives, request.sort, boundaries),
          format: 'JSONEachRow',
          query_params: {
            ...parameters,
            ...boundaryParameters(boundaries),
            limit: request.limit,
            offset: request.offset,
            alternativeReadLimit: alternativeLimit * VERSIONS_READ_PER_ENTRY,
          },
          clickhouse_settings: searchSettings,
        });
        return result.json<EntryResultRow>();
      }

      const boundaries = await findBoundaries();
      let page = await readPage(boundaries);
      // 索引には当たるが語が続けて現れない行が多いと、境目の内側ではページが埋まらない。そのときは全部を読む。
      if (!isPageWithinBoundaries(page, request, boundaries)) page = await readPage(alternatives.map(() => null));
      return { entries: page.map(toEntry), elapsedMilliseconds: Date.now() - startedAt };
    },

    async overview(): Promise<OverviewResponse> {
      const facet = async (column: string) => {
        const result = await clickhouse.query({
          query: `SELECT ${column} AS value, count() AS count FROM entries WHERE ${column} != '' GROUP BY value ORDER BY count DESC LIMIT 100`,
          format: 'JSONEachRow',
          clickhouse_settings: searchSettings,
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
