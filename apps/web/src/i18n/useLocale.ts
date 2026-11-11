import { useLocale as useDesignSystemLocale } from '@mado/design-system/react';
import { localeStore } from './locale';

/** 今の表示言語。言語が変わると部品を描き直す。 */
export function useLocale() {
  return useDesignSystemLocale(localeStore);
}
