import { describe, expect, it } from 'vitest';
import { SearchRequestSchema } from '@mds/contracts';
import { buildSearchCondition, escapeLikePattern, splitTerms } from '../src/search/searchQuery.js';

const request = (input: Record<string, unknown>) => SearchRequestSchema.parse(input);

describe('検索の条件', () => {
  it('空白で分けた語をすべて含む行を探す', () => {
    expect(splitTerms('  音楽   piano ')).toEqual(['音楽', 'piano']);
    const { where, parameters } = buildSearchCondition(request({ query: '音楽 piano', field: 'title' }));
    expect(where).toContain('hasAllTokens(title, {term0:String}) AND title ILIKE {termLike0:String}');
    expect(where).toContain('hasAllTokens(title, {term1:String}) AND title ILIKE {termLike1:String}');
    expect(parameters.termLike1).toBe('%piano%');
  });

  it('1文字の語は索引を使わずILIKEだけで探す', () => {
    const { where } = buildSearchCondition(request({ query: '猫', field: 'title' }));
    expect(where).toContain('title ILIKE');
    expect(where).not.toContain('hasAllTokens');
  });

  it('LIKEの特別な文字はただの文字として扱う', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('値はSQLに埋め込まずパラメータで渡す', () => {
    const { where, parameters } = buildSearchCondition(request({ query: "x' OR 1=1", field: 'id' }));
    expect(where).not.toContain('OR 1=1');
    expect(parameters.exactId).toBe("x' OR 1=1");
  });

  it('IDの検索は語を分けずに完全一致で探す', () => {
    const { where, parameters } = buildSearchCondition(request({ query: 'abc def', field: 'id' }));
    expect(where).toBe('(external_id = {exactId:String} OR row_key = {exactId:String})');
    expect(parameters.exactId).toBe('abc def');
  });

  it('絞り込みの条件を足す', () => {
    const { where, parameters } = buildSearchCondition(
      request({ services: ['example'], kinds: ['video'], languages: ['ja'], publishedFrom: '2026-01-01', publishedTo: '2026-02-01' }),
    );
    expect(where).toContain('service IN {services:Array(String)}');
    expect(where).toContain('kind IN {kinds:Array(String)}');
    expect(where).toContain('language IN {languages:Array(String)}');
    expect(parameters.publishedFrom).toBe('2026-01-01 00:00:00');
    expect(parameters.publishedTo).toBe('2026-02-01 23:59:59');
  });

  it('条件が無いときは全件にする', () => {
    expect(buildSearchCondition(request({})).where).toBe('1');
  });
});
