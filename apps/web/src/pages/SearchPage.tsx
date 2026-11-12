import { ErrorNotice, LoadingMessage, useQuery } from '@mado/design-system/react';
import type { SearchEntry } from '@mds/contracts';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { EntryDetailDialog } from '../components/EntryDetailDialog';
import { SearchFilters } from '../components/SearchFilters';
import { SearchForm } from '../components/SearchForm';
import { SearchResults } from '../components/SearchResults';
import { ServiceOverview } from '../components/ServiceOverview';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { currentOffset, hasSearchCondition, PAGE_SIZE, toggleValue, withOffset, withoutOffset } from '../lib/searchUrl';

function errorMessage(failure: unknown): string | null {
  if (!failure) return null;
  return failure instanceof Error ? failure.message : String(failure);
}

export function SearchPage() {
  useLocale();
  const [parameters, setParameters] = useSearchParams();
  const [openEntry, setOpenEntry] = useState<SearchEntry | null>(null);
  const overview = useQuery({ key: 'overview', load: api.overview });
  const attributes = useQuery({ key: 'attributes', load: api.attributes });
  const attributeDefinitions = attributes.value?.attributes ?? [];
  const searchable = hasSearchCondition(parameters);
  const queryText = `${parameters}&limit=${PAGE_SIZE}`;
  const results = useQuery({
    key: searchable ? queryText : null,
    load: (signal) => api.search(new URLSearchParams(queryText), signal),
  });
  // 件数はページを送っても変わらないので、ページの位置を除いた条件で1回だけ数える。
  const countText = withoutOffset(parameters).toString();
  const count = useQuery({
    key: searchable ? countText : null,
    load: (signal) => api.searchCount(new URLSearchParams(countText), signal),
  });
  const offset = currentOffset(parameters);
  return (
    <div className="page search-page">
      <SearchForm parameters={parameters} onChange={setParameters} />
      <SearchFilters overview={overview.value} attributes={attributeDefinitions} parameters={parameters} onChange={setParameters} />
      <ErrorNotice message={errorMessage(results.error ?? overview.error)} retry={results.reload} retryLabel={text.retry} />
      {results.loading && <LoadingMessage label={text.loading} />}
      {searchable && results.value && !results.loading && (
        <SearchResults
          response={results.value}
          attributes={attributeDefinitions}
          count={count.loading || count.error ? null : (count.value ?? null)}
          offset={offset}
          onOpen={setOpenEntry}
          onOffsetChange={(next) => setParameters(withOffset(parameters, next))}
        />
      )}
      {!searchable && overview.value && (
        <ServiceOverview
          overview={overview.value}
          onSelect={(service) => setParameters(toggleValue(parameters, 'service', service))}
        />
      )}
      {openEntry && <EntryDetailDialog entry={openEntry} onClose={() => setOpenEntry(null)} />}
    </div>
  );
}
