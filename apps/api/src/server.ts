import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createOidcClient } from './auth/oidc.js';
import { createClickhouseClient } from './clickhouse/client.js';
import { ensureSchema } from './clickhouse/schema.js';
import { loadConfig } from './config.js';
import { createDetailService } from './detail/detailService.js';
import { createIngestStatusService } from './ingest/ingestStatusService.js';
import { createReadOnlyPool } from './ingest/mysqlConnection.js';
import { createSearchService } from './search/searchService.js';
import { loadSourceCatalog } from './sources/sourceConfig.js';

const config = loadConfig();
const catalog = loadSourceCatalog(config.sourcesFile);
const { sources } = catalog;
const clickhouse = createClickhouseClient(config.clickhouse);
await ensureSchema(config.clickhouse, clickhouse, catalog.attributes);

const app = createApp(config, {
  search: createSearchService(clickhouse, catalog, config.search),
  detail: createDetailService(createReadOnlyPool(config.mysql), sources),
  ingestStatus: createIngestStatusService(clickhouse, sources, config.ingest.intervalHours),
  oidc: config.auth.mode === 'oidc' ? createOidcClient(config.auth, config.publicUrl) : null,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`mado Data Search API: ${info.port}`);
});
