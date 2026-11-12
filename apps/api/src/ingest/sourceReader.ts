/** MySQLの1つの表を、主キーの順に少しずつ読む。 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { attributeColumn } from '../clickhouse/attributeColumns.js';
import type { AttributeType, SourceConfig } from '../sources/sourceConfig.js';

/** 項目の名前から型を引く。 */
export type AttributeTypes = ReadonlyMap<string, AttributeType>;

type AttributeValue = string | number | boolean | null;

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
  identity: string;
  ingested_at: string;
  /** データセットごとの項目。キーはClickHouseの列の名前。 */
  [attributeColumnName: `attr_${string}`]: AttributeValue;
}

const EPOCH = '1970-01-01 00:00:00';
const MAXIMUM_DURATION_SECONDS = 4_294_967_295;

function selectList(source: SourceConfig): string {
  const expression = (field: keyof SourceConfig['fields']) => source.fields[field] ?? "''";
  const attributes = Object.entries(source.attributes).map(
    ([name, attributeExpression]) => `${attributeExpression} AS ${attributeColumn(name)}`,
  );
  return [
    `t.\`${source.key}\` AS row_key`,
    `${expression('externalId')} AS external_id`,
    `${expression('title')} AS title`,
    `${expression('channelName')} AS channel_name`,
    `${expression('channelKey')} AS channel_key`,
    `${expression('language')} AS language`,
    `${source.fields.durationSeconds ?? '0'} AS duration_seconds`,
    `${source.fields.publishedAt ?? 'NULL'} AS published_at`,
    `${expression('url')} AS url`,
    ...attributes,
  ].join(',\n    ');
}

function fromClause(source: SourceConfig): string {
  return `FROM \`${source.database}\`.\`${source.table}\` t ${source.join}`;
}

export function buildChunkSql(source: SourceConfig): string {
  return `SELECT ${selectList(source)}
  ${fromClause(source)}
  WHERE t.\`${source.key}\` > ?
  ORDER BY t.\`${source.key}\`
  LIMIT ?`;
}

/** キーを指定して読むSQL。キーの並びを1つの ? で受ける。 */
export function buildRowsByKeySql(source: SourceConfig): string {
  return `SELECT ${selectList(source)}
  ${fromClause(source)}
  WHERE t.\`${source.key}\` IN (?)`;
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** MySQLのゼロ日付と、DateTimeの範囲に入らない日付は不明として扱う。 */
function dateTimeOf(value: unknown): string | null {
  const text = textOf(value);
  if (!text || text.startsWith('0000') || text < EPOCH || text >= '2106') return null;
  return text.slice(0, 19);
}

function publishedAtOf(value: unknown): string {
  return dateTimeOf(value) ?? EPOCH;
}

function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOf(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function attributeValueOf(type: AttributeType, value: unknown): AttributeValue {
  switch (type) {
    case 'keyword':
    case 'text':
      return textOf(value);
    case 'number':
      return numberOf(value);
    case 'datetime':
      return dateTimeOf(value);
    case 'boolean':
      return booleanOf(value);
  }
}

function durationOf(value: unknown): number {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, MAXIMUM_DURATION_SECONDS);
}

export function toEntryRow(args: {
  source: SourceConfig;
  attributeTypes: AttributeTypes;
  row: RowDataPacket;
  ingestedAt: string;
}): EntryRow {
  const { source, row } = args;
  const rowKey = textOf(row.row_key);
  const attributes = Object.fromEntries(
    Object.keys(source.attributes).map((name) => {
      const type = args.attributeTypes.get(name);
      if (!type) throw new Error(`${source.id}: 定義の無い項目です: ${name}`);
      return [attributeColumn(name), attributeValueOf(type, row[attributeColumn(name)])];
    }),
  );
  return {
    ...attributes,
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
    identity: source.identity,
    ingested_at: args.ingestedAt,
  };
}

export interface ReadContext {
  connection: Connection;
  source: SourceConfig;
  attributeTypes: AttributeTypes;
  ingestedAt: string;
}

function toEntryRows(context: ReadContext, packets: RowDataPacket[]): EntryRow[] {
  return packets.map((row) =>
    toEntryRow({ source: context.source, attributeTypes: context.attributeTypes, row, ingestedAt: context.ingestedAt }),
  );
}

export async function readChunk(
  context: ReadContext,
  position: { afterKey: string; chunkRows: number },
): Promise<{ rows: EntryRow[]; lastKey: string | null }> {
  const [packets] = await context.connection.query<RowDataPacket[]>(buildChunkSql(context.source), [
    position.afterKey,
    position.chunkRows,
  ]);
  const rows = toEntryRows(context, packets);
  return { rows, lastKey: rows.at(-1)?.row_key ?? null };
}

export async function readRowsByKey(context: ReadContext, keys: string[]): Promise<EntryRow[]> {
  if (keys.length === 0) return [];
  const [packets] = await context.connection.query<RowDataPacket[]>(buildRowsByKeySql(context.source), [keys]);
  return toEntryRows(context, packets);
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
