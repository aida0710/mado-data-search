import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { withParameter } from '../lib/searchUrl';

export function SearchForm({
  parameters,
  onChange,
}: {
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  useLocale();
  const urlQuery = parameters.get('query') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  // 戻るボタンなどでURLの語が変わったら、入力欄も合わせる。
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setQuery(urlQuery);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange(withParameter(parameters, 'query', query.trim()));
  };
  return (
    <form className="search-form" role="search" onSubmit={submit}>
      <input
        type="search"
        className="search-input"
        value={query}
        placeholder={text.searchPlaceholder}
        aria-label={text.searchPlaceholder}
        maxLength={200}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label={text.fieldAll}
        value={parameters.get('field') ?? 'all'}
        onChange={(event) => onChange(withParameter(parameters, 'field', event.target.value === 'all' ? '' : event.target.value))}
      >
        <option value="all">{text.fieldAll}</option>
        <option value="title">{text.fieldTitle}</option>
        <option value="channel">{text.fieldChannel}</option>
        <option value="id">{text.fieldId}</option>
      </select>
      <select
        aria-label={text.sortNewest}
        value={parameters.get('sort') ?? 'newest'}
        onChange={(event) => onChange(withParameter(parameters, 'sort', event.target.value === 'newest' ? '' : event.target.value))}
      >
        <option value="newest">{text.sortNewest}</option>
        <option value="oldest">{text.sortOldest}</option>
      </select>
      <button className="button primary">
        <Search size={16} aria-hidden="true" />
        {text.searchButton}
      </button>
    </form>
  );
}
