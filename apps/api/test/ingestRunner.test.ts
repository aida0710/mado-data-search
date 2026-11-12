import { describe, expect, it } from 'vitest';
import { incrementalStartKey, throttleDelayMilliseconds } from '../src/ingest/ingestRunner.js';
import { parseSourceCatalog, sourceUrl } from '../src/sources/sourceConfig.js';
import { sourceDefinitionHash } from '../src/sources/sourceDefinitionHash.js';
import { secondsSince } from '../src/ingest/changedKeysReader.js';
import { buildChunkSql, buildRowsByKeySql, toEntryRow } from '../src/ingest/sourceReader.js';
import type { RowDataPacket } from 'mysql2/promise';

const catalog = parseSourceCatalog(`
attributes:
  state:
    type: keyword
    label: { ja: 状態, en: State }
    values:
      - { value: done, label: { ja: 済み, en: Done } }
  view_count:
    type: number
    label: { ja: 再生数, en: Views }
  checked_at:
    type: datetime
    label: { ja: 確認日時, en: Checked at }
  is_public:
    type: boolean
    label: { ja: 公開, en: Public }
sources:
  - id: example-videos
    service: example
    kind: video
    database: example
    table: videos
    key: id
    join: LEFT JOIN channels c ON c.id = t.channel_id
    fields:
      externalId: t.platform_id
      title: t.title
      channelName: c.name
    identity: example-video
    attributes:
      state: CASE WHEN t.done_at IS NULL THEN 'pending' ELSE 'done' END
      view_count: t.view_count
      checked_at: t.checked_at
      is_public: t.is_public
    changedKeys:
      - SELECT video_id FROM downloads WHERE completed_at >= NOW() - INTERVAL ? SECOND
    urlTemplate: https://example.com/watch/{externalId}
`);
const [source] = catalog.sources;
const attributeTypes = new Map(catalog.attributes.map((attribute) => [attribute.name, attribute.type]));
const toRow = (row: Record<string, unknown>) =>
  toEntryRow({ source: source!, attributeTypes, row: row as unknown as RowDataPacket, ingestedAt: '2026-11-05 00:00:00' });
if (!source) throw new Error('設定を読めませんでした');

describe('読みの絞り込み', () => {
  it('上限を超える速さで読んだら、超えた分だけ待つ', () => {
    // 20,000行×1,000バイト＝20MBを毎秒20MBなら1秒。300ミリ秒で読めたら残り700ミリ秒待つ。
    expect(throttleDelayMilliseconds({ rows: 20_000, averageRowBytes: 1000, maximumMegabytesPerSecond: 20, elapsedMilliseconds: 300 })).toBeCloseTo(700);
  });
  it('上限より遅ければ待たない', () => {
    expect(throttleDelayMilliseconds({ rows: 100, averageRowBytes: 100, maximumMegabytesPerSecond: 20, elapsedMilliseconds: 500 })).toBe(0);
  });
});

describe('差分の開始位置', () => {
  it('前回の末尾から決めた数だけ戻る', () => {
    expect(incrementalStartKey('1000', 100)).toBe('900');
  });
  it('0より前には戻らない', () => {
    expect(incrementalStartKey('50', 100)).toBe('0');
  });
  it('大きなキーでも桁を落とさない', () => {
    expect(incrementalStartKey('18446744073709551615', 1)).toBe('18446744073709551614');
  });
});

describe('行の変換', () => {
  it('主キーの順に読むSQLを作り、値はプレースホルダで渡す', () => {
    const sql = buildChunkSql(source);
    expect(sql).toContain('t.`id` > ?');
    expect(sql).toContain('ORDER BY t.`id`');
    expect(sql).toContain('LIMIT ?');
    expect(sql).toContain('LEFT JOIN channels c');
  });

  it('不明な日付と文字のキーを安全な値にする', () => {
    const row = { row_key: 'BV1abc', external_id: 'BV1abc', title: null, channel_name: 'x', channel_key: '', language: null, duration_seconds: '-3', published_at: '0000-00-00 00:00:00', url: null };
    const entry = toRow(row);
    expect(entry).toMatchObject({ key_number: 0, title: '', duration_seconds: 0, published_at: '1970-01-01 00:00:00' });
  });

  it('数字のキーは丸めずに文字列のまま渡す', () => {
    const row = { row_key: '18446744073709551615', published_at: '2026-01-02 03:04:05.123456' };
    const entry = toRow(row);
    expect(entry.key_number).toBe('18446744073709551615');
    expect(entry.published_at).toBe('2026-01-02 03:04:05');
  });
});

describe('データセットごとの項目', () => {
  it('項目の式を列の別名で読む', () => {
    expect(buildChunkSql(source)).toContain('t.view_count AS attr_view_count');
    expect(buildRowsByKeySql(source)).toContain('WHERE t.`id` IN (?)');
  });

  it('値を項目の型に合わせ、値の無い数・日時・真偽はNULLにする', () => {
    const entry = toRow({ row_key: '1', attr_state: 'done', attr_view_count: '12', attr_checked_at: '0000-00-00 00:00:00', attr_is_public: 1 });
    expect(entry).toMatchObject({ identity: 'example-video', attr_state: 'done', attr_view_count: 12, attr_checked_at: null, attr_is_public: true });
    expect(toRow({ row_key: '2' })).toMatchObject({ attr_state: '', attr_view_count: null, attr_is_public: null });
  });

  it('定義に無い項目をsourceに書くと読み込めない', () => {
    expect(() =>
      parseSourceCatalog(`
sources:
  - id: example-videos
    service: example
    kind: video
    database: example
    table: videos
    key: id
    fields: {}
    attributes:
      unknown_item: t.x
`),
    ).toThrow('unknown_item');
  });
});

describe('定義の指紋', () => {
  it('読む中身を変える設定が変わると指紋が変わる', () => {
    const before = sourceDefinitionHash(source, catalog.attributes);
    const changed = { ...source, attributes: { ...source.attributes, view_count: 't.views' } };
    expect(sourceDefinitionHash(changed, catalog.attributes)).not.toBe(before);
  });

  it('読み直す間隔や詳細の画面の設定では変わらない', () => {
    const before = sourceDefinitionHash(source, catalog.attributes);
    expect(sourceDefinitionHash({ ...source, rereadRecentKeys: 5, fullEveryDays: 1 }, catalog.attributes)).toBe(before);
  });
});

describe('変わった行の拾い方', () => {
  it('前回の開始の1時間前からの秒数を渡す', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(secondsSince(new Date('2026-01-01T00:00:00Z'), now)).toBe(86_400 + 3_600);
  });
});

describe('元のページのURL', () => {
  it('保存したURLを先に使い、無ければ型から作る', () => {
    expect(sourceUrl(source, 'a b', 'https://stored.example/')).toBe('https://stored.example/');
    expect(sourceUrl(source, 'a b', '')).toBe('https://example.com/watch/a%20b');
    expect(sourceUrl(source, '', '')).toBeNull();
  });
});
