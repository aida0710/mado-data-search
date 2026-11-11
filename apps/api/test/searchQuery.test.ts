import { describe, expect, it } from 'vitest';
import { SearchRequestSchema } from '@mds/contracts';
import { buildSearchCondition, escapeLikePattern, splitTerms } from '../src/search/searchQuery.js';

const request = (input: Record<string, unknown>) => SearchRequestSchema.parse(input);

describe('検索の条件', () => {
  it('空白で分けた語をすべて含む行を探す', () => {
    expect(splitTerms('  音楽   piano ')).toEqual(['音楽', 'piano']);
    const { alternatives, parameters } = buildSearchCondition(request({ query: '音楽 piano', field: 'title' }));
    const [where] = alternatives;
    expect(alternatives).toHaveLength(1);
    expect(where).toContain('hasAllTokens(title, {term0:String}) AND title ILIKE {termLike0:String}');
    expect(where).toContain('hasAllTokens(title, {term1:String}) AND title ILIKE {termLike1:String}');
    expect(parameters.termLike1).toBe('%piano%');
  });

  it('1文字の語は索引を使わずILIKEだけで探す', () => {
    const [where] = buildSearchCondition(request({ query: '猫', field: 'title' })).alternatives;
    expect(where).toContain('title ILIKE');
    expect(where).not.toContain('hasAllTokens');
  });

  it('LIKEの特別な文字はただの文字として扱う', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('値はSQLに埋め込まずパラメータで渡す', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: "x' OR 1=1", field: 'id' }));
    expect(alternatives.join(' ')).not.toContain('OR 1=1');
    expect(parameters.exactId).toBe("x' OR 1=1");
  });

  it('IDの検索は語を分けずに完全一致で探す', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: 'abc def', field: 'id' }));
    expect(alternatives).toEqual(['(external_id = {exactId:String})']);
    expect(parameters.exactId).toBe('abc def');
  });

  it('数字だけのIDは行のキーでも探す', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: '4274834', field: 'id' }));
    expect(alternatives).toEqual([
      '(external_id = {exactId:String})',
      '(key_number = {exactKeyNumber:UInt64}) AND NOT (external_id = {exactId:String})',
    ]);
    expect(parameters.exactKeyNumber).toBe('4274834');
  });

  it('すべての項目の検索は、索引を使えるよう条件ごとに分ける', () => {
    const { alternatives } = buildSearchCondition(request({ query: '音楽', services: ['example'] }));
    expect(alternatives).toHaveLength(3);
    for (const where of alternatives) {
      expect(where).not.toContain(' OR ');
      expect(where).toContain('service IN {services:Array(String)}');
    }
    // 同じ行を2回数えないよう、後ろの条件は前の条件に当たった行を外す。
    expect(alternatives[0]).not.toContain('NOT (');
    expect(alternatives[1]).toContain('NOT (hasAllTokens(title, {term0:String}) AND title ILIKE {termLike0:String})');
  });

  it('絞り込みの条件を足す', () => {
    const { alternatives, parameters } = buildSearchCondition(
      request({ services: ['example'], kinds: ['video'], languages: ['ja'], publishedFrom: '2026-01-01', publishedTo: '2026-02-01' }),
    );
    const [where] = alternatives;
    expect(where).toContain('service IN {services:Array(String)}');
    expect(where).toContain('kind IN {kinds:Array(String)}');
    expect(where).toContain('language IN {languages:Array(String)}');
    expect(parameters.publishedFrom).toBe('2026-01-01 00:00:00');
    expect(parameters.publishedTo).toBe('2026-02-01 23:59:59');
  });

  it('条件が無いときは全件にする', () => {
    expect(buildSearchCondition(request({})).alternatives).toEqual(['1']);
  });
});
