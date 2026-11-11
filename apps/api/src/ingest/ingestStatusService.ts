/** 取り込みの状況を画面へ返す。 */
import type { ClickHouseClient } from '@clickhouse/client';
import type { IngestStatusResponse } from '@mds/contracts';
import type { SourceConfig } from '../sources/sourceConfig.js';
import { latestRuns } from './ingestRunStore.js';

export function createIngestStatusService(clickhouse: ClickHouseClient, sources: SourceConfig[], intervalHours: number) {
  return {
    async read(): Promise<IngestStatusResponse> {
      const [runs, countResult] = await Promise.all([
        latestRuns(clickhouse),
        clickhouse.query({
          query: 'SELECT source, count() AS entries FROM entries GROUP BY source',
          format: 'JSONEachRow',
        }),
      ]);
      const counts = new Map(
        (await countResult.json<{ source: string; entries: string | number }>()).map((row) => [row.source, Number(row.entries)]),
      );
      return {
        intervalHours,
        sources: sources.map((source) => {
          const run = runs.get(source.id);
          return {
            id: source.id,
            service: source.service,
            kind: source.kind,
            mode: source.mode,
            entryCount: counts.get(source.id) ?? 0,
            lastRun: run
              ? {
                  status: run.status,
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                  rowsRead: run.rowsRead,
                  error: run.error,
                }
              : null,
          };
        }),
      };
    },
  };
}

export type IngestStatusService = ReturnType<typeof createIngestStatusService>;
