/** 前回の取り込みのあとに変わった行のキーを、設定のSELECTで集める。 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { SourceConfig } from '../sources/sourceConfig.js';

/** 前回の開始の少し前から拾い、境目の行を落とさない。 */
const OVERLAP_SECONDS = 3_600;

/**
 * SELECTには、前回の開始からの秒数を渡す。`NOW() - INTERVAL ? SECOND` と書けば、
 * MySQLとこの処理のタイムゾーンが違っても同じ時刻を指す。
 */
export function secondsSince(since: Date, now: Date = new Date()): number {
  return Math.ceil((now.getTime() - since.getTime()) / 1000) + OVERLAP_SECONDS;
}

export async function readChangedKeys(args: { connection: Connection; source: SourceConfig; since: Date }): Promise<string[]> {
  const keys = new Set<string>();
  for (const sql of args.source.changedKeys) {
    const [rows] = await args.connection.query<RowDataPacket[]>({ sql, rowsAsArray: true }, [secondsSince(args.since)]);
    for (const row of rows as unknown as unknown[][]) {
      if (row[0] !== null && row[0] !== undefined) keys.add(String(row[0]));
    }
  }
  return [...keys];
}
