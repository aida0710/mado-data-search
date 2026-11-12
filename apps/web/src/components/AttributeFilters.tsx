import type { AttributeDefinition } from '@mds/contracts';
import { localeStore } from '../i18n/locale';
import { useLocale } from '../i18n/useLocale';
import { attributeFiltersOf, attributesForServices, toggleAttributeValue } from '../lib/attributeFilters';

/** 取りうる値が決まっている項目を、選択肢として並べる。項目は設定の定義から来るので、画面は名前を知らない。 */
export function AttributeFilters({
  attributes,
  parameters,
  onChange,
}: {
  attributes: AttributeDefinition[];
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  useLocale();
  const locale = localeStore.getLocale();
  const selected = attributeFiltersOf(parameters);
  const choices = attributesForServices(attributes, parameters.getAll('service')).filter(
    (attribute) => attribute.values.length > 0,
  );
  return (
    <>
      {choices.map((attribute) => (
        <div key={attribute.name} className="filter-group" role="group" aria-label={attribute.label[locale]}>
          <span className="filter-label">{attribute.label[locale]}</span>
          {attribute.values.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="filter-chip"
              aria-pressed={selected.some(
                (filter) => filter.name === attribute.name && filter.operator === 'equals' && filter.value === choice.value,
              )}
              onClick={() => onChange(toggleAttributeValue(parameters, attribute.name, choice.value))}
            >
              {choice.label[locale]}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
