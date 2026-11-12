/** ほかのデータセットとの突き合わせを、URLの peer と peerAttribute パラメータに持つ。 */
import { formatAttributeFilter, formatPeer, parseAttributeFilter, parsePeer, type AttributeFilter, type PeerComparison } from '@mds/contracts';
import { withoutOffset } from './searchUrl';

export const PEER_PARAMETER = 'peer';
export const PEER_ATTRIBUTE_PARAMETER = 'peerAttribute';

export function peerOf(parameters: URLSearchParams): PeerComparison | null {
  const text = parameters.get(PEER_PARAMETER);
  if (!text) return null;
  return parsePeer(text, parameters.getAll(PEER_ATTRIBUTE_PARAMETER).flatMap((value) => parseAttributeFilter(value) ?? []));
}

/** 突き合わせを入れ替える。nullなら外す。値が空の相手の条件は載せない。 */
export function withPeer(parameters: URLSearchParams, peer: PeerComparison | null): URLSearchParams {
  const next = withoutOffset(parameters);
  next.delete(PEER_PARAMETER);
  next.delete(PEER_ATTRIBUTE_PARAMETER);
  if (!peer) return next;
  next.set(PEER_PARAMETER, formatPeer(peer));
  peer.filters
    .filter((filter: AttributeFilter) => filter.name !== '' && filter.value !== '')
    .forEach((filter) => next.append(PEER_ATTRIBUTE_PARAMETER, formatAttributeFilter(filter)));
  return next;
}

/** 選んだサービスと突き合わせられる相手。サービスを選んでいなければ、突き合わせられるサービスすべて。 */
export function peerServiceChoices(groups: string[][], selectedServices: string[]): string[] {
  const relevant = selectedServices.length === 0 ? groups : groups.filter((group) => group.some((service) => selectedServices.includes(service)));
  return [...new Set(relevant.flat())].filter((service) => !(selectedServices.length === 1 && selectedServices[0] === service));
}
