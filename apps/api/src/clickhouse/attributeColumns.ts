/** データセットごとの項目を、ClickHouseの列として持つための名前と型。 */
import type { AttributeDefinition, AttributeType } from '../sources/sourceConfig.js';

/** 共通の列と名前がぶつからないよう、項目の列には前置きを付ける。 */
export function attributeColumn(name: string): `attr_${string}` {
  return `attr_${name}`;
}

/** 値の無い行は、文字は空、数や日時はNULLにする。 */
const COLUMN_TYPE_BY_ATTRIBUTE_TYPE: Record<AttributeType, string> = {
  keyword: 'LowCardinality(String)',
  text: 'String CODEC(ZSTD(1))',
  number: 'Nullable(Float64) CODEC(ZSTD(1))',
  datetime: 'Nullable(DateTime) CODEC(ZSTD(1))',
  boolean: 'Nullable(Bool)',
};

export function attributeColumnType(type: AttributeType): string {
  return COLUMN_TYPE_BY_ATTRIBUTE_TYPE[type];
}

/** 項目の列を足すALTERの中身。textの項目は、題名と同じ2文字ごとの全文索引も付ける。 */
export function addAttributeColumnClauses(attributes: AttributeDefinition[]): string[] {
  return attributes.flatMap((attribute) => {
    const column = attributeColumn(attribute.name);
    const addColumn = `ADD COLUMN IF NOT EXISTS ${column} ${attributeColumnType(attribute.type)}`;
    if (attribute.type !== 'text') return [addColumn];
    return [
      addColumn,
      `ADD INDEX IF NOT EXISTS ${column}_text ${column} TYPE text(tokenizer = ngrams(2), preprocessor = lowerUTF8(${column}))`,
    ];
  });
}
