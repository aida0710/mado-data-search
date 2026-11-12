import type { AttributeDefinition, SearchEntry } from '@mds/contracts';
import { localeStore } from '../i18n/locale';

/** 取りうる値が決まっている項目の値を、行に小さく出す。 */
export function EntryAttributeBadges({ entry, attributes }: { entry: SearchEntry; attributes: AttributeDefinition[] }) {
  const locale = localeStore.getLocale();
  const badges = attributes.flatMap((attribute) => {
    const choice = attribute.values.find((item) => item.value === entry.attributes[attribute.name]);
    return choice ? [{ name: attribute.name, title: attribute.label[locale], label: choice.label[locale] }] : [];
  });
  return (
    <>
      {badges.map((badge) => (
        <span key={badge.name} className="status-badge status-neutral entry-attribute" title={badge.title}>
          {badge.label}
        </span>
      ))}
    </>
  );
}
