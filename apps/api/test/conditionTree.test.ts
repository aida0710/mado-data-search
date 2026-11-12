import { describe, expect, it } from 'vitest';
import { parseCondition, SearchRequestSchema, type ConditionNode } from '@mds/contracts';
import { toBranches } from '../src/search/conditionTree.js';
import { buildSearchCondition } from '../src/search/searchQuery.js';

const leaf = (name: string, operator: string, value: string) => ({ name, operator, value }) as ConditionNode;
const catalog = {
  sources: [
    { id: 'example-videos', service: 'example' },
    { id: 'other-videos', service: 'other' },
  ],
  attributes: [
    { name: 'state', type: 'keyword' as const, label: { ja: '状態', en: 'State' }, values: [] },
    { name: 'view_count', type: 'number' as const, label: { ja: '再生数', en: 'Views' }, values: [] },
  ],
};
const build = (input: Record<string, unknown>) => buildSearchCondition(SearchRequestSchema.parse(input), catalog);

describe('ANDとORの条件', () => {
  it('ANDの中のORを、ANDだけの枝に展開する', () => {
    const branches = toBranches({
      all: [leaf('service', 'equals', 'example'), { any: [leaf('title', 'contains', 'live'), leaf('title', 'contains', '配信')] }],
    });
    expect(branches.map((branch) => branch.map((item) => ('value' in item ? item.value : '')))).toEqual([
      ['example', 'live'],
      ['example', '配信'],
    ]);
  });

  it('枝ごとに別の条件にし、サービスは取り込み元で絞る', () => {
    const { alternatives, parameters } = build({
      condition: {
        all: [leaf('service', 'equals', 'example'), leaf('view_count', 'atLeast', '10000'), { any: [leaf('title', 'contains', 'live'), leaf('title', 'contains', '配信')] }],
      },
    });
    expect(alternatives).toHaveLength(2);
    expect(alternatives[0]?.where).toBe(
      '(source IN {condition0x0:Array(String)} AND attr_view_count >= {condition0x1:Float64} AND hasAllTokens(title, {condition0x2:String}) AND title ILIKE {condition0x2Like:String})',
    );
    // 2文字の語は索引だけで決まる。
    expect(alternatives[1]?.where).toContain('hasAllTokens(title, {condition1x2:String}))');
    expect(parameters).toMatchObject({ condition0x0: ['example-videos'], condition0x1: 10000, condition1x2: '配信' });
  });

  it('上位の行の境目と件数は、索引だけの条件で求める', () => {
    const { alternatives, countAlternatives, countIsUpperBound } = build({
      condition: { any: [leaf('title', 'contains', 'live'), leaf('state', 'equals', 'done')] },
    });
    expect(alternatives[0]?.boundaryWhere).toBe('(hasAllTokens(title, {condition0x0:String}))');
    expect(countAlternatives).toEqual(['((hasAllTokens(title, {condition0x0:String})) OR (attr_state = {condition1x0:String}))']);
    expect(countIsUpperBound).toBe(true);
  });

  it('検索語や絞り込みの欄とは、ANDでつなぐ', () => {
    const { alternatives } = build({ query: '音楽', field: 'title', kinds: ['video'], condition: leaf('state', 'notEquals', 'done') });
    expect(alternatives).toEqual([
      {
        where: '(hasAllTokens(title, {term0:String})) AND (attr_state != {condition0x0:String}) AND kind IN {kinds:Array(String)}',
        boundaryWhere: '(hasAllTokens(title, {term0:String})) AND (attr_state != {condition0x0:String}) AND kind IN {kinds:Array(String)}',
      },
    ]);
  });

  it('ORの組み合わせが多すぎる条件、定義に無い項目は断る', () => {
    const manyChoices = { any: Array.from({ length: 5 }, (_, index) => leaf('state', 'equals', String(index))) };
    expect(() => build({ condition: { all: [manyChoices, manyChoices] } })).toThrow('多すぎます');
    expect(() => build({ condition: leaf('unknown', 'equals', 'x') })).toThrow('unknown');
  });

  it('URLの条件は、形が違うものと深すぎるものを読まない', () => {
    expect(parseCondition('{"all":[{"name":"state","operator":"equals","value":"done"}]}')).not.toBeNull();
    expect(parseCondition('not json')).toBeNull();
    expect(parseCondition('{"all":[]}')).toBeNull();
    expect(parseCondition('{"all":[{"name":"state","operator":"like","value":"x"}]}')).toBeNull();
    const deep = '{"all":['.repeat(6) + '{"name":"state","operator":"equals","value":"x"}' + ']}'.repeat(6);
    expect(parseCondition(deep)).toBeNull();
  });
});
