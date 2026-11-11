/** すべてのsourceをMySQLからClickHouseへ写す。1本の接続で順に読み、MySQLへの負荷を読みやすくする。 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ClickHouseClient } from '@clickhouse/client';
import type { Connection } from 'mysql2/promise';
import type { ApplicationConfig } from '../config.js';
import type { SourceConfig } from '../sources/sourceConfig.js';
import { clickhouseNow, lastSucceededFullRunAt, latestRuns, saveRun, type IngestRun } from './ingestRunStore.js';
import { averageRowBytes, readChunk } from './sourceReader.js';

const MILLISECONDS_PER_DAY = 86_400_000;

export interface IngestDependencies {
  connection: Connection;
  clickhouse: ClickHouseClient;
  settings: ApplicationConfig['ingest'];
  signal: AbortSignal;
  log: (message: string) => void;
}

/** 読んだ量が上限を超えないよう、次のかたまりまで待つ時間。 */
export function throttleDelayMilliseconds(args: {
  rows: number;
  averageRowBytes: number;
  maximumMegabytesPerSecond: number;
  elapsedMilliseconds: number;
}): number {
  const allowedMilliseconds = (args.rows * args.averageRowBytes) / (args.maximumMegabytesPerSecond * 1e6) * 1000;
  return Math.max(0, allowedMilliseconds - args.elapsedMilliseconds);
}

async function maximumKeyNumber(clickhouse: ClickHouseClient, source: SourceConfig): Promise<string> {
  const result = await clickhouse.query({
    query: 'SELECT max(key_number) AS key_number FROM entries WHERE source = {source:String}',
    format: 'JSONEachRow',
    query_params: { source: source.id },
  });
  const [row] = await result.json<{ key_number: string | number }>();
  return String(row?.key_number ?? '0');
}

export function incrementalStartKey(maximumKey: string, rereadRecentKeys: number): string {
  const start = BigInt(maximumKey) - BigInt(rereadRecentKeys);
  return start > 0n ? start.toString() : '0';
}

async function copyRows(args: {
  dependencies: IngestDependencies;
  source: SourceConfig;
  run: IngestRun;
  table: 'entries' | 'entries_staging';
  startKey: string;
}): Promise<void> {
  const { connection, clickhouse, settings, signal, log } = args.dependencies;
  const rowBytes = await averageRowBytes(connection, args.source);
  let afterKey = args.startKey;
  while (!signal.aborted) {
    const startedAt = Date.now();
    const ingestedAt = clickhouseNow();
    const { rows, lastKey } = await readChunk({
      connection,
      source: args.source,
      afterKey,
      chunkRows: settings.chunkRows,
      ingestedAt,
    });
    if (rows.length === 0 || lastKey === null) return;
    await clickhouse.insert({ table: args.table, values: rows, format: 'JSONEachRow' });
    args.run.rowsRead += rows.length;
    args.run.lastKey = lastKey;
    afterKey = lastKey;
    await saveRun(clickhouse, args.run);
    if (args.run.rowsRead % (settings.chunkRows * 50) === 0) {
      log(`${args.source.id}: ${args.run.rowsRead.toLocaleString('en-US')} 行`);
    }
    if (rows.length < settings.chunkRows) return;
    const delay = throttleDelayMilliseconds({
      rows: rows.length,
      averageRowBytes: rowBytes,
      maximumMegabytesPerSecond: settings.maximumMegabytesPerSecond,
      elapsedMilliseconds: Date.now() - startedAt,
    });
    if (delay > 0) await sleep(delay, undefined, { signal }).catch(() => undefined);
  }
}

async function runIncremental(dependencies: IngestDependencies, source: SourceConfig, run: IngestRun): Promise<void> {
  const maximumKey = await maximumKeyNumber(dependencies.clickhouse, source);
  await copyRows({
    dependencies,
    source,
    run,
    table: 'entries',
    startKey: incrementalStartKey(maximumKey, source.rereadRecentKeys),
  });
}

/** 読み終えてから1回で差し替えるので、途中の間も検索は前回の内容を返す。 */
async function runFull(
  dependencies: IngestDependencies,
  source: SourceConfig,
  run: IngestRun,
  previous: IngestRun | undefined,
): Promise<void> {
  const { clickhouse, signal } = dependencies;
  const resumes = previous?.mode === 'full' && previous.status === 'running' && previous.lastKey !== '';
  if (resumes) {
    run.rowsRead = previous.rowsRead;
    run.lastKey = previous.lastKey;
  } else {
    await clickhouse.command({ query: `ALTER TABLE entries_staging DROP PARTITION '${source.id}'` });
  }
  await copyRows({ dependencies, source, run, table: 'entries_staging', startKey: run.lastKey });
  if (signal.aborted) return;
  await clickhouse.command({ query: `ALTER TABLE entries REPLACE PARTITION '${source.id}' FROM entries_staging` });
  await clickhouse.command({ query: `ALTER TABLE entries_staging DROP PARTITION '${source.id}'` });
}

async function isFullRunDue(clickhouse: ClickHouseClient, source: SourceConfig, now: Date): Promise<boolean> {
  const lastFullAt = await lastSucceededFullRunAt(clickhouse, source.id);
  if (!lastFullAt) return true;
  return now.getTime() - lastFullAt.getTime() >= source.fullEveryDays * MILLISECONDS_PER_DAY;
}

export async function ingestSource(dependencies: IngestDependencies, source: SourceConfig): Promise<void> {
  const { clickhouse, signal, log } = dependencies;
  const now = new Date();
  if (source.mode === 'full' && !(await isFullRunDue(clickhouse, source, now))) {
    log(`${source.id}: 読み直しの間隔の前なので飛ばします`);
    return;
  }
  const previous = (await latestRuns(clickhouse)).get(source.id);
  const run: IngestRun = {
    runId: randomUUID(),
    source: source.id,
    mode: source.mode,
    status: 'running',
    startedAt: clickhouseNow(now),
    finishedAt: null,
    rowsRead: 0,
    lastKey: '',
    error: '',
  };
  await saveRun(clickhouse, run);
  log(`${source.id}: 開始（${source.mode}）`);
  try {
    if (source.mode === 'full') await runFull(dependencies, source, run, previous);
    else await runIncremental(dependencies, source, run);
    // 止める指示で抜けたときはrunningのまま残し、fullは次の起動で続きから読む。
    if (signal.aborted) return;
    run.status = 'succeeded';
  } catch (failure) {
    run.status = 'failed';
    run.error = failure instanceof Error ? failure.message : String(failure);
    log(`${source.id}: 失敗 ${run.error}`);
  }
  run.finishedAt = clickhouseNow();
  await saveRun(clickhouse, run);
  log(`${source.id}: ${run.status}（${run.rowsRead.toLocaleString('en-US')} 行）`);
}

export async function ingestAllSources(dependencies: IngestDependencies, sources: SourceConfig[]): Promise<void> {
  for (const source of sources) {
    if (dependencies.signal.aborted) return;
    await ingestSource(dependencies, source);
  }
}
