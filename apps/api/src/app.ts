/** HTTPの入口。入力の検証→サービスの呼び出し→結果の変換だけを行う。 */
import { SearchRequestSchema } from '@mds/contracts';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ApplicationConfig } from './config.js';
import type { OidcClient } from './auth/oidc.js';
import type { DetailService } from './detail/detailService.js';
import type { IngestStatusService } from './ingest/ingestStatusService.js';
import { createAuthRoutes, createSessionReader, SESSION_COOKIE } from './routes/authRoutes.js';
import type { SearchService } from './search/searchService.js';

export interface ApplicationServices {
  search: SearchService;
  detail: DetailService;
  ingestStatus: IngestStatusService;
  oidc: OidcClient | null;
}

export function createApp(config: ApplicationConfig, services: ApplicationServices) {
  const app = new Hono();
  const readSession = createSessionReader(config.auth);

  app.get('/healthz', (context) => context.json({ ok: true }));
  app.route('/api/auth', createAuthRoutes(config.auth, services.oidc));

  const api = new Hono();
  api.use(async (context, next) => {
    const user = await readSession(getCookie(context, SESSION_COOKIE));
    if (!user) return context.json({ error: 'ログインが必要です', code: 'unauthorized' }, 401);
    await next();
  });

  const parseSearchRequest = (requestUrl: string) => {
    const url = new URL(requestUrl);
    return SearchRequestSchema.safeParse({
      query: url.searchParams.get('query') ?? undefined,
      field: url.searchParams.get('field') ?? undefined,
      services: url.searchParams.getAll('service'),
      kinds: url.searchParams.getAll('kind'),
      languages: url.searchParams.getAll('language'),
      publishedFrom: url.searchParams.get('publishedFrom') ?? undefined,
      publishedTo: url.searchParams.get('publishedTo') ?? undefined,
      sort: url.searchParams.get('sort') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
  };
  const invalidSearchRequest = { error: '検索の条件が正しくありません', code: 'invalid_request' } as const;

  api.get('/search', async (context) => {
    const parsed = parseSearchRequest(context.req.url);
    if (!parsed.success) return context.json(invalidSearchRequest, 400);
    return context.json(await services.search.search(parsed.data));
  });

  api.get('/search/count', async (context) => {
    const parsed = parseSearchRequest(context.req.url);
    if (!parsed.success) return context.json(invalidSearchRequest, 400);
    return context.json(await services.search.count(parsed.data));
  });

  api.get('/overview', async (context) => context.json(await services.search.overview()));

  api.get('/entries/:source/:rowKey', async (context) => {
    const detail = await services.detail.read(context.req.param('source'), context.req.param('rowKey'));
    if (!detail) return context.json({ error: '見つかりません', code: 'not_found' }, 404);
    return context.json(detail);
  });

  api.get('/ingest/status', async (context) => context.json(await services.ingestStatus.read()));

  app.route('/api', api);

  app.onError((failure, context) => {
    console.error(failure);
    return context.json({ error: failure.message, code: 'internal_error' }, 500);
  });

  if (config.webDirectory) {
    app.use('/*', serveStatic({ root: config.webDirectory }));
    // 画面の経路はブラウザ側で解決するので、ファイルが無いときはindex.htmlを返す。
    app.get('*', serveStatic({ path: `${config.webDirectory}/index.html` }));
  }
  return app;
}
