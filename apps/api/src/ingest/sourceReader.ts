/** MySQLの1つの表を、主キーの順に少しずつ読む。 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { SourceConfig } from '../sources/sourceConfig.js';

export interface EntryRow {
  source: string;
  service: string;
  kind: string;
  row_key: string;
  key_number: number | string;
  external_id: string;
  title: string;
  channel_name: string;
  channel_key: string;
  language: string;
  duration_seconds: number;
  published_at: string;
  url: string;
  ingested_at: string;
}

const EPOCH = '1970-01-01 00:00:00';
const MAXIMUM_DURATION_SECONDS = 4_294_967_295;

export function buildChunkSql(source: SourceConfig): string {
  const expression = (field: keyof SourceConfig['fields']) => source.fields[field] ?? "''";
  return `SELECT t.\`${source.key}\` AS row_key,
    ${expression('externalId')} AS external_id,
    ${expression('title')} AS title,
    ${expression('channelName')} AS channel_name,
    ${expression('channelKey')} AS channel_key,
    ${expression('language')} AS language,
    ${source.fields.durationSeconds ?? '0'} AS duration_seconds,
    ${source.fields.publishedAt ?? 'NULL'} AS published_at,
    ${expression('url')} AS url
  FROM \`${source.database}\`.\`${source.table}\` t ${source.join}
  WHERE t.\`${source.key}\` > ?
  ORDER BY t.\`${source.key}\`
  LIMIT ?`;
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function publishedAtOf(value: unknown): string {
  const text = textOf(value);
  // MySQLのゼロ日付と、DateTimeの範囲に入らない日付は不明として扱う。
  if (!text || text.startsWith('0000') || text < EPOCH || text >= '2106') return EPOCH;
  return text.slice(0, 19);
}

function durationOf(value: unknown): number {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, MAXIMUM_DURATION_SECONDS);
}

export function toEntryRow(source: SourceConfig, row: RowDataPacket, ingestedAt: string): EntryRow {
  const rowKey = textOf(row.row_key);
  return {
    source: source.id,
    service: source.service,
    kind: source.kind,
    row_key: rowKey,
    // 文字のキーは0にして、row_keyで並べる。大きな整数を丸めないよう文字列のまま渡す。
    key_number: /^\d+$/.test(rowKey) ? rowKey : 0,
    external_id: textOf(row.external_id),
    title: textOf(row.title),
    channel_name: textOf(row.channel_name),
    channel_key: textOf(row.channel_key),
    language: textOf(row.language),
    duration_seconds: durationOf(row.duration_seconds),
    published_at: publishedAtOf(row.published_at),
    url: textOf(row.url),
    ingested_at: ingestedAt,
  };
}

export async function readChunk(args: {
  connection: Connection;
  source: SourceConfig;
  afterKey: string;
  chunkRows: number;
  ingestedAt: string;
}): Promise<{ rows: EntryRow[]; lastKey: string | null }> {
  const [packets] = await args.connection.query<RowDataPacket[]>(buildChunkSql(args.source), [
    args.afterKey,
    args.chunkRows,
  ]);
  const rows = packets.map((packet) => toEntryRow(args.source, packet, args.ingestedAt));
  return { rows, lastKey: rows.at(-1)?.row_key ?? null };
}

/** 1行あたりの大きさ。読みの速さを絞る計算に使う。統計なので正確でなくてよい。 */
export async function averageRowBytes(connection: Connection, source: SourceConfig): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT avg_row_length AS bytes FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [source.database, source.table],
  );
  const bytes = Number(rows[0]?.bytes);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 256;
}
