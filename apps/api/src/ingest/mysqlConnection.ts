import mysql, { type Connection, type Pool, type PoolOptions } from 'mysql2/promise';
import type { ApplicationConfig } from '../config.js';

// 日時と大きな整数を文字列のまま受ける。ClickHouseへそのまま渡し、画面でも元の値を見せるため。
const COMMON_OPTIONS: PoolOptions = {
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  charset: 'utf8mb4',
  connectTimeout: 10_000,
};

/** 誤って書き込まないよう、セッションを読み取り専用にする。 */
const READ_ONLY_SESSION_SQL = 'SET SESSION TRANSACTION READ ONLY';

export async function openReadOnlyConnection(config: ApplicationConfig['mysql']): Promise<Connection> {
  const connection = await mysql.createConnection({ ...COMMON_OPTIONS, ...config });
  await connection.query(READ_ONLY_SESSION_SQL);
  return connection;
}

/** 詳細の表示に使う接続。MySQLの接続数はほかの利用者と分け合うので、ごく少なくする。 */
const DETAIL_POOL_CONNECTIONS = 2;

export function createReadOnlyPool(config: ApplicationConfig['mysql']): Pool {
  const pool = mysql.createPool({
    ...COMMON_OPTIONS,
    ...config,
    connectionLimit: DETAIL_POOL_CONNECTIONS,
    maxIdle: 1,
    idleTimeout: 60_000,
  });
  pool.on('connection', (connection) => {
    connection.query(READ_ONLY_SESSION_SQL);
  });
  return pool;
}
