import type { AttributeDefinition, SearchEntry } from '@mds/contracts';
import { useQuery } from '@mado/design-system/react';
import { api } from '../api/client';
import { text } from '../i18n/catalog';
import { formatDate } from '../lib/format';
import { EntryAttributeBadges } from './EntryAttributeBadges';

/** 外部のIDが同じ、ほかのデータセットの行。どこで取れていて、どこで取れていないかを見比べる。 */
export function EntryPeers({ entry, attributes }: { entry: SearchEntry; attributes: AttributeDefinition[] }) {
  const peers = useQuery({
    key: `peers/${entry.source}/${entry.rowKey}`,
    load: (signal) => api.entryPeers(entry.source, entry.rowKey, signal),
  });
  if (!peers.value || peers.value.peers.length === 0) return null;
  return (
    <section>
      <div className="section-heading">
        <h2>{text.peerEntries}</h2>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{text.service}</th>
              <th>{text.title}</th>
              <th>{text.published}</th>
            </tr>
          </thead>
          <tbody>
            {peers.value.peers.map((peer) => (
              <tr key={`${peer.source}/${peer.rowKey}`}>
                <td>
                  <span className="status-badge status-neutral">{peer.service}</span>
                  <span className="muted entry-kind">{peer.kind}</span>
                  <EntryAttributeBadges entry={peer} attributes={attributes} />
                </td>
                <td>{peer.title || peer.externalId}</td>
                <td className="mono">{formatDate(peer.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
