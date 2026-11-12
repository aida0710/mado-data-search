/** 検索の条件をURLに持つ。URLを共有すれば同じ結果を開ける。 */
export const FILTER_PARAMETERS = ['service', 'kind', 'language', 'publishedFrom', 'publishedTo', 'attribute', 'condition', 'peer', 'peerAttribute'] as const;
export const PAGE_SIZE = 50;

export function hasSearchCondition(parameters: URLSearchParams): boolean {
  return Boolean(parameters.get('query')) || FILTER_PARAMETERS.some((name) => parameters.has(name));
}

export function withoutOffset(parameters: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(parameters);
  next.delete('offset');
  return next;
}

export function withParameter(parameters: URLSearchParams, name: string, value: string): URLSearchParams {
  const next = withoutOffset(parameters);
  if (value) next.set(name, value);
  else next.delete(name);
  return next;
}

/** 複数選べる絞り込みの1つを、付けたり外したりする。 */
export function toggleValue(parameters: URLSearchParams, name: string, value: string): URLSearchParams {
  const next = withoutOffset(parameters);
  const values = next.getAll(name);
  next.delete(name);
  const remaining = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  remaining.forEach((item) => next.append(name, item));
  return next;
}

export function withoutFilters(parameters: URLSearchParams): URLSearchParams {
  const next = withoutOffset(parameters);
  FILTER_PARAMETERS.forEach((name) => next.delete(name));
  return next;
}

export function currentOffset(parameters: URLSearchParams): number {
  const offset = Number(parameters.get('offset'));
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

export function withOffset(parameters: URLSearchParams, offset: number): URLSearchParams {
  const next = new URLSearchParams(parameters);
  if (offset > 0) next.set('offset', String(offset));
  else next.delete('offset');
  return next;
}
