/** 詳細を開いたときだけ、MySQLから主キーで1行と関連する行を読む。長い列はClickHouseに写していない。 */
import type { EntryDetail } from '@mds/contracts';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { sourceUrl, type SourceConfig } from '../sources/sourceConfig.js';

/** 関連する行の上限。多いものでも画面で読める分だけあればよい。 */
const MAXIMUM_RELATED_ROWS = 200;
/** MySQLで長く走らせないための上限。主キーか索引で引く問い合わせだけを想定している。 */
const DETAIL_QUERY_TIMEOUT_MILLISECONDS = 5_000;

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 元のページのURLを作るための外部のIDを、詳細の列と名前がぶつからない別名で読む。 */
const EXTERNAL_ID_ALIAS = 'mds_external_id';

export function createDetailService(pool: Pool, sources: SourceConfig[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  async function readRelated(related: { label: string; sql: string }, rowKey: string) {
    const [rows, fields] = await pool.query<RowDataPacket[]>(
      {
        sql: `SELECT * FROM (${related.sql}) AS related_rows LIMIT ${MAXIMUM_RELATED_ROWS + 1}`,
        timeout: DETAIL_QUERY_TIMEOUT_MILLISECONDS,
      },
      [rowKey],
    );
    const columns = fields.map((field) => field.name);
    return {
      label: related.label,
      columns,
      rows: rows.slice(0, MAXIMUM_RELATED_ROWS).map((row) => columns.map((column) => cellText(row[column]))),
      isTruncated: rows.length > MAXIMUM_RELATED_ROWS,
    };
  }

  return {
    async read(sourceId: string, rowKey: string): Promise<EntryDetail | null> {
      const source = sourceById.get(sourceId);
      if (!source?.detail) return null;
      const [rows, fields] = await pool.query<RowDataPacket[]>(
        {
          sql: `SELECT ${source.fields.externalId ?? "''"} AS ${EXTERNAL_ID_ALIAS}, ${source.detail.columns.join(', ')}
            FROM \`${source.database}\`.\`${source.table}\` t ${source.detail.join}
            WHERE t.\`${source.key}\` = ? LIMIT 1`,
          timeout: DETAIL_QUERY_TIMEOUT_MILLISECONDS,
        },
        [rowKey],
      );
      const row = rows[0];
      if (!row) return null;
      const related = await Promise.all(source.detail.related.map((item) => readRelated(item, rowKey)));
      return {
        source: source.id,
        service: source.service,
        kind: source.kind,
        rowKey,
        url: sourceUrl(source, cellText(row[EXTERNAL_ID_ALIAS]) ?? '', ''),
        columns: fields
          .filter((field) => field.name !== EXTERNAL_ID_ALIAS)
          .map((field) => ({ name: field.name, value: cellText(row[field.name]) })),
        related,
      };
    },
  };
}

export type DetailService = ReturnType<typeof createDetailService>;
