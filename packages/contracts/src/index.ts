/** APIと画面が共有する入出力の定義。 */
import { z } from 'zod';

/** 1ページの最大の件数。これを超えると検索のたびに転送する量が増えるだけで、人は読めない。 */
export const MAXIMUM_SEARCH_PAGE_SIZE = 100;
/** ページ送りで辿れる最大の位置。深い位置はClickHouseが捨てる行を読むだけになるので、絞り込みを促す。 */
export const MAXIMUM_SEARCH_OFFSET = 10_000;
/** 検索語の最大の長さ。 */
export const MAXIMUM_QUERY_LENGTH = 200;

export const SearchFieldSchema = z.enum(['all', 'title', 'channel', 'id']);
export type SearchField = z.infer<typeof SearchFieldSchema>;

export const SearchSortSchema = z.enum(['newest', 'oldest']);
export type SearchSort = z.infer<typeof SearchSortSchema>;

const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** データセットごとの項目の型。keywordは決まった値を取る短い文字、textは検索語で探す文。 */
export const AttributeTypeSchema = z.enum(['keyword', 'text', 'number', 'datetime', 'boolean']);
export type AttributeType = z.infer<typeof AttributeTypeSchema>;

/** 項目の比べ方。equalsは一致、notEqualsは不一致、containsは語を含む、atLeastとatMostは以上と以下。 */
export const AttributeOperatorSchema = z.enum(['equals', 'notEquals', 'contains', 'atLeast', 'atMost']);
export type AttributeOperator = z.infer<typeof AttributeOperatorSchema>;

/** 項目の型ごとに使える比べ方。 */
export const ATTRIBUTE_OPERATORS_BY_TYPE: Record<AttributeType, readonly AttributeOperator[]> = {
  keyword: ['equals', 'notEquals'],
  text: ['contains'],
  number: ['equals', 'notEquals', 'atLeast', 'atMost'],
  datetime: ['atLeast', 'atMost'],
  boolean: ['equals'],
};

/** 絞り込みに使える項目の条件の最大の数。 */
export const MAXIMUM_ATTRIBUTE_FILTERS = 20;

export const AttributeFilterSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  operator: AttributeOperatorSchema,
  value: z.string().max(200),
});
export type AttributeFilter = z.infer<typeof AttributeFilterSchema>;

const ATTRIBUTE_FILTER_SEPARATOR = ':';

/** URLに載せる形（名前:比べ方:値）。値には区切りの文字が入ってよい。 */
export function formatAttributeFilter(filter: AttributeFilter): string {
  return [filter.name, filter.operator, filter.value].join(ATTRIBUTE_FILTER_SEPARATOR);
}

export function parseAttributeFilter(text: string): AttributeFilter | null {
  const [name, operator, ...valueParts] = text.split(ATTRIBUTE_FILTER_SEPARATOR);
  const parsed = AttributeFilterSchema.safeParse({ name, operator, value: valueParts.join(ATTRIBUTE_FILTER_SEPARATOR) });
  return parsed.success ? parsed.data : null;
}

/**
 * ANDとORで組んだ条件。allは全部に当たる行、anyはどれかに当たる行。
 * 葉は「項目・比べ方・値」で、項目はどの表にもある項目かデータセットごとの項目の名前。
 */
export type ConditionNode = { all: ConditionNode[] } | { any: ConditionNode[] } | AttributeFilter;

/** 組める条件の深さと、葉の数の上限。 */
export const MAXIMUM_CONDITION_DEPTH = 4;
export const MAXIMUM_CONDITION_LEAVES = 30;

export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionNodeSchema).min(1) }).strict(),
    z.object({ any: z.array(ConditionNodeSchema).min(1) }).strict(),
    AttributeFilterSchema.strict(),
  ]),
);

export function isConditionLeaf(node: ConditionNode): node is AttributeFilter {
  return 'name' in node;
}

export function conditionChildren(node: ConditionNode): ConditionNode[] {
  if ('all' in node) return node.all;
  if ('any' in node) return node.any;
  return [];
}

export function conditionDepth(node: ConditionNode): number {
  return isConditionLeaf(node) ? 0 : 1 + Math.max(0, ...conditionChildren(node).map(conditionDepth));
}

export function conditionLeafCount(node: ConditionNode): number {
  return isConditionLeaf(node) ? 1 : conditionChildren(node).reduce((sum, child) => sum + conditionLeafCount(child), 0);
}

/** URLに載せた条件を読む。形が違う、深すぎる、葉が多すぎるときはnull。 */
export function parseCondition(text: string): ConditionNode | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ConditionNodeSchema.safeParse(json);
  if (!parsed.success) return null;
  if (conditionDepth(parsed.data) > MAXIMUM_CONDITION_DEPTH || conditionLeafCount(parsed.data) > MAXIMUM_CONDITION_LEAVES) return null;
  return parsed.data;
}

