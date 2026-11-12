/**
 * ANDとORで組んだ条件を、「ANDだけの条件」をORで並べた形に直す。
 * ClickHouseはORの中に索引の種類が違う条件が混ざると全行を読むので、ORの枝ごとに別のSELECTで読む。
 */
import { isConditionLeaf, type AttributeFilter, type ConditionNode } from '@mds/contracts';
import { SERVICE_FIELD_NAME, type ConditionField } from './conditionFields.js';
import { InvalidConditionError, leafCondition, type LeafCondition } from './leafCondition.js';

/** ORの枝をこれより多くは作らない。枝ごとにSELECTが1つ走るため。 */
export const MAXIMUM_CONDITION_BRANCHES = 16;

/** ANDでつないだ葉の並び。 */
type Conjunction = AttributeFilter[];

function crossProduct(left: Conjunction[], right: Conjunction[]): Conjunction[] {
  const product = left.flatMap((leftConjunction) => right.map((rightConjunction) => [...leftConjunction, ...rightConjunction]));
  if (product.length > MAXIMUM_CONDITION_BRANCHES) {
    throw new InvalidConditionError(`ORの組み合わせが多すぎます（${MAXIMUM_CONDITION_BRANCHES}まで）`);
  }
  return product;
}

/** 「ANDだけの条件」をORで並べた形。 */
export function toBranches(node: ConditionNode): Conjunction[] {
  if (isConditionLeaf(node)) return [[node]];
  if ('any' in node) {
    const branches = node.any.flatMap(toBranches);
    if (branches.length > MAXIMUM_CONDITION_BRANCHES) {
      throw new InvalidConditionError(`ORの組み合わせが多すぎます（${MAXIMUM_CONDITION_BRANCHES}まで）`);
    }
    return branches;
  }
  return node.all.map(toBranches).reduce(crossProduct, [[]]);
}

export interface BranchContext {
  fieldByName: ReadonlyMap<string, ConditionField>;
  /** サービスの名前から、そのサービスの取り込み元のIDを引く。 */
  sourceIdsOfService: (service: string) => string[];
  parameters: Record<string, unknown>;
}

/** サービスは取り込み元（パーティション）で絞る。service列で絞ると、全部のパーティションの索引を読んでしまう。 */
function serviceLeafCondition(filter: AttributeFilter, parameterName: string, context: BranchContext): LeafCondition {
  context.parameters[parameterName] = context.sourceIdsOfService(filter.value);
  const membership = `source ${filter.operator === 'notEquals' ? 'NOT IN' : 'IN'} {${parameterName}:Array(String)}`;
  return { exact: membership, indexOnly: membership, isIndexOnlyBroader: false };
}

/** ORの枝を1つずつWHERE句にする。パラメータの名前は、枝と葉の位置で分ける。 */
export function branchConditions(node: ConditionNode, context: BranchContext): LeafCondition[] {
  return toBranches(node).map((conjunction, branchIndex) => {
    const leaves = conjunction.map((filter, leafIndex) => {
      const field = context.fieldByName.get(filter.name);
      if (!field) throw new InvalidConditionError(`定義の無い項目です: ${filter.name}`);
      const parameterName = `condition${branchIndex}x${leafIndex}`;
      if (field.name === SERVICE_FIELD_NAME && field.type === 'keyword' && filter.operator !== 'contains') {
        return serviceLeafCondition(filter, parameterName, context);
      }
      return leafCondition({ filter, field, parameterName, parameters: context.parameters });
    });
    return {
      exact: leaves.map((leaf) => leaf.exact).join(' AND '),
      indexOnly: leaves.map((leaf) => leaf.indexOnly).join(' AND '),
      isIndexOnlyBroader: leaves.some((leaf) => leaf.isIndexOnlyBroader),
    };
  });
}
