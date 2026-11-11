/**
 * どの表をどの項目として検索に載せるかの設定。実際の表の名前は運用側のファイルに置き、公開のリポジトリに
 * 入れない。式はSQLのまま書く設定で、書くのは運用者だけなので信頼する。値はすべてプレースホルダで渡す。
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_]+$/);

const relatedSchema = z.object({
  label: z.string(),
  // 行のキーを1つの ? で受けるSELECT。
  sql: z.string().includes('?'),
});

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  service: z.string(),
  kind: z.string(),
  database: identifier,
  table: identifier,
  key: identifier,
  // incrementalはキーが増えるだけの表（新しい行だけ足す）。fullはキーが連番でない表（全件読み直す）。
  mode: z.enum(['incremental', 'full']).default('incremental'),
  // 詳細の表があとから埋まる行を拾うため、前回の末尾からこの数だけ戻って読み直す。
  rereadRecentKeys: z.number().int().nonnegative().default(0),
  // fullの表を読み直す間隔。
  fullEveryDays: z.number().positive().default(7),
  join: z.string().default(''),
  fields: z.object({
    externalId: z.string().optional(),
    title: z.string().optional(),
    channelName: z.string().optional(),
    channelKey: z.string().optional(),
    language: z.string().optional(),
    durationSeconds: z.string().optional(),
    publishedAt: z.string().optional(),
    url: z.string().optional(),
  }),
  // 元のページのURL。{externalId} を置き換える。fields.url があればそちらを使う。
  urlTemplate: z.string().optional(),
  detail: z
    .object({
      join: z.string().default(''),
      columns: z.array(z.string()).min(1),
      related: z.array(relatedSchema).default([]),
    })
    .optional(),
});

export type SourceConfig = z.infer<typeof sourceSchema>;

const sourcesFileSchema = z.object({ sources: z.array(sourceSchema).min(1) });

export function parseSources(yamlText: string): SourceConfig[] {
  const { sources } = sourcesFileSchema.parse(parse(yamlText));
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) throw new Error(`source の id が重複しています: ${source.id}`);
    seen.add(source.id);
  }
  return sources;
}

export function loadSources(path: string): SourceConfig[] {
  return parseSources(readFileSync(path, 'utf8'));
}

export function sourceUrl(source: SourceConfig, externalId: string, storedUrl: string): string | null {
  if (storedUrl) return storedUrl;
  if (!source.urlTemplate || !externalId) return null;
  return source.urlTemplate.replace('{externalId}', encodeURIComponent(externalId));
}
