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
import { currentOffset, hasSearchCondition, PAGE_SIZE, toggleValue, withOffset } from '../lib/searchUrl';

function errorMessage(failure: unknown): string | null {
  if (!failure) return null;
  return failure instanceof Error ? failure.message : String(failure);
}

export function SearchPage() {
  useLocale();
  const [parameters, setParameters] = useSearchParams();
  const [openEntry, setOpenEntry] = useState<SearchEntry | null>(null);
  const overview = useQuery({ key: 'overview', load: api.overview });
  const searchable = hasSearchCondition(parameters);
  const queryText = `${parameters}&limit=${PAGE_SIZE}`;
  const results = useQuery({
    key: searchable ? queryText : null,
    load: (signal) => api.search(new URLSearchParams(queryText), signal),
  });
  const offset = currentOffset(parameters);
  return (
    <div className="page search-page">
      <SearchForm parameters={parameters} onChange={setParameters} />
      <SearchFilters overview={overview.value} parameters={parameters} onChange={setParameters} />
      <ErrorNotice message={errorMessage(results.error ?? overview.error)} retry={results.reload} retryLabel={text.retry} />
      {results.loading && <LoadingMessage label={text.loading} />}
      {searchable && results.value && !results.loading && (
        <SearchResults
          response={results.value}
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
