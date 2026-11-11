import { Dialog, ErrorNotice, LoadingMessage, useQuery } from '@mado/design-system/react';
import type { SearchEntry } from '@mds/contracts';
import { ExternalLink } from 'lucide-react';
import { api } from '../api/client';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';

/** 長い列はClickHouseに写していないので、開いたときにMySQLから読む。 */
export function EntryDetailDialog({ entry, onClose }: { entry: SearchEntry; onClose: () => void }) {
  useLocale();
  const detail = useQuery({
    key: `${entry.source}/${entry.rowKey}`,
    load: (signal) => api.entry(entry.source, entry.rowKey, signal),
  });
  const url = entry.url ?? detail.value?.url ?? null;
  return (
    <Dialog
      title={entry.title || entry.externalId || text.untitled}
      subtitle={`${entry.service} · ${entry.kind} · ${entry.rowKey}`}
      onClose={onClose}
      closeLabel={text.close}
      closesOnBackdropClick
      size="extra-wide"
    >
      <div className="dialog-body">
        {url && (
          <p>
            <a href={url} target="_blank" rel="noreferrer">
              {text.openOriginal} <ExternalLink size={14} aria-hidden="true" />
            </a>
          </p>
        )}
        {detail.loading && <LoadingMessage label={text.loading} />}
        <ErrorNotice
          message={detail.error ? (detail.error instanceof Error ? detail.error.message : String(detail.error)) : null}
          retry={detail.reload}
          retryLabel={text.retry}
        />
        {detail.value && (
          <>
            <dl className="details-list">
              {detail.value.columns.map((column) => (
                <div key={column.name}>
                  <dt className="mono">{column.name}</dt>
                  <dd className="detail-value">{column.value ?? ''}</dd>
                </div>
              ))}
            </dl>
            {detail.value.related.map((related) => (
              <section key={related.label}>
                <div className="section-heading">
                  <h2>{related.label}</h2>
                </div>
                {related.rows.length === 0 ? (
                  <p className="muted">{text.noRelatedRows}</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {related.columns.map((column) => (
                            <th key={column} className="mono">{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {related.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="mono">{cell ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {related.isTruncated && <p className="muted">{text.truncatedRelated}</p>}
              </section>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
