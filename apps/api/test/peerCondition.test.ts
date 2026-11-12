import { describe, expect, it } from 'vitest';
import { SearchRequestSchema } from '@mds/contracts';
import { comparableServiceGroups } from '../src/search/peerCondition.js';
import { buildSearchCondition } from '../src/search/searchQuery.js';

const sources = [
  { id: 'first-videos', service: 'first', identity: 'site-video' },
  { id: 'second-videos', service: 'second', identity: 'site-video' },
  { id: 'third-lives', service: 'third', identity: 'other-live' },
];
const attributes = [{ name: 'state', type: 'keyword' as const, label: { ja: '状態', en: 'State' }, values: [] }];
const build = (input: Record<string, unknown>, sourceRows = new Map<string, number>()) =>
  buildSearchCondition(SearchRequestSchema.parse(input), { sources, attributes, sourceRows });

describe('ほかのデータセットとの突き合わせ', () => {
  it('同じidentityのsourceどうしで、外部のIDが相手に無い行を残す', () => {
    const { alternatives, parameters } = build({
      services: ['first'],
      peer: { service: 'second', presence: 'absent', filters: [{ name: 'state', operator: 'equals', value: 'done' }] },
    });
    expect(alternatives[0]?.where).toContain(
      "source IN {peerComparedSources:Array(String)} AND external_id NOT IN (SELECT external_id FROM entries WHERE source IN {peerSources:Array(String)} AND external_id != '' AND attr_state = {peerAttribute0:String})",
    );
    expect(parameters).toMatchObject({ peerComparedSources: ['first-videos'], peerSources: ['second-videos'], peerAttribute0: 'done' });
  });

  it('サービスを選ばなければ、相手と突き合わせられるsourceすべてを比べる', () => {
    const { parameters } = build({ peer: { service: 'second', presence: 'present' } });
    expect(parameters.peerComparedSources).toEqual(['first-videos']);
  });

  it('相手のほうが行が多いときは、比べる側に在るIDだけに先に絞る', () => {
    const rows = new Map([
      ['first-videos', 1_000],
      ['second-videos', 1_000_000],
    ]);
    const smallerSide = build({ services: ['first'], peer: { service: 'second', presence: 'present' } }, rows);
    expect(smallerSide.alternatives[0]?.where).toContain('external_id IN (SELECT external_id FROM entries WHERE source IN {peerComparedSources:Array(String)})');
    const largerSide = build({ services: ['second'], peer: { service: 'first', presence: 'present' } }, rows);
    expect(largerSide.alternatives[0]?.where).not.toContain('WHERE source IN {peerComparedSources:Array(String)})');
  });

  it('突き合わせられる相手が無いと、どの行にも当たらない', () => {
    expect(build({ services: ['third'], peer: { service: 'second', presence: 'present' } }).alternatives[0]?.where).toContain('0');
    expect(() => build({ peer: { service: 'unknown', presence: 'present' } })).toThrow('unknown');
  });

  it('同じidentityを2つ以上のサービスが持つ組を返す', () => {
    expect(comparableServiceGroups(sources)).toEqual([['first', 'second']]);
  });
});
