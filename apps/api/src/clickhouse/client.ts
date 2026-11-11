import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { ApplicationConfig } from '../config.js';

export function createClickhouseClient(config: ApplicationConfig['clickhouse']): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    // 取り込みの日時はMySQLの文字列のまま渡す。
    clickhouse_settings: { date_time_input_format: 'best_effort' },
  });
}

/** データベースを作るための、データベースを指定しない接続。 */
export function createClickhouseAdminClient(config: ApplicationConfig['clickhouse']): ClickHouseClient {
  return createClient({ url: config.url, username: config.username, password: config.password });
}
