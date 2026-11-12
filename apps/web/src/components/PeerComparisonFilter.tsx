import type { AttributeDefinition, PeerComparison } from '@mds/contracts';
import { useState } from 'react';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { peerOf, peerServiceChoices, withPeer } from '../lib/peerComparison';
import type { DraftRow } from '../lib/conditionDraft';
import { ConditionRow } from './ConditionBuilder';

const NO_PEER_FILTER: DraftRow = { name: '', operator: 'equals', value: '' };

/**
 * ほかのデータセットとの突き合わせ。外部のIDが同じものが、相手のサービスに在るか無いかで絞る。
 * 相手の条件を足すと、「相手で取得が済みのものが無い」のように絞れる。
 */
export function PeerComparisonFilter({
  groups,
  attributes,
  parameters,
  onChange,
}: {
  groups: string[][];
  attributes: AttributeDefinition[];
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  useLocale();
  const peer = peerOf(parameters);
  const urlFilter = peer?.filters[0];
  // 相手の条件は、値を入れ終わるまでURLに載らないので、入力の途中を手元に持つ。
  const [draftFilter, setDraftFilter] = useState<DraftRow | null>(null);
  const choices = peerServiceChoices(groups, parameters.getAll('service'));
  if (choices.length === 0 && !peer) return null;

  const change = (next: PeerComparison | null) => onChange(withPeer(parameters, next));
  const peerAttributes = peer ? attributes.filter((attribute) => attribute.services.includes(peer.service)) : [];
  const filterRow = draftFilter ?? urlFilter ?? null;
  const changeFilter = (row: DraftRow | null) => {
    setDraftFilter(row && row.value === '' ? row : null);
    if (peer) change({ ...peer, filters: row ? [row] : [] });
  };

  return (
    <div className="filter-group" role="group" aria-label={text.peerComparison}>
      <span className="filter-label">{text.peerComparison}</span>
      <select
        aria-label={text.peerService}
        value={peer?.service ?? ''}
        onChange={(event) => {
          setDraftFilter(null);
          change(event.target.value ? { service: event.target.value, presence: peer?.presence ?? 'absent', filters: [] } : null);
        }}
      >
        <option value="">{text.noPeer}</option>
        {[...new Set([...choices, ...(peer ? [peer.service] : [])])].map((service) => (
          <option key={service} value={service}>
            {service}
          </option>
        ))}
      </select>
      {peer && (
        <>
          <select
            aria-label={text.peerPresence}
            value={peer.presence}
            onChange={(event) => change({ ...peer, presence: event.target.value as PeerComparison['presence'] })}
          >
            <option value="absent">{text.peerAbsent}</option>
            <option value="present">{text.peerPresent}</option>
          </select>
          {filterRow ? (
            <ConditionRow row={filterRow} fields={peerAttributes} onChange={changeFilter} onRemove={() => changeFilter(null)} />
          ) : (
            peerAttributes.length > 0 && (
              <button type="button" className="link-button" onClick={() => setDraftFilter(NO_PEER_FILTER)}>
                {text.addPeerFilter}
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}