export const SearchRequestSchema = z.object({
  query: z.string().trim().max(MAXIMUM_QUERY_LENGTH).default(''),
  field: SearchFieldSchema.default('all'),
  services: z.array(z.string().max(64)).default([]),
  kinds: z.array(z.string().max(64)).default([]),
  languages: z.array(z.string().max(16)).default([]),
  /** 同じ名前で一致の条件が複数あれば、どれかに当たる行。それ以外は全部に当たる行。 */
  attributeFilters: z.array(AttributeFilterSchema).max(MAXIMUM_ATTRIBUTE_FILTERS).default([]),
  /** ANDとORで組んだ条件。ほかの絞り込みとはANDでつなぐ。 */
  condition: ConditionNodeSchema.optional(),
  publishedFrom: CalendarDateSchema.optional(),
  publishedTo: CalendarDateSchema.optional(),
  sort: SearchSortSchema.default('newest'),
  offset: z.coerce.number().int().min(0).max(MAXIMUM_SEARCH_OFFSET).default(0),
  limit: z.coerce.number().int().min(1).max(MAXIMUM_SEARCH_PAGE_SIZE).default(50),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const SearchEntrySchema = z.object({
  source: z.string(),
  service: z.string(),
  kind: z.string(),
  rowKey: z.string(),
  externalId: z.string(),
  title: z.string(),
  channelName: z.string(),
  language: z.string(),
  durationSeconds: z.number(),
  publishedAt: z.string().nullable(),
  url: z.string().nullable(),
  /** そのデータセットが持つ項目の値。値の無い項目は入らない。 */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type SearchEntry = z.infer<typeof SearchEntrySchema>;

export const SearchResponseSchema = z.object({
  entries: z.array(SearchEntrySchema),
  elapsedMilliseconds: z.number(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** 件数は数えるのに時間がかかるので、結果とは別に返す。 */
export const SearchCountResponseSchema = z.object({
  /** 一致した件数。数えるのに時間がかかりすぎたときはnull。 */
  total: z.number().nullable(),
  /** 件数を索引だけで数えていて、実際の件数がこれより少ないことがあるとき。 */
  isUpperBound: z.boolean(),
});
export type SearchCountResponse = z.infer<typeof SearchCountResponseSchema>;

const LocalizedLabelSchema = z.object({ ja: z.string(), en: z.string() });

/** データセットごとの項目の定義。画面はこれを見て、絞り込みの欄を組み立てる。 */
export const AttributeDefinitionSchema = z.object({
  name: z.string(),
  type: AttributeTypeSchema,
  label: LocalizedLabelSchema,
  values: z.array(z.object({ value: z.string(), label: LocalizedLabelSchema })),
  /** この項目を持つサービス。 */
  services: z.array(z.string()),
});
export type AttributeDefinition = z.infer<typeof AttributeDefinitionSchema>;

export const AttributesResponseSchema = z.object({
  attributes: z.array(AttributeDefinitionSchema),
  /** 条件を組むときに選べる項目。どの表にもある項目（servicesが空）と、データセットごとの項目。 */
  conditionFields: z.array(AttributeDefinitionSchema),
});
export type AttributesResponse = z.infer<typeof AttributesResponseSchema>;

export const FacetCountSchema = z.object({ value: z.string(), count: z.number() });

export const OverviewResponseSchema = z.object({
  totalEntries: z.number(),
  services: z.array(FacetCountSchema),
  kinds: z.array(FacetCountSchema),
  languages: z.array(FacetCountSchema),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

export const EntryDetailSchema = z.object({
  source: z.string(),
  service: z.string(),
  kind: z.string(),
  rowKey: z.string(),
  url: z.string().nullable(),
  columns: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
  related: z.array(
    z.object({
      label: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string().nullable())),
      isTruncated: z.boolean(),
    }),
  ),
});
export type EntryDetail = z.infer<typeof EntryDetailSchema>;

export const IngestRunStatusSchema = z.enum(['running', 'succeeded', 'failed']);
export type IngestRunStatus = z.infer<typeof IngestRunStatusSchema>;

export const IngestSourceStatusSchema = z.object({
  id: z.string(),
  service: z.string(),
  kind: z.string(),
  mode: z.enum(['incremental', 'full']),
  entryCount: z.number(),
  lastRun: z
    .object({
      status: IngestRunStatusSchema,
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      rowsRead: z.number(),
      error: z.string(),
    })
    .nullable(),
});
export type IngestSourceStatus = z.infer<typeof IngestSourceStatusSchema>;

export const IngestStatusResponseSchema = z.object({
  intervalHours: z.number(),
  sources: z.array(IngestSourceStatusSchema),
});
export type IngestStatusResponse = z.infer<typeof IngestStatusResponseSchema>;

export const SessionResponseSchema = z.object({
  authMode: z.enum(['oidc', 'disabled']),
  user: z.object({ name: z.string(), email: z.string() }).nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
