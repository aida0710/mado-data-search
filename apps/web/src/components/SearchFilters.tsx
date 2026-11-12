import type { AttributeDefinition, OverviewResponse } from '@mds/contracts';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { AttributeFilters } from './AttributeFilters';
import { FILTER_PARAMETERS, toggleValue, withoutFilters, withParameter } from '../lib/searchUrl';

function FilterGroup({
  label,
  name,
  options,
  parameters,
  onChange,
}: {
  label: string;
  name: string;
  options: OverviewResponse['services'];
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  const selected = parameters.getAll(name);
  return (
    <div className="filter-group" role="group" aria-label={label}>
      <span className="filter-label">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="filter-chip"
          aria-pressed={selected.includes(option.value)}
          onClick={() => onChange(toggleValue(parameters, name, option.value))}
        >
          {option.value}
        </button>
      ))}
    </div>
  );
}

export function SearchFilters({
  overview,
  attributes,
  parameters,
  onChange,
}: {
  overview: OverviewResponse | undefined;
  attributes: AttributeDefinition[];
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  useLocale();
  const hasFilter = FILTER_PARAMETERS.some((name) => parameters.has(name));
  return (
    <div className="search-filters">
      {overview && (
        <>
          <FilterGroup label={text.services} name="service" options={overview.services} parameters={parameters} onChange={onChange} />
          <FilterGroup label={text.kinds} name="kind" options={overview.kinds} parameters={parameters} onChange={onChange} />
        </>
      )}
      <AttributeFilters attributes={attributes} parameters={parameters} onChange={onChange} />
      <div className="filter-group">
        <label className="filter-field">
          <span className="filter-label">{text.languages}</span>
          <select
            value={parameters.get('language') ?? ''}
            onChange={(event) => onChange(withParameter(parameters, 'language', event.target.value))}
          >
            <option value="">{text.anyLanguage}</option>
            {overview?.languages.map((language) => (
              <option key={language.value} value={language.value}>
                {language.value}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-label">{text.publishedFrom}</span>
          <input
            type="date"
            value={parameters.get('publishedFrom') ?? ''}
            onChange={(event) => onChange(withParameter(parameters, 'publishedFrom', event.target.value))}
          />
        </label>
        <label className="filter-field">
          <span className="filter-label">{text.publishedTo}</span>
          <input
            type="date"
            value={parameters.get('publishedTo') ?? ''}
            onChange={(event) => onChange(withParameter(parameters, 'publishedTo', event.target.value))}
          />
        </label>
        {hasFilter && (
          <button type="button" className="link-button" onClick={() => onChange(withoutFilters(parameters))}>
            {text.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
