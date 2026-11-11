/**
 * ClickHouseの表。検索に使う列だけを持ち、説明文などの長い列は詳細を開いたときにMySQLから読む。
 * 正本はMySQLで、この表はいつでも作り直せる。移行は持たず、形を変えたら取り込み直す。
 */
import type { ClickHouseClient } from '@clickhouse/client';
import type { ApplicationConfig } from '../config.js';
import { createClickhouseAdminClient } from './client.js';

const ENTRY_COLUMNS = `
  source LowCardinality(String),
  service LowCardinality(String),
  kind LowCardinality(String),
  row_key String CODEC(ZSTD(1)),
  key_number UInt64 CODEC(Delta, ZSTD(1)),
  external_id String CODEC(ZSTD(1)),
  title String CODEC(ZSTD(1)),
  channel_name String CODEC(ZSTD(1)),
  channel_key String CODEC(ZSTD(1)),
  language LowCardinality(String),
  duration_seconds UInt32 CODEC(ZSTD(1)),
  published_at DateTime CODEC(Delta, ZSTD(1)),
  url String CODEC(ZSTD(1)),
  ingested_at DateTime CODEC(Delta, ZSTD(1))`;

/** 検索語を小文字で引くための索引。短い日本語の語（音楽など）を引けるよう2文字ごとに切る。 */
const ENTRY_INDEXES = `,
  INDEX title_text title TYPE text(tokenizer = ngrams(2), preprocessor = lowerUTF8(title)),
  INDEX channel_text channel_name TYPE text(tokenizer = ngrams(2), preprocessor = lowerUTF8(channel_name)),
  INDEX external_id_bloom external_id TYPE bloom_filter(0.01) GRANULARITY 1`;

// 取り込みが途中で止まって同じ行を入れ直しても、行のキーでまとまるようにReplacingMergeTreeにする。
// fullの読み直しを1回で差し替えられるようsourceでパーティションを切る。
const ENTRY_ENGINE = `ENGINE = ReplacingMergeTree(ingested_at)
  PARTITION BY source
  ORDER BY (source, key_number, row_key)`;

export async function ensureSchema(config: ApplicationConfig['clickhouse'], client: ClickHouseClient): Promise<void> {
  const adminClient = createClickhouseAdminClient(config);
  await adminClient.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });
  await adminClient.close();
  await client.command({ query: `CREATE TABLE IF NOT EXISTS entries (${ENTRY_COLUMNS}${ENTRY_INDEXES}) ${ENTRY_ENGINE}` });
  // 差し替えの元になる表は、列・索引・エンジンを同じにしないとREPLACE PARTITIONできない。
  await client.command({ query: `CREATE TABLE IF NOT EXISTS entries_staging (${ENTRY_COLUMNS}${ENTRY_INDEXES}) ${ENTRY_ENGINE}` });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ingest_runs (
      run_id String,
      source LowCardinality(String),
      mode LowCardinality(String),
      status LowCardinality(String),
      started_at DateTime,
      finished_at Nullable(DateTime),
      rows_read UInt64,
      last_key String,
      error String,
      updated_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (source, run_id)`,
  });
}
