/**
 * ほかのデータセットとの突き合わせをWHERE句にする。
 * 外部のIDが何のIDか（identity）が同じsourceどうしで、外部のIDが相手に在るか無いかを見る。
 */
import type { PeerComparison } from '@mds/contracts';
import { attributeFilterConditions } from './attributeFilterConditions.js';
import type { ConditionField } from './conditionFields.js';
import { InvalidConditionError } from './leafCondition.js';

export interface PeerSource {
  id: string;
  service: string;
  identity: string;
}

export interface PeerContext {
  sources: PeerSource[];
  /** 絞り込みで選んだサービス。空なら、相手と突き合わせられるsourceすべてを比べる側にする。 */
  selectedServices: string[];
  fieldByName: ReadonlyMap<string, ConditionField>;
  /** sourceごとの行数の見積もり。分からないsourceは入っていない。 */
  sourceRows: ReadonlyMap<string, number>;
  parameters: Record<string, unknown>;
}

function totalRows(sourceIds: string[], sourceRows: ReadonlyMap<string, number>): number | null {
  let total = 0;
  for (const id of sourceIds) {
    const rows = sourceRows.get(id);
    if (rows === undefined) return null;
    total += rows;
  }
  return total;
}

/** 比べる側のsource。相手と同じidentityを持ち、相手のサービスではないもの。 */
function comparedSources(peerSources: PeerSource[], context: PeerContext): PeerSource[] {
  const identities = new Set(peerSources.map((source) => source.identity));
  return context.sources.filter(
    (source) =>
      identities.has(source.identity) &&
      !peerSources.includes(source) &&
      (context.selectedServices.length === 0 || context.selectedServices.includes(source.service)),
  );
}

export function peerCondition(peer: PeerComparison, context: PeerContext): string {
  const peerSources = context.sources.filter((source) => source.service === peer.service && source.identity !== '');
  if (peerSources.length === 0) throw new InvalidConditionError(`突き合わせられないサービスです: ${peer.service}`);
  const compared = comparedSources(peerSources, context);
  // 突き合わせられるsourceが無ければ、どの行にも当たらない。
  if (compared.length === 0) return '0';
  const comparedIds = compared.map((source) => source.id);
  const peerIds = peerSources.map((source) => source.id);
  context.parameters.peerSources = peerIds;
  context.parameters.peerComparedSources = comparedIds;

  const peerFilters = attributeFilterConditions({
    filters: peer.filters,
    fieldByName: context.fieldByName,
    parameters: context.parameters,
    parameterPrefix: 'peerAttribute',
  });
  const peerRows = ["source IN {peerSources:Array(String)}", "external_id != ''", ...peerFilters];
  // INの右側はメモリに載る。相手のほうが行が多いときは、比べる側に在るIDだけに先に絞って小さくする。
  const comparedTotal = totalRows(comparedIds, context.sourceRows);
  const peerTotal = totalRows(peerIds, context.sourceRows);
  if (comparedTotal !== null && peerTotal !== null && comparedTotal < peerTotal) {
    peerRows.push('external_id IN (SELECT external_id FROM entries WHERE source IN {peerComparedSources:Array(String)})');
  }
  const membership = peer.presence === 'absent' ? 'NOT IN' : 'IN';
  return `source IN {peerComparedSources:Array(String)} AND external_id ${membership} (SELECT external_id FROM entries WHERE ${peerRows.join(' AND ')})`;
}

/** 外部のIDで突き合わせられるサービスの組。同じidentityを2つ以上のサービスが持つもの。 */
export function comparableServiceGroups(sources: PeerSource[]): string[][] {
  const servicesByIdentity = new Map<string, Set<string>>();
  for (const source of sources) {
    if (!source.identity) continue;
    const services = servicesByIdentity.get(source.identity) ?? new Set<string>();
    services.add(source.service);
    servicesByIdentity.set(source.identity, services);
  }
  return [...servicesByIdentity.values()].filter((services) => services.size > 1).map((services) => [...services]);
}
