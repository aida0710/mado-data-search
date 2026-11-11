import { ProductLogo as DesignSystemProductLogo } from '@mado/design-system/react';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';

/** データベースの円筒と、強調色の虫眼鏡の印。形はブラウザのタブのアイコン（public/favicon.svg）と同じ。 */
function SearchMark() {
  return (
    <svg className="product-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ellipse className="product-mark-base" cx="10" cy="5.5" rx="7" ry="2.75" />
      <path className="product-mark-base" d="M3 5.5V17.5C3 19 6.1 20.25 10 20.25" />
      <path className="product-mark-base" d="M17 5.5V10" />
      <path className="product-mark-base" d="M3 11.5C3 13 6.1 14.25 10 14.25" />
      <circle className="product-mark-accent" cx="16.5" cy="16" r="3.75" />
      <path className="product-mark-accent" d="M19.25 18.75L22 21.5" />
    </svg>
  );
}

export function ProductLogo({ compact = false }: { compact?: boolean }) {
  useLocale();
  return (
    <DesignSystemProductLogo
      mark={<SearchMark />}
      prefix={text.appNamePrefix}
      name={text.appNameProduct}
      compact={compact}
    />
  );
}
