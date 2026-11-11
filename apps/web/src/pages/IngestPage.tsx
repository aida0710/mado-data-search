import { ErrorNotice, LoadingMessage, useQuery } from '@mado/design-system/react';
import type { IngestRunStatus } from '@mds/contracts';
import { api } from '../api/client';
import { localeStore } from '../i18n/locale';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { formatCount, formatUtcDateTime } from '../lib/format';

const POLL_MILLISECONDS = 30_000;

function StatusBadge({ status }: { status: IngestRunStatus | null }) {
  if (status === 'succeeded') return <span className="status-badge status-success">{text.statusSucceeded}</span>;
  if (status === 'failed') return <span className="status-badge status-danger">{text.statusFailed}</span>;
  if (status === 'running') return <span className="status-badge status-info">{text.statusRunning}</span>;
  return <span className="status-badge status-neutral">{text.statusNever}</span>;
}

export function IngestPage() {
  useLocale();
  const intlLocale = localeStore.getIntlLocale();
  const status = useQuery({ key: 'ingest-status', load: api.ingestStatus, pollMs: POLL_MILLISECONDS });
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{text.ingest}</h1>
          {status.value && (
            <p className="muted">{text.ingestNote.replace('{hours}', String(status.value.intervalHours))}</p>
          )}
        </div>
      </header>
      <ErrorNotice
        message={status.error ? (status.error instanceof Error ? status.error.message : String(status.error)) : null}
        retry={status.reload}
        retryLabel={text.retry}
      />
      {status.loading && !status.value && <LoadingMessage label={text.loading} />}
      {status.value && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{text.source}</th>
                <th>{text.mode}</th>
                <th>{text.status}</th>
                <th className="numeric">{text.entries}</th>
                <th className="numeric">{text.rowsRead}</th>
                <th>{text.started}</th>
                <th>{text.finished}</th>
                <th>{text.error}</th>
              </tr>
            </thead>
            <tbody>
              {status.value.sources.map((source) => (
                <tr key={source.id}>
                  <td className="mono">{source.id}</td>
                  <td>{source.mode === 'full' ? text.modeFull : text.modeIncremental}</td>
                  <td><StatusBadge status={source.lastRun?.status ?? null} /></td>
                  <td className="mono numeric">{formatCount(source.entryCount, intlLocale)}</td>
                  <td className="mono numeric">{source.lastRun ? formatCount(source.lastRun.rowsRead, intlLocale) : ''}</td>
                  <td className="mono">{formatUtcDateTime(source.lastRun?.startedAt ?? null, intlLocale)}</td>
                  <td className="mono">{formatUtcDateTime(source.lastRun?.finishedAt ?? null, intlLocale)}</td>
                  <td>{source.lastRun?.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
