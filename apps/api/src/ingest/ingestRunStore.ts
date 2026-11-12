/** 取り込みの実行の記録。ClickHouseのingest_runsに、状態が変わるたびに新しい行として書く。 */
import type { ClickHouseClient } from '@clickhouse/client';
import type { IngestRunStatus } from '@mds/contracts';

export interface IngestRun {
  runId: string;
  source: string;
  mode: 'incremental' | 'full';
  status: IngestRunStatus;
  startedAt: string;
  finishedAt: string | null;
  rowsRead: number;
  lastKey: string;
  error: string;
  /** この実行が読んだsourceの定義の指紋。 */
  definitionHash: string;
}

interface IngestRunRow {
  run_id: string;
  source: string;
  mode: 'incremental' | 'full';
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  rows_read: string | number;
  last_key: string;
  error: string;
  definition_hash: string;
}

function toRun(row: IngestRunRow): IngestRun {
  return {
    runId: row.run_id,
    source: row.source,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rowsRead: Number(row.rows_read),
    lastKey: row.last_key,
    error: row.error,
    definitionHash: row.definition_hash,
  };
}

export function clickhouseNow(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function saveRun(client: ClickHouseClient, run: IngestRun): Promise<void> {
  await client.insert({
    table: 'ingest_runs',
    format: 'JSONEachRow',
    values: [
      {
        run_id: run.runId,
        source: run.source,
        mode: run.mode,
        status: run.status,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        rows_read: run.rowsRead,
        last_key: run.lastKey,
        error: run.error,
        definition_hash: run.definitionHash,
        updated_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      },
    ],
  });
}

/** sourceごとの最新の実行。 */
export async function latestRuns(client: ClickHouseClient): Promise<Map<string, IngestRun>> {
  const result = await client.query({
    query: `SELECT run_id, source, mode, status, started_at, finished_at, rows_read, last_key, error, definition_hash
      FROM ingest_runs FINAL
      ORDER BY started_at DESC, updated_at DESC
      LIMIT 1 BY source`,
    format: 'JSONEachRow',
  });
  const rows = await result.json<IngestRunRow>();
  return new Map(rows.map((row) => [row.source, toRun(row)]));
}

/** 前の常駐処理が取り込みの途中で止まったか。常駐処理は1つだけなので、起動時にrunningが残っていれば止まった実行。 */
export async function hasInterruptedRun(client: ClickHouseClient): Promise<boolean> {
  const runs = await latestRuns(client);
  return [...runs.values()].some((run) => run.status === 'running');
}

/** sourceを最後に読み終えた実行。 */
export async function lastSucceededRun(client: ClickHouseClient, source: string): Promise<IngestRun | null> {
  const result = await client.query({
    query: `SELECT run_id, source, mode, status, started_at, finished_at, rows_read, last_key, error, definition_hash
      FROM ingest_runs FINAL
      WHERE source = {source:String} AND status = 'succeeded'
      ORDER BY started_at DESC LIMIT 1`,
    format: 'JSONEachRow',
    query_params: { source },
  });
  const [row] = await result.json<IngestRunRow>();
  return row ? toRun(row) : null;
}

/** ClickHouseの日時の文字列（UTC）をDateにする。 */
export function dateOfClickhouse(text: string): Date {
  return new Date(`${text.replace(' ', 'T')}Z`);
}

/** fullの表を最後に読み終えた日時。 */
export async function lastSucceededFullRunAt(client: ClickHouseClient, source: string): Promise<Date | null> {
  const result = await client.query({
    query: `SELECT max(started_at) AS started_at, count() AS runs FROM ingest_runs FINAL
      WHERE source = {source:String} AND mode = 'full' AND status = 'succeeded'`,
    format: 'JSONEachRow',
    query_params: { source },
  });
  const [row] = await result.json<{ started_at: string; runs: string | number }>();
  if (!row || Number(row.runs) === 0) return null;
  return dateOfClickhouse(row.started_at);
}

export async function latestStartedAt(client: ClickHouseClient): Promise<Date | null> {
  const result = await client.query({
    query: 'SELECT max(started_at) AS started_at, count() AS runs FROM ingest_runs',
    format: 'JSONEachRow',
  });
  const [row] = await result.json<{ started_at: string; runs: string | number }>();
  if (!row || Number(row.runs) === 0) return null;
  return dateOfClickhouse(row.started_at);
}
