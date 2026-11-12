/** すべてのsourceをMySQLからClickHouseへ写す。1本の接続で順に読み、MySQLへの負荷を読みやすくする。 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ClickHouseClient } from '@clickhouse/client';
import type { Connection } from 'mysql2/promise';
import type { ApplicationConfig } from '../config.js';
import { fullEveryDaysOf, type AttributeDefinition, type SourceConfig } from '../sources/sourceConfig.js';
import { sourceDefinitionHash } from '../sources/sourceDefinitionHash.js';
import { readChangedKeys } from './changedKeysReader.js';
import {
  clickhouseNow,
  dateOfClickhouse,
  lastSucceededFullRunAt,
  lastSucceededRun,
  latestRuns,
  saveRun,
  type IngestRun,
} from './ingestRunStore.js';
import { averageRowBytes, readChunk, readRowsByKey, type AttributeTypes, type EntryRow, type ReadContext } from './sourceReader.js';

const MILLISECONDS_PER_DAY = 86_400_000;
/** 変わった行を、キーを指定して1回に読み直す数。IN の並びが長くなりすぎない大きさ。 */
const CHANGED_ROWS_PER_READ = 2_000;

export interface IngestDependencies {
  connection: Connection;
  attributes: AttributeDefinition[];
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

interface CopyTarget {
  dependencies: IngestDependencies;
  source: SourceConfig;
  run: IngestRun;
  table: 'entries' | 'entries_staging';
}

function readContextOf(target: CopyTarget): ReadContext {
  const attributeTypes: AttributeTypes = new Map(
    target.dependencies.attributes.map((attribute) => [attribute.name, attribute.type]),
  );
  return {
    connection: target.dependencies.connection,
    source: target.source,
    attributeTypes,
    ingestedAt: clickhouseNow(),
  };
}

/** 読んだ行を書き、実行の記録を進める。 */
async function writeRows(target: CopyTarget, rows: EntryRow[]): Promise<void> {
  await target.dependencies.clickhouse.insert({ table: target.table, values: rows, format: 'JSONEachRow' });
  target.run.rowsRead += rows.length;
  await saveRun(target.dependencies.clickhouse, target.run);
}

async function waitForReadLimit(target: CopyTarget, read: { rows: number; rowBytes: number; startedAt: number }): Promise<void> {
  const { settings, signal } = target.dependencies;
  const delay = throttleDelayMilliseconds({
    rows: read.rows,
    averageRowBytes: read.rowBytes,
    maximumMegabytesPerSecond: settings.maximumMegabytesPerSecond,
    elapsedMilliseconds: Date.now() - read.startedAt,
  });
  if (delay > 0) await sleep(delay, undefined, { signal }).catch(() => undefined);
}

async function copyRows(target: CopyTarget, startKey: string): Promise<void> {
  const { connection, settings, signal, log } = target.dependencies;
  const rowBytes = await averageRowBytes(connection, target.source);
  let afterKey = startKey;
  while (!signal.aborted) {
    const startedAt = Date.now();
    const { rows, lastKey } = await readChunk(readContextOf(target), { afterKey, chunkRows: settings.chunkRows });
    if (rows.length === 0 || lastKey === null) return;
    target.run.lastKey = lastKey;
    afterKey = lastKey;
    await writeRows(target, rows);
    if (target.run.rowsRead % (settings.chunkRows * 50) === 0) {
      log(`${target.source.id}: ${target.run.rowsRead.toLocaleString('en-US')} 行`);
    }
    if (rows.length < settings.chunkRows) return;
    await waitForReadLimit(target, { rows: rows.length, rowBytes, startedAt });
  }
}

/**
 * 古い行があとから変わる表で、前回の取り込みのあとに変わった行を読み直す。
 * 新しい版として足すので、同じ行の古い版はマージで消える。
 */
async function copyChangedRows(target: CopyTarget, previousStartedAt: Date): Promise<void> {
  const { connection, signal, log } = target.dependencies;
  if (target.source.changedKeys.length === 0) return;
  const keys = await readChangedKeys({ connection, source: target.source, since: previousStartedAt });
  log(`${target.source.id}: 変わった行 ${keys.length.toLocaleString('en-US')} 件を読み直します`);
  const rowBytes = await averageRowBytes(connection, target.source);
  for (let offset = 0; offset < keys.length && !signal.aborted; offset += CHANGED_ROWS_PER_READ) {
    const startedAt = Date.now();
    const rows = await readRowsByKey(readContextOf(target), keys.slice(offset, offset + CHANGED_ROWS_PER_READ));
    if (rows.length > 0) await writeRows(target, rows);
    await waitForReadLimit(target, { rows: rows.length, rowBytes, startedAt });
  }
}

async function runIncremental(target: CopyTarget, previousSucceeded: IngestRun): Promise<void> {
  const maximumKey = await maximumKeyNumber(target.dependencies.clickhouse, target.source);
  await copyRows(target, incrementalStartKey(maximumKey, target.source.rereadRecentKeys));
  if (target.dependencies.signal.aborted) return;
  await copyChangedRows(target, dateOfClickhouse(previousSucceeded.startedAt));
}

/**
 * 全件を読み終えてから1回で差し替えるので、途中の間も検索は前回の内容を返す。
 * 同じ定義の読み直しが途中で止まっていたら、続きから読む。
 */
async function runFull(target: CopyTarget, previous: IngestRun | undefined): Promise<void> {
  const { clickhouse, signal } = target.dependencies;
  const { source, run } = target;
  const resumes =
    previous?.mode === 'full' &&
    previous.status === 'running' &&
    previous.lastKey !== '' &&
    previous.definitionHash === run.definitionHash;
  if (resumes) {
    run.rowsRead = previous.rowsRead;
    run.lastKey = previous.lastKey;
  } else {
    await clickhouse.command({ query: `ALTER TABLE entries_staging DROP PARTITION '${source.id}'` });
  }
  await copyRows(target, run.lastKey);
  if (signal.aborted) return;
  await clickhouse.command({ query: `ALTER TABLE entries REPLACE PARTITION '${source.id}' FROM entries_staging` });
  await clickhouse.command({ query: `ALTER TABLE entries_staging DROP PARTITION '${source.id}'` });
}

/** 全件を読み直す間隔が過ぎたか。決まった間隔で読み直さない表は、いつも過ぎていない。 */
async function isFullRunDue(clickhouse: ClickHouseClient, source: SourceConfig, now: Date): Promise<boolean> {
  const fullEveryDays = fullEveryDaysOf(source);
  if (fullEveryDays === null) return false;
  const lastFullAt = await lastSucceededFullRunAt(clickhouse, source.id);
  if (!lastFullAt) return true;
  return now.getTime() - lastFullAt.getTime() >= fullEveryDays * MILLISECONDS_PER_DAY;
}

export async function ingestSource(dependencies: IngestDependencies, source: SourceConfig): Promise<void> {
  const { clickhouse, signal, log } = dependencies;
  const now = new Date();
  const definitionHash = sourceDefinitionHash(source, dependencies.attributes);
  const previousSucceeded = await lastSucceededRun(clickhouse, source.id);
  // 定義が変わると前に読んだ行の中身が古くなるので、差分の表でも全件を読み直して差し替える。
  const isDefinitionChanged = previousSucceeded?.definitionHash !== definitionHash;
  const isFullDue = await isFullRunDue(clickhouse, source, now);
  const readsAllRows = isFullDue || isDefinitionChanged || !previousSucceeded;
  // fullの表は新しい行を見分けられないので、全件を読む日でなければ何もしない。
  if (source.mode === 'full' && !readsAllRows) {
    log(`${source.id}: 読み直しの間隔の前なので飛ばします`);
    return;
  }
  const previous = (await latestRuns(clickhouse)).get(source.id);
  const run: IngestRun = {
    runId: randomUUID(),
    source: source.id,
    mode: readsAllRows ? 'full' : 'incremental',
    status: 'running',
    startedAt: clickhouseNow(now),
    finishedAt: null,
    rowsRead: 0,
    lastKey: '',
    error: '',
    definitionHash,
  };
  await saveRun(clickhouse, run);
  log(`${source.id}: 開始（${run.mode}${isDefinitionChanged && previousSucceeded ? '、定義が変わったため' : ''}）`);
  const target: CopyTarget = { dependencies, source, run, table: readsAllRows ? 'entries_staging' : 'entries' };
  try {
    if (readsAllRows) await runFull(target, previous);
    else await runIncremental(target, previousSucceeded);
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
