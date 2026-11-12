/** 条件の葉（項目・比べ方・値）をClickHouseのWHERE句にする。値はすべてパラメータで渡す。 */
import { ATTRIBUTE_OPERATORS_BY_TYPE, type AttributeFilter } from '@mds/contracts';
import type { ConditionField } from './conditionFields.js';

/** 定義に無い項目や、型に合わない比べ方・値を指定されたとき。 */
export class InvalidConditionError extends Error {}

/** 1つの葉のWHERE句。 */
export interface LeafCondition {
  /** 条件にちょうど当たる行。 */
  exact: string;
  /** exactに当たる行をすべて含み、索引だけで決まる条件。上位の行の境目と件数に使う。 */
  indexOnly: string;
  /** indexOnlyが、exactに当たらない行も通すとき。 */
  isIndexOnlyBroader: boolean;
}

const SQL_COMPARISON = { equals: '=', notEquals: '!=', atLeast: '>=', atMost: '<=' } as const;
type ComparisonOperator = keyof typeof SQL_COMPARISON;

/** 全文索引は2文字ごとに切っているので、1文字の語は索引で絞れない。3文字以上の語は索引だけでは語が続くか分からない。 */
const TEXT_INDEX_GRAM_CHARACTERS = 2;

function numberValue(filter: AttributeFilter): number {
  const number = Number(filter.value);
  if (filter.value.trim() === '' || !Number.isFinite(number)) {
    throw new InvalidConditionError(`${filter.name} の値が数ではありません`);
  }
  return number;
}

/** 日付だけなら、以上はその日の始まり、以下はその日の終わりにする。 */
function dateTimeValue(filter: AttributeFilter): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter.value)) {
    return `${filter.value} ${filter.operator === 'atMost' ? '23:59:59' : '00:00:00'}`;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(filter.value)) return filter.value.replace('T', ' ');
  throw new InvalidConditionError(`${filter.name} の値が日時ではありません`);
}

function booleanValue(filter: AttributeFilter): boolean {
  if (filter.value === 'true') return true;
  if (filter.value === 'false') return false;
  throw new InvalidConditionError(`${filter.name} の値は true か false です`);
}

function sameForIndex(condition: string): LeafCondition {
  return { exact: condition, indexOnly: condition, isIndexOnlyBroader: false };
}

/** 2文字以上の語は全文索引で候補を絞り、3文字以上ならILIKEで語が続けて現れる行に絞る。 */
function textCondition(column: string, value: string, parameterName: string, parameters: Record<string, unknown>): LeafCondition {
  const characters = [...value].length;
  parameters[parameterName] = value;
  const like = `${column} ILIKE {${parameterName}Like:String}`;
  const indexed = `hasAllTokens(${column}, {${parameterName}:String})`;
  if (characters === TEXT_INDEX_GRAM_CHARACTERS) return sameForIndex(indexed);
  parameters[`${parameterName}Like`] = `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  if (characters < TEXT_INDEX_GRAM_CHARACTERS) return sameForIndex(like);
  return { exact: `${indexed} AND ${like}`, indexOnly: indexed, isIndexOnlyBroader: true };
}

/** parameterNameは、この葉の値を渡すパラメータの名前。 */
export function leafCondition(args: {
  filter: AttributeFilter;
  field: ConditionField;
  parameterName: string;
  parameters: Record<string, unknown>;
}): LeafCondition {
  const { filter, field, parameterName, parameters } = args;
  if (!ATTRIBUTE_OPERATORS_BY_TYPE[field.type].includes(filter.operator)) {
    throw new InvalidConditionError(`${filter.name} には ${filter.operator} を使えません`);
  }
  const comparison = SQL_COMPARISON[filter.operator as ComparisonOperator];
  switch (field.type) {
    case 'keyword':
      parameters[parameterName] = filter.value;
      return sameForIndex(`${field.column} ${comparison} {${parameterName}:String}`);
    case 'text':
      if (filter.value === '') throw new InvalidConditionError(`${filter.name} の値が空です`);
      return textCondition(field.column, filter.value, parameterName, parameters);
    case 'number':
      parameters[parameterName] = numberValue(filter);
      return sameForIndex(`${field.column} ${comparison} {${parameterName}:Float64}`);
    case 'datetime':
      parameters[parameterName] = dateTimeValue(filter);
      return sameForIndex(`${field.column} ${comparison} {${parameterName}:DateTime}`);
    case 'boolean':
      parameters[parameterName] = booleanValue(filter);
      return sameForIndex(`${field.column} = {${parameterName}:Bool}`);
  }
}
