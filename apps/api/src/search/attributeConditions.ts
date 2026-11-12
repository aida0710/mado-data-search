/** データセットごとの項目の条件をClickHouseのWHERE句にする。値はすべてパラメータで渡す。 */
import { ATTRIBUTE_OPERATORS_BY_TYPE, type AttributeFilter } from '@mds/contracts';
import { attributeColumn } from '../clickhouse/attributeColumns.js';
import type { AttributeDefinition } from '../sources/sourceConfig.js';

/** 定義に無い項目や、型に合わない比べ方・値を指定されたとき。 */
export class InvalidAttributeFilterError extends Error {}

const SQL_COMPARISON = { equals: '=', atLeast: '>=', atMost: '<=' } as const;

function numberValue(filter: AttributeFilter): number {
  const number = Number(filter.value);
  if (filter.value.trim() === '' || !Number.isFinite(number)) {
    throw new InvalidAttributeFilterError(`${filter.name} の値が数ではありません`);
  }
  return number;
}

/** 日付だけなら、以上はその日の始まり、以下はその日の終わりにする。 */
function dateTimeValue(filter: AttributeFilter): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter.value)) {
    return `${filter.value} ${filter.operator === 'atMost' ? '23:59:59' : '00:00:00'}`;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(filter.value)) return filter.value.replace('T', ' ');
  throw new InvalidAttributeFilterError(`${filter.name} の値が日時ではありません`);
}

function booleanValue(filter: AttributeFilter): boolean {
  if (filter.value === 'true') return true;
  if (filter.value === 'false') return false;
  throw new InvalidAttributeFilterError(`${filter.name} の値は true か false です`);
}

/** 1つの条件。parameterNameは、この条件の値を渡すパラメータの名前。 */
function conditionOf(args: {
  filter: AttributeFilter;
  definition: AttributeDefinition;
  parameterName: string;
  parameters: Record<string, unknown>;
}): string {
  const { filter, definition, parameterName, parameters } = args;
  const column = attributeColumn(definition.name);
  if (!ATTRIBUTE_OPERATORS_BY_TYPE[definition.type].includes(filter.operator)) {
    throw new InvalidAttributeFilterError(`${filter.name} には ${filter.operator} を使えません`);
  }
  switch (definition.type) {
    case 'keyword':
      parameters[parameterName] = filter.value;
      return `${column} = {${parameterName}:String}`;
    case 'text':
      // 2文字以上の語は全文索引で候補を絞り、ILIKEで語が続けて現れる行に絞る。
      parameters[parameterName] = filter.value;
      parameters[`${parameterName}Like`] = `%${filter.value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      return [...filter.value].length < 2
        ? `${column} ILIKE {${parameterName}Like:String}`
        : `hasAllTokens(${column}, {${parameterName}:String}) AND ${column} ILIKE {${parameterName}Like:String}`;
    case 'number':
      parameters[parameterName] = numberValue(filter);
      return `${column} ${SQL_COMPARISON[filter.operator as keyof typeof SQL_COMPARISON]} {${parameterName}:Float64}`;
    case 'datetime':
      parameters[parameterName] = dateTimeValue(filter);
      return `${column} ${SQL_COMPARISON[filter.operator as keyof typeof SQL_COMPARISON]} {${parameterName}:DateTime}`;
    case 'boolean':
      parameters[parameterName] = booleanValue(filter);
      return `${column} = {${parameterName}:Bool}`;
  }
}

/**
 * 項目の条件。同じ項目の「一致」が複数あれば、どれかに当たればよい（選択肢を複数選んだとき）。
 * それ以外の条件は、全部に当たる行だけを残す。
 */
export function attributeConditions(
  filters: AttributeFilter[],
  definitions: AttributeDefinition[],
  parameters: Record<string, unknown>,
): string[] {
  const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
  const equalsByName = new Map<string, string[]>();
  const conditions: string[] = [];
  filters.forEach((filter, index) => {
    const definition = definitionByName.get(filter.name);
    if (!definition) throw new InvalidAttributeFilterError(`定義の無い項目です: ${filter.name}`);
    const condition = conditionOf({ filter, definition, parameterName: `attribute${index}`, parameters });
    if (filter.operator !== 'equals') {
      conditions.push(condition);
      return;
    }
    equalsByName.set(filter.name, [...(equalsByName.get(filter.name) ?? []), condition]);
  });
  for (const alternatives of equalsByName.values()) {
    conditions.push(alternatives.length === 1 ? (alternatives[0] as string) : `(${alternatives.join(' OR ')})`);
  }
  return conditions;
}
