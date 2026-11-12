/**
 * どの表をどの項目として検索に載せるかの設定。共通の項目（fields）と、データセットごとの項目（attributes）がある。実際の表の名前は運用側のファイルに置き、公開のリポジトリに
 * 入れない。式はSQLのまま書く設定で、書くのは運用者だけなので信頼する。値はすべてプレースホルダで渡す。
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_]+$/);

/** 項目の名前。ClickHouseの列の名前と、検索の条件の名前にそのまま使う。 */
const attributeName = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

const localizedLabel = z.object({ ja: z.string(), en: z.string() });

/**
 * データセットごとに違う項目の定義。同じ名前の項目は、どのsourceでも同じ意味として扱う。
 * keywordは決まった値を取る短い文字、textは検索語で探す文。
 */
const attributeSchema = z.object({
  type: z.enum(['keyword', 'text', 'number', 'datetime', 'boolean']),
  label: localizedLabel,
  // 取りうる値が決まっているとき、選択肢として画面に出す。
  values: z.array(z.object({ value: z.string(), label: localizedLabel })).default([]),
});

export type AttributeDefinition = z.infer<typeof attributeSchema> & { name: string };
export type AttributeType = AttributeDefinition['type'];

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
  // 全件を読み直す間隔。fullの表は書かなければ7日。incrementalの表に書くと、その間隔で全件も読み直す
  // （古い行があとから変わるが、変わった行をchangedKeysで拾えない表に使う）。
  fullEveryDays: z.number().positive().optional(),
  join: z.string().default(''),
  // 外部のIDが何のIDか（どのサイトの何か）。同じidentityで外部のIDが同じ行は、sourceが違っても同じものとして扱う。
  identity: z.string().regex(/^[a-z0-9-]*$/).default(''),
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
  // データセットごとの項目。名前はattributesの定義にあるもの、値はSQLの式。
  attributes: z.record(attributeName, z.string()).default({}),
  // 古い行があとから変わる表で、前回の取り込みのあとに変わった行のキーを返すSELECT。前回の開始からの秒数を1つの ? で受ける。
  changedKeys: z.array(z.string().includes('?')).default([]),
  // 元のページのURL。{externalId} を置き換える。fields.url があればそちらを使う。
  urlTemplate: z.string().optional(),
  // 詳細の画面でも fields.externalId の式を読むので、その式が使う表は detail.join にも書く。
  detail: z
    .object({
      join: z.string().default(''),
      columns: z.array(z.string()).min(1),
      related: z.array(relatedSchema).default([]),
    })
    .optional(),
});

export type SourceConfig = z.infer<typeof sourceSchema>;

const sourcesFileSchema = z.object({
  attributes: z.record(attributeName, attributeSchema).default({}),
  sources: z.array(sourceSchema).min(1),
});

/** 設定ファイルの中身。項目の定義と、取り込み元。 */
export interface SourceCatalog {
  attributes: AttributeDefinition[];
  sources: SourceConfig[];
}

export function parseSourceCatalog(yamlText: string): SourceCatalog {
  const parsed = sourcesFileSchema.parse(parse(yamlText));
  const seen = new Set<string>();
  for (const source of parsed.sources) {
    if (seen.has(source.id)) throw new Error(`source の id が重複しています: ${source.id}`);
    seen.add(source.id);
    for (const name of Object.keys(source.attributes)) {
      if (!(name in parsed.attributes)) throw new Error(`${source.id}: attributes に定義の無い項目です: ${name}`);
    }
  }
  return {
    attributes: Object.entries(parsed.attributes).map(([name, definition]) => ({ name, ...definition })),
    sources: parsed.sources,
  };
}

export function loadSourceCatalog(path: string): SourceCatalog {
  return parseSourceCatalog(readFileSync(path, 'utf8'));
}

/** fullの表を読み直す既定の間隔。 */
const DEFAULT_FULL_EVERY_DAYS = 7;

/** 全件を読み直す間隔。決まった間隔で読み直さない表はnull。 */
export function fullEveryDaysOf(source: SourceConfig): number | null {
  return source.fullEveryDays ?? (source.mode === 'full' ? DEFAULT_FULL_EVERY_DAYS : null);
}

export function sourceUrl(source: SourceConfig, externalId: string, storedUrl: string): string | null {
  if (storedUrl) return storedUrl;
  if (!source.urlTemplate || !externalId) return null;
  return source.urlTemplate.replace('{externalId}', encodeURIComponent(externalId));
}
