/** データセットごとの項目の絞り込みを、URLの attribute パラメータに持つ。 */
import { formatAttributeFilter, parseAttributeFilter, type AttributeDefinition, type AttributeFilter } from '@mds/contracts';
import { withoutOffset } from './searchUrl';

export const ATTRIBUTE_PARAMETER = 'attribute';

export function attributeFiltersOf(parameters: URLSearchParams): AttributeFilter[] {
  return parameters.getAll(ATTRIBUTE_PARAMETER).flatMap((value) => parseAttributeFilter(value) ?? []);
}

/** 選択肢の1つを、付けたり外したりする。 */
export function toggleAttributeValue(parameters: URLSearchParams, name: string, value: string): URLSearchParams {
  const toggled = formatAttributeFilter({ name, operator: 'equals', value });
  const next = withoutOffset(parameters);
  const current = next.getAll(ATTRIBUTE_PARAMETER);
  next.delete(ATTRIBUTE_PARAMETER);
  const remaining = current.includes(toggled) ? current.filter((item) => item !== toggled) : [...current, toggled];
  remaining.forEach((item) => next.append(ATTRIBUTE_PARAMETER, item));
  return next;
}

/** サービスを選んでいるときは、そのサービスが持つ項目だけを出す。 */
export function attributesForServices(attributes: AttributeDefinition[], services: string[]): AttributeDefinition[] {
  if (services.length === 0) return attributes;
  return attributes.filter((attribute) => attribute.services.some((service) => services.includes(service)));
}
