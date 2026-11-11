/**
 * 取り込みの常駐処理。前回の開始から決まった間隔が過ぎたら、すべてのsourceを写す。
 * `--once` は1回だけ実行して終わる。`--source <id>` を重ねると対象を絞る。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { createClickhouseClient } from './clickhouse/client.js';
import { ensureSchema } from './clickhouse/schema.js';
import { ingestAllSources } from './ingest/ingestRunner.js';
import { hasInterruptedRun, latestStartedAt } from './ingest/ingestRunStore.js';
import { openReadOnlyConnection } from './ingest/mysqlConnection.js';
import { loadSources } from './sources/sourceConfig.js';

const MILLISECONDS_PER_HOUR = 3_600_000;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function selectedSourceIds(argv: string[]): Set<string> {
  const ids = new Set<string>();
  argv.forEach((argument, index) => {
    const value = argv[index + 1];
    if (argument === '--source' && value) ids.add(value);
  });
  return ids;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  const runsOnce = argv.includes('--once');
  const selected = selectedSourceIds(argv);
  const sources = loadSources(config.sourcesFile).filter((source) => selected.size === 0 || selected.has(source.id));

  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());

  const clickhouse = createClickhouseClient(config.clickhouse);
  await ensureSchema(config.clickhouse, clickhouse);
  const intervalMilliseconds = config.ingest.intervalHours * MILLISECONDS_PER_HOUR;

  // 再起動で途中のまま止まった取り込みは、次の間隔を待たずに続きから読む。
  let resumesInterruptedRun = !runsOnce && (await hasInterruptedRun(clickhouse));
  if (resumesInterruptedRun) log('途中で止まった取り込みを再開します');

  while (!stop.signal.aborted) {
    const lastStartedAt = runsOnce || resumesInterruptedRun ? null : await latestStartedAt(clickhouse);
    resumesInterruptedRun = false;
    const waitMilliseconds = lastStartedAt ? lastStartedAt.getTime() + intervalMilliseconds - Date.now() : 0;
    if (waitMilliseconds > 0) {
      log(`次の取り込みまで ${Math.round(waitMilliseconds / 60_000)} 分`);
      await sleep(waitMilliseconds, undefined, { signal: stop.signal }).catch(() => undefined);
      continue;
    }
    // 接続を持ち続けないよう、取り込みのたびにつなぐ（MySQLの接続数はほかの利用者と分け合う）。
    const connection = await openReadOnlyConnection(config.mysql);
    try {
      await ingestAllSources(
        { connection, clickhouse, settings: config.ingest, signal: stop.signal, log },
        sources,
      );
    } finally {
      await connection.end();
    }
    if (runsOnce) break;
  }
  await clickhouse.close();
}

main().catch((failure) => {
  console.error(failure);
  process.exit(1);
});
