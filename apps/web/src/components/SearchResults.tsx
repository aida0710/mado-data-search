import { MAXIMUM_SEARCH_OFFSET, type SearchCountResponse, type SearchEntry, type SearchResponse } from '@mds/contracts';
import { localeStore } from '../i18n/locale';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { formatCount, formatDate, formatDuration } from '../lib/format';
import { PAGE_SIZE } from '../lib/searchUrl';

function formatTotal(total: number, isUpperBound: boolean, intlLocale: string): string {
  const counted = `${formatCount(total, intlLocale)} ${text.entriesUnit}`;
  return isUpperBound ? `${text.upTo} ${counted}` : counted;
}

export function SearchResults({
  response,
  count,
  offset,
  onOpen,
  onOffsetChange,
}: {
  response: SearchResponse;
  /** 件数は結果より遅れて届く。まだ届いていない間はnull。 */
  count: SearchCountResponse | null;
  offset: number;
  onOpen: (entry: SearchEntry) => void;
  onOffsetChange: (offset: number) => void;
}) {
  useLocale();
  const intlLocale = localeStore.getIntlLocale();
  if (response.entries.length === 0) return <p className="muted">{text.noResults}</p>;
  const seconds = (response.elapsedMilliseconds / 1000).toFixed(2);
  const total = count?.total ?? null;
  const countLabel = count === null ? text.counting : total === null ? text.manyResults : formatTotal(total, count.isUpperBound, intlLocale);
  const hasNext =
    response.entries.length === PAGE_SIZE &&
    offset + PAGE_SIZE <= MAXIMUM_SEARCH_OFFSET &&
    (total === null || offset + PAGE_SIZE < total);
  return (
    <>
      <p className="search-summary muted" role="status">
        {countLabel} · {seconds}s
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{text.title}</th>
              <th>{text.service}</th>
              <th>{text.channel}</th>
              <th>{text.languages}</th>
              <th>{text.published}</th>
              <th className="numeric">{text.duration}</th>
            </tr>
          </thead>
          <tbody>
            {response.entries.map((entry) => (
              <tr key={`${entry.source}/${entry.rowKey}`}>
                <td className="entry-title">
                  <button type="button" className="link-button" onClick={() => onOpen(entry)}>
                    {entry.title || entry.externalId || text.untitled}
                  </button>
                </td>
                <td>
                  <span className="status-badge status-neutral">{entry.service}</span>
                  <span className="muted entry-kind">{entry.kind}</span>
                </td>
                <td className="entry-channel">{entry.channelName}</td>
                <td>{entry.language}</td>
                <td className="mono">{formatDate(entry.publishedAt)}</td>
                <td className="mono numeric">{formatDuration(entry.durationSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {formatCount(offset + 1, intlLocale)}–{formatCount(offset + response.entries.length, intlLocale)}
        </span>
        <span className="pagination">
          <button type="button" className="button" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}>
            {text.previous}
          </button>
          <button type="button" className="button" disabled={!hasNext} onClick={() => onOffsetChange(offset + PAGE_SIZE)}>
            {text.next}
          </button>
        </span>
      </div>
    </>
  );
}
