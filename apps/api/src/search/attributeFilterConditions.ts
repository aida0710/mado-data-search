/** 選択肢で選んだ項目の絞り込み（attribute パラメータ）をWHERE句にする。 */
import type { AttributeFilter } from '@mds/contracts';
import type { ConditionField } from './conditionFields.js';
import { InvalidConditionError, leafCondition } from './leafCondition.js';

/**
 * 同じ項目の「一致」が複数あれば、どれかに当たればよい（選択肢を複数選んだとき）。
 * それ以外の条件は、全部に当たる行だけを残す。
 */
export function attributeFilterConditions(args: {
  filters: AttributeFilter[];
  fieldByName: ReadonlyMap<string, ConditionField>;
  parameters: Record<string, unknown>;
  /** 値を渡すパラメータの名前の前置き。同じ検索で2組の絞り込みを作るときに分ける。 */
  parameterPrefix: string;
}): string[] {
  const { filters, fieldByName, parameters } = args;
  const equalsByName = new Map<string, string[]>();
  const conditions: string[] = [];
  filters.forEach((filter, index) => {
    const field = fieldByName.get(filter.name);
    if (!field) throw new InvalidConditionError(`定義の無い項目です: ${filter.name}`);
    const { exact } = leafCondition({ filter, field, parameterName: `${args.parameterPrefix}${index}`, parameters });
    if (filter.operator !== 'equals') {
      conditions.push(exact);
      return;
    }
    equalsByName.set(filter.name, [...(equalsByName.get(filter.name) ?? []), exact]);
  });
  for (const alternatives of equalsByName.values()) {
    conditions.push(alternatives.length === 1 ? (alternatives[0] as string) : `(${alternatives.join(' OR ')})`);
  }
  return conditions;
}
