import { describe, expect, it } from 'vitest';
import { SearchRequestSchema } from '@mds/contracts';
import { buildSearchCondition as buildWithSources, escapeLikePattern, splitTerms } from '../src/search/searchQuery.js';

const request = (input: Record<string, unknown>) => SearchRequestSchema.parse(input);
const sources = [
  { id: 'example-videos', service: 'example' },
  { id: 'example-lives', service: 'example' },
  { id: 'other-videos', service: 'other' },
];
const buildSearchCondition = (searchRequest: ReturnType<typeof request>) => buildWithSources(searchRequest, sources);

describe('検索の条件', () => {
  it('空白で分けた語をすべて含む行を探す', () => {
    expect(splitTerms('  音楽   piano ')).toEqual(['音楽', 'piano']);
    const { alternatives, parameters } = buildSearchCondition(request({ query: '音楽 piano', field: 'title' }));
    expect(alternatives).toEqual([
      {
        where: '(hasAllTokens(title, {term0:String}) AND hasAllTokens(title, {term1:String}) AND title ILIKE {termLike1:String})',
        boundaryWhere: '(hasAllTokens(title, {term0:String}) AND hasAllTokens(title, {term1:String}))',
      },
    ]);
    expect(parameters.termLike1).toBe('%piano%');
  });

  it('2文字の語は索引だけで探す', () => {
    const { alternatives, countIsUpperBound } = buildSearchCondition(request({ query: '音楽', field: 'title' }));
    expect(alternatives.map(({ where }) => where)).toEqual(['(hasAllTokens(title, {term0:String}))']);
    expect(countIsUpperBound).toBe(false);
  });

  it('1文字の語は索引を使わずILIKEだけで探す', () => {
    const where = buildSearchCondition(request({ query: '猫', field: 'title' })).alternatives[0]?.where;
    expect(where).toContain('title ILIKE');
    expect(where).not.toContain('hasAllTokens');
  });

  it('3文字以上の語の件数は索引だけで数え、上限として返す', () => {
    const { countAlternatives, countIsUpperBound } = buildSearchCondition(request({ query: 'piano', field: 'title' }));
    expect(countAlternatives).toEqual(['((hasAllTokens(title, {term0:String})))']);
    expect(countIsUpperBound).toBe(true);
  });

  it('LIKEの特別な文字はただの文字として扱う', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('値はSQLに埋め込まずパラメータで渡す', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: "x' OR 1=1", field: 'id' }));
    expect(alternatives.map(({ where }) => where).join(' ')).not.toContain('OR 1=1');
    expect(parameters.exactId).toBe("x' OR 1=1");
  });

  it('IDの検索は語を分けずに完全一致で探す', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: 'abc def', field: 'id' }));
    expect(alternatives).toEqual([{ where: '(external_id = {exactId:String})', boundaryWhere: null }]);
    expect(parameters.exactId).toBe('abc def');
  });

  it('数字だけのIDは行のキーでも探し、件数では同じ行を2回数えない', () => {
    const { alternatives, countAlternatives, parameters } = buildSearchCondition(request({ query: '4274834', field: 'id' }));
    expect(alternatives.map(({ where }) => where)).toEqual(['(external_id = {exactId:String})', '(key_number = {exactKeyNumber:UInt64})']);
    expect(countAlternatives).toEqual([
      '(external_id = {exactId:String})',
      '(key_number = {exactKeyNumber:UInt64}) AND NOT (external_id = {exactId:String})',
    ]);
    expect(parameters.exactKeyNumber).toBe('4274834');
  });

  it('すべての項目の検索は、索引を使えるよう条件ごとに分ける', () => {
    const { alternatives } = buildSearchCondition(request({ query: 'piano' }));
    expect(alternatives).toHaveLength(3);
    for (const { where } of alternatives) expect(where).not.toContain(' OR ');
  });

  it('すべての項目の件数は、題名とチャンネル名の両方に当たる行を1回だけ数える', () => {
    const { countAlternatives } = buildSearchCondition(request({ query: '音楽' }));
    expect(countAlternatives[0]).toBe(
      '((hasAllTokens(title, {term0:String})) OR (hasAllTokens(channel_name, {term0:String})))',
    );
    expect(countAlternatives[1]).toContain('NOT ((hasAllTokens(title, {term0:String})) OR (hasAllTokens(channel_name, {term0:String})))');
  });

  it('サービスの絞り込みは、そのサービスの取り込み元で絞る', () => {
    const { alternatives, parameters } = buildSearchCondition(request({ query: '音楽', field: 'title', services: ['example'] }));
    expect(alternatives[0]?.where).toContain('source IN {sourcesOfServices:Array(String)}');
    expect(parameters.sourcesOfServices).toEqual(['example-videos', 'example-lives']);
  });

  it('取り込み元の無いサービスで絞ると、どの行にも当たらない', () => {
    const { parameters } = buildSearchCondition(request({ services: ['unknown'] }));
    expect(parameters.sourcesOfServices).toEqual([]);
  });

  it('絞り込みの条件を足す', () => {
    const { alternatives, parameters } = buildSearchCondition(
      request({ kinds: ['video'], languages: ['ja'], publishedFrom: '2026-01-01', publishedTo: '2026-02-01' }),
    );
    const where = alternatives[0]?.where;
    expect(where).toContain('kind IN {kinds:Array(String)}');
    expect(where).toContain('language IN {languages:Array(String)}');
    expect(parameters.publishedFrom).toBe('2026-01-01 00:00:00');
    expect(parameters.publishedTo).toBe('2026-02-01 23:59:59');
  });

  it('条件が無いときは全件にする', () => {
    expect(buildSearchCondition(request({})).alternatives).toEqual([{ where: '1', boundaryWhere: '1' }]);
  });
});
