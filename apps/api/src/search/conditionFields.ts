/** 条件に使える項目と、その項目を持つClickHouseの列。どの表にもある項目と、設定で定義した項目を1つの並びにする。 */
import type { AttributeDefinition as ConditionFieldDefinition } from '@mds/contracts';
import { attributeColumn } from '../clickhouse/attributeColumns.js';
import type { AttributeDefinition, SourceCatalog } from '../sources/sourceConfig.js';

/** 条件の葉をSQLにするのに要る、項目の情報。 */
export interface ConditionField {
  name: string;
  type: ConditionFieldDefinition['type'];
  column: string;
}

interface CommonField extends ConditionField {
  label: ConditionFieldDefinition['label'];
}

/** サービスは列でなく取り込み元（パーティション）で絞るので、別に扱う。 */
export const SERVICE_FIELD_NAME = 'service';

const COMMON_FIELDS: CommonField[] = [
  { name: 'title', type: 'text', column: 'title', label: { ja: 'タイトル', en: 'Title' } },
  { name: 'channel', type: 'text', column: 'channel_name', label: { ja: 'チャンネル', en: 'Channel' } },
  { name: 'external_id', type: 'keyword', column: 'external_id', label: { ja: 'ID', en: 'ID' } },
  { name: SERVICE_FIELD_NAME, type: 'keyword', column: 'service', label: { ja: 'サービス', en: 'Service' } },
  { name: 'kind', type: 'keyword', column: 'kind', label: { ja: '種類', en: 'Kind' } },
  { name: 'language', type: 'keyword', column: 'language', label: { ja: '言語', en: 'Language' } },
  { name: 'published_at', type: 'datetime', column: 'published_at', label: { ja: '日付', en: 'Date' } },
  { name: 'duration_seconds', type: 'number', column: 'duration_seconds', label: { ja: '長さ（秒）', en: 'Duration (seconds)' } },
];

function distinctValues(values: string[]): ConditionFieldDefinition['values'] {
  return [...new Set(values)].sort().map((value) => ({ value, label: { ja: value, en: value } }));
}

/** 画面へ返す、条件に使える項目の定義。サービスと種類は、設定にある値を選択肢にする。 */
export function conditionFieldDefinitions(catalog: SourceCatalog): ConditionFieldDefinition[] {
  const choices: Record<string, ConditionFieldDefinition['values']> = {
    [SERVICE_FIELD_NAME]: distinctValues(catalog.sources.map((source) => source.service)),
    kind: distinctValues(catalog.sources.map((source) => source.kind)),
  };
  const common = COMMON_FIELDS.map((field) => ({
    name: field.name,
    type: field.type,
    label: field.label,
    values: choices[field.name] ?? [],
    services: [],
  }));
  const attributes = catalog.attributes.map((attribute) => ({
    ...attribute,
    services: [...new Set(catalog.sources.filter((source) => attribute.name in source.attributes).map((source) => source.service))],
  }));
  return [...common, ...attributes];
}

/** 名前から項目を引く。同じ名前があれば、どの表にもある項目が先。 */
export function conditionFieldsByName(attributes: Pick<AttributeDefinition, 'name' | 'type'>[]): Map<string, ConditionField> {
  const fields = new Map<string, ConditionField>();
  for (const attribute of attributes) {
    fields.set(attribute.name, { name: attribute.name, type: attribute.type, column: attributeColumn(attribute.name) });
  }
  for (const field of COMMON_FIELDS) fields.set(field.name, { name: field.name, type: field.type, column: field.column });
  return fields;
}
