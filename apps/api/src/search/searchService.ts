/** ClickHouseへの検索。ほかのサービスと同じVMで動かせるよう、1回の検索が使える資源に上限を付ける。 */
import type { ClickHouseClient } from '@clickhouse/client';
import type {
  AttributesResponse,
  EntryPeersResponse,
  OverviewResponse,
  SearchCountResponse,
  SearchEntry,
  SearchRequest,
  SearchResponse,
} from '@mds/contracts';
import { attributeColumn } from '../clickhouse/attributeColumns.js';
import { sourceUrl, type SourceCatalog } from '../sources/sourceConfig.js';
import { conditionFieldDefinitions } from './conditionFields.js';
import { comparableServiceGroups } from './peerCondition.js';
import { buildSearchCondition } from './searchQuery.js';
import {
  BOUNDARY_ROWS_PER_RESULT_ROW,
  VERSIONS_READ_PER_ENTRY,
  boundariesQuery,
  boundaryParameters,
  countQuery,
  entriesQuery,
  ENTRY_RESULT_COLUMNS,
  isPageWithinBoundaries,
  type Boundaries,
} from './searchStatements.js';

const SEARCH_SETTINGS = {
  readonly: '1',
  max_execution_time: 20,
  // 突き合わせでは、相手の外部のIDの集合をメモリに載せる。
  max_memory_usage: '4000000000',
  use_skip_indexes: 1,
} as const;
/** sourceごとの行数の見積もりを使い回す時間。取り込みは1日1回なので、粗くてよい。 */
const SOURCE_ROWS_CACHE_MILLISECONDS = 600_000;
/** 外部のIDが同じ行として返す最大の数。 */
const MAXIMUM_PEER_ENTRIES = 50;
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
  [attributeColumnName: `attr_${string}`]: string | number | boolean | null;
}

export interface SearchServiceOptions {
  /** 1回の検索が使うスレッドの数。 */
  maximumThreads: number;
}

export function createSearchService(clickhouse: ClickHouseClient, catalog: SourceCatalog, options: SearchServiceOptions) {
  const searchSettings = { ...SEARCH_SETTINGS, max_threads: options.maximumThreads };
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  const attributeColumns = catalog.attributes.map((attribute) => attributeColumn(attribute.name));
  const ENTRY_RESULT_COLUMNS_WITH_ATTRIBUTES = [ENTRY_RESULT_COLUMNS, ...attributeColumns].join(', ');

  let sourceRowsCache: { rows: ReadonlyMap<string, number>; readAt: number } | null = null;

  /** sourceごとの行数の見積もり。パートの情報から読むので、表は読まない。 */
  async function sourceRows(): Promise<ReadonlyMap<string, number>> {
    if (sourceRowsCache && Date.now() - sourceRowsCache.readAt < SOURCE_ROWS_CACHE_MILLISECONDS) return sourceRowsCache.rows;
    const result = await clickhouse.query({
      query: `SELECT partition AS source, sum(rows) AS rows FROM system.parts
        WHERE database = currentDatabase() AND table = 'entries' AND active GROUP BY partition`,
      format: 'JSONEachRow',
    });
    const rows = new Map((await result.json<{ source: string; rows: string | number }>()).map((row) => [row.source, Number(row.rows)]));
    sourceRowsCache = { rows, readAt: Date.now() };
    return rows;
  }

  async function searchCatalog(request: SearchRequest) {
    return request.peer ? { ...catalog, sourceRows: await sourceRows() } : catalog;
  }

  /** そのsourceが持つ項目のうち、値のあるもの。 */
  function attributesOf(row: EntryResultRow): SearchEntry['attributes'] {
    const names = Object.keys(sourceById.get(row.source)?.attributes ?? {});
    return Object.fromEntries(
      names.flatMap((name) => {
        const value = row[attributeColumn(name)];
        return value === null || value === undefined || value === '' ? [] : [[name, value]];
      }),
    );
  }

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
      attributes: attributesOf(row),
    };
  }

  return {
    async count(request: SearchRequest): Promise<SearchCountResponse> {
      const { countAlternatives, countIsUpperBound, parameters } = buildSearchCondition(request, await searchCatalog(request));
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
      const { alternatives, parameters } = buildSearchCondition(request, await searchCatalog(request));
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
          query: entriesQuery({ alternatives, sort: request.sort, boundaries, attributeColumns }),
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

    attributes(): AttributesResponse {
      const conditionFields = conditionFieldDefinitions(catalog);
      const attributeNames = new Set(catalog.attributes.map((attribute) => attribute.name));
      return {
        attributes: conditionFields.filter((field) => attributeNames.has(field.name) && field.services.length > 0),
        conditionFields,
        comparableServiceGroups: comparableServiceGroups(catalog.sources),
      };
    },

    /** 外部のIDが同じ、ほかのsourceの行。identityの無いsourceの行には、突き合わせる相手が無い。 */
    async peers(sourceId: string, rowKey: string): Promise<EntryPeersResponse> {
      const source = sourceById.get(sourceId);
      if (!source?.identity) return { peers: [] };
      const result = await clickhouse.query({
        query: `SELECT ${ENTRY_RESULT_COLUMNS_WITH_ATTRIBUTES} FROM entries
          WHERE identity = {identity:String} AND source != {source:String}
            AND external_id = (SELECT external_id FROM entries
              WHERE source = {source:String} AND key_number = {keyNumber:UInt64} AND row_key = {rowKey:String} LIMIT 1)
            AND external_id != ''
          ORDER BY source, key_number, row_key, ingested_at DESC
          LIMIT 1 BY source, key_number, row_key
          LIMIT {maximumPeers:UInt32}`,
        format: 'JSONEachRow',
        query_params: {
          identity: source.identity,
          source: sourceId,
          // 文字のキーの行は、key_numberが0。
          keyNumber: /^\d{1,19}$/.test(rowKey) ? rowKey : '0',
          rowKey,
          maximumPeers: MAXIMUM_PEER_ENTRIES,
        },
        clickhouse_settings: searchSettings,
      });
      return { peers: (await result.json<EntryResultRow>()).map(toEntry) };
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
