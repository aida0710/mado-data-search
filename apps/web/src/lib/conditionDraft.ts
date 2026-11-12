/**
 * 条件を組む欄の下書き。画面では「行（項目・比べ方・値）をANDかORでつないだまとまり」を、さらにANDかORでつなぐ。
 * 下書きには値がまだ空の行もあるので、URLの条件（ConditionNode）とは別の形で持つ。
 */
import { conditionChildren, isConditionLeaf, type AttributeFilter, type AttributeOperator, type ConditionNode } from '@mds/contracts';

export type Combinator = 'all' | 'any';

export interface DraftRow {
  name: string;
  operator: AttributeOperator;
  value: string;
}

export interface DraftGroup {
  combinator: Combinator;
  rows: DraftRow[];
}

export interface ConditionDraft {
  combinator: Combinator;
  groups: DraftGroup[];
}

export const EMPTY_DRAFT: ConditionDraft = { combinator: 'all', groups: [] };

function combinatorOf(node: ConditionNode): Combinator {
  return 'any' in node ? 'any' : 'all';
}

/** まとまりの中にさらにまとまりがある条件は、画面の2段の形に収まらない。 */
function groupOf(node: ConditionNode): DraftGroup | null {
  if (isConditionLeaf(node)) return { combinator: 'all', rows: [node] };
  const children = conditionChildren(node);
  if (!children.every(isConditionLeaf)) return null;
  return { combinator: combinatorOf(node), rows: children };
}

/** URLの条件を下書きにする。2段より深い条件は、画面で組めないのでnull。 */
export function draftOfCondition(node: ConditionNode | null): ConditionDraft | null {
  if (!node) return EMPTY_DRAFT;
  const single = groupOf(node);
  if (single) return { combinator: 'all', groups: [single] };
  const groups = conditionChildren(node).map(groupOf);
  if (groups.some((group) => group === null)) return null;
  return { combinator: combinatorOf(node), groups: groups as DraftGroup[] };
}

function nodeOf(combinator: Combinator, children: ConditionNode[]): ConditionNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return combinator === 'any' ? { any: children } : { all: children };
}

/** 下書きをURLの条件にする。値が空の行と、行の無いまとまりは捨てる。 */
export function conditionOfDraft(draft: ConditionDraft): ConditionNode | null {
  const groups = draft.groups.flatMap((group) => {
    const leaves: AttributeFilter[] = group.rows.filter((row) => row.name !== '' && row.value.trim() !== '');
    const node = nodeOf(group.combinator, leaves);
    return node ? [node] : [];
  });
  return nodeOf(draft.combinator, groups);
}
