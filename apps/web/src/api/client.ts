/** APIの呼び出し。応答の形はzodで確かめる。 */
import {
  EntryDetailSchema,
  IngestStatusResponseSchema,
  OverviewResponseSchema,
  SearchCountResponseSchema,
  SearchResponseSchema,
  SessionResponseSchema,
} from '@mds/contracts';
import { fetchResponse, jsonRequestInit, requestJson } from '@mado/design-system/http';

/** ログインの期限が切れたら、ログイン画面へ戻すために読み直す。 */
const onUnauthorized = () => window.location.reload();

export const api = {
  session: (signal: AbortSignal) =>
    requestJson('/api/auth/session', { schema: SessionResponseSchema, init: { signal } }),
  logout: () => fetchResponse('/api/auth/logout', { init: jsonRequestInit('POST') }),
  search: (parameters: URLSearchParams, signal: AbortSignal) =>
    requestJson(`/api/search?${parameters}`, { schema: SearchResponseSchema, onUnauthorized, init: { signal } }),
  searchCount: (parameters: URLSearchParams, signal: AbortSignal) =>
    requestJson(`/api/search/count?${parameters}`, { schema: SearchCountResponseSchema, onUnauthorized, init: { signal } }),
  overview: (signal: AbortSignal) =>
    requestJson('/api/overview', { schema: OverviewResponseSchema, onUnauthorized, init: { signal } }),
  entry: (source: string, rowKey: string, signal: AbortSignal) =>
    requestJson(`/api/entries/${encodeURIComponent(source)}/${encodeURIComponent(rowKey)}`, {
      schema: EntryDetailSchema,
      onUnauthorized,
      init: { signal },
    }),
  ingestStatus: (signal: AbortSignal) =>
    requestJson('/api/ingest/status', { schema: IngestStatusResponseSchema, onUnauthorized, init: { signal } }),
};
