import { describe, expect, it } from 'vitest';
import { boundaryParameters, entriesQuery, isPageWithinBoundaries } from '../src/search/searchStatements.js';

const row = (publishedAt: string) => ({ published_at: publishedAt });
const newest = { limit: 2, sort: 'newest' as const };

describe('上位の行の境目', () => {
  it('境目が1つも無いときは、読んだページをそのまま使える', () => {
    expect(isPageWithinBoundaries([], newest, [null, null])).toBe(true);
  });

  it('ページが埋まり、最後の行がどの境目よりも新しければ使える', () => {
    const page = [row('2026-03-01 00:00:00'), row('2026-02-01 00:00:00')];
    expect(isPageWithinBoundaries(page, newest, ['2026-01-01 00:00:00', null, '2026-02-01 00:00:00'])).toBe(true);
  });

  it('最後の行より新しい境目があると、境目の外に上位の行が残っているかもしれないので使えない', () => {
    const page = [row('2026-03-01 00:00:00'), row('2026-02-01 00:00:00')];
    expect(isPageWithinBoundaries(page, newest, ['2026-02-15 00:00:00'])).toBe(false);
  });

  it('境目があるのにページが埋まらないときは使えない', () => {
    expect(isPageWithinBoundaries([row('2026-03-01 00:00:00')], newest, ['2026-01-01 00:00:00'])).toBe(false);
  });

  it('古い順では、最後の行がどの境目よりも古ければ使える', () => {
    const page = [row('2026-01-01 00:00:00'), row('2026-02-01 00:00:00')];
    const oldest = { limit: 2, sort: 'oldest' as const };
    expect(isPageWithinBoundaries(page, oldest, ['2026-02-01 00:00:00'])).toBe(true);
    expect(isPageWithinBoundaries(page, oldest, ['2026-01-15 00:00:00'])).toBe(false);
  });

  it('境目のある条件だけに、公開日時の条件を足す', () => {
    const alternatives = [
      { where: 'a', boundaryWhere: 'a' },
      { where: 'b', boundaryWhere: null },
    ];
    const query = entriesQuery(alternatives, 'newest', ['2026-01-01 00:00:00', null]);
    expect(query).toContain('WHERE a AND published_at >= {boundary0:DateTime}');
    expect(query).not.toContain('boundary1');
    expect(boundaryParameters(['2026-01-01 00:00:00', null])).toEqual({ boundary0: '2026-01-01 00:00:00' });
  });
});
