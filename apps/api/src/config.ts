/** 環境変数の読み取り。接頭辞は製品ごとに揃える決まりで、この製品は MDS_。 */
import { z } from 'zod';

const booleanLike = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  NODE_ENV: z.string().default('development'),
  // 4190はfetchの仕様が接続を断るポート（bad port）なので、ヘルスチェックのfetchが失敗する。
  MDS_PORT: z.coerce.number().int().default(4195),
  MDS_PUBLIC_URL: z.url().default('http://127.0.0.1:4195'),
  MDS_WEB_DIRECTORY: z.string().optional(),
  MDS_SOURCES_FILE: z.string().default('config/sources.yaml'),

  MDS_CLICKHOUSE_URL: z.url().default('http://127.0.0.1:18123'),
  MDS_CLICKHOUSE_USER: z.string().default('default'),
  MDS_CLICKHOUSE_PASSWORD: z.string().default(''),
  MDS_CLICKHOUSE_DATABASE: z.string().default('mado_data_search'),

  // ClickHouseに割り当てたCPUの数に合わせる。
  MDS_SEARCH_MAX_THREADS: z.coerce.number().int().positive().default(4),

  MDS_MYSQL_HOST: z.string().default('127.0.0.1'),
  MDS_MYSQL_PORT: z.coerce.number().int().default(3306),
  MDS_MYSQL_USER: z.string().default('mado_data_search'),
  MDS_MYSQL_PASSWORD: z.string().default(''),

  MDS_INGEST_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  // MySQLのbuffer poolをほかの利用者と分け合うので、取り込みの読みを絞る。
  MDS_INGEST_MAX_MEGABYTES_PER_SECOND: z.coerce.number().positive().default(20),
  MDS_INGEST_CHUNK_ROWS: z.coerce.number().int().positive().default(20_000),

  MDS_AUTH_MODE: z.enum(['oidc', 'disabled']).default('oidc'),
  MDS_SESSION_SECRET: z.string().min(32).optional(),
  MDS_OIDC_ISSUER: z.url().optional(),
  MDS_OIDC_CLIENT_ID: z.string().optional(),
  MDS_OIDC_CLIENT_SECRET: z.string().optional(),
  MDS_OIDC_SCOPES: z.string().default('openid email profile'),
  // ログインの可否はIdPのグループだけで決める。ロールは持たない。
  MDS_OIDC_ALLOWED_GROUP: z.string().optional(),
  MDS_COOKIE_SECURE: booleanLike.default(true),
});

export type ApplicationConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  if (parsed.MDS_AUTH_MODE === 'disabled' && parsed.NODE_ENV === 'production') {
    throw new Error('MDS_AUTH_MODE=disabled は本番では使えません');
  }
  if (parsed.MDS_AUTH_MODE === 'oidc') {
    for (const name of [
      'MDS_SESSION_SECRET',
      'MDS_OIDC_ISSUER',
      'MDS_OIDC_CLIENT_ID',
      'MDS_OIDC_CLIENT_SECRET',
      'MDS_OIDC_ALLOWED_GROUP',
    ] as const) {
      if (!parsed[name]) throw new Error(`MDS_AUTH_MODE=oidc には ${name} が要ります`);
    }
  }
  return {
    environment: parsed.NODE_ENV,
    port: parsed.MDS_PORT,
    publicUrl: parsed.MDS_PUBLIC_URL,
    webDirectory: parsed.MDS_WEB_DIRECTORY,
    sourcesFile: parsed.MDS_SOURCES_FILE,
    clickhouse: {
      url: parsed.MDS_CLICKHOUSE_URL,
      username: parsed.MDS_CLICKHOUSE_USER,
      password: parsed.MDS_CLICKHOUSE_PASSWORD,
      database: parsed.MDS_CLICKHOUSE_DATABASE,
    },
    search: { maximumThreads: parsed.MDS_SEARCH_MAX_THREADS },
    mysql: {
      host: parsed.MDS_MYSQL_HOST,
      port: parsed.MDS_MYSQL_PORT,
      user: parsed.MDS_MYSQL_USER,
      password: parsed.MDS_MYSQL_PASSWORD,
    },
    ingest: {
      intervalHours: parsed.MDS_INGEST_INTERVAL_HOURS,
      maximumMegabytesPerSecond: parsed.MDS_INGEST_MAX_MEGABYTES_PER_SECOND,
      chunkRows: parsed.MDS_INGEST_CHUNK_ROWS,
    },
    auth: {
      mode: parsed.MDS_AUTH_MODE,
      sessionSecret: parsed.MDS_SESSION_SECRET ?? '',
      issuer: parsed.MDS_OIDC_ISSUER ?? '',
      clientId: parsed.MDS_OIDC_CLIENT_ID ?? '',
      clientSecret: parsed.MDS_OIDC_CLIENT_SECRET ?? '',
      scopes: parsed.MDS_OIDC_SCOPES,
      allowedGroup: parsed.MDS_OIDC_ALLOWED_GROUP ?? '',
      cookieSecure: parsed.MDS_COOKIE_SECURE,
    },
  };
}
