import { describe, expect, it } from 'vitest';
import { incrementalStartKey, throttleDelayMilliseconds } from '../src/ingest/ingestRunner.js';
import { parseSources, sourceUrl } from '../src/sources/sourceConfig.js';
import { buildChunkSql, toEntryRow } from '../src/ingest/sourceReader.js';
import type { RowDataPacket } from 'mysql2/promise';

const [source] = parseSources(`
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
    urlTemplate: https://example.com/watch/{externalId}
`);
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
    const entry = toEntryRow(source, row as unknown as RowDataPacket, '2026-11-05 00:00:00');
    expect(entry).toMatchObject({ key_number: 0, title: '', duration_seconds: 0, published_at: '1970-01-01 00:00:00' });
  });

  it('数字のキーは丸めずに文字列のまま渡す', () => {
    const row = { row_key: '18446744073709551615', published_at: '2026-01-02 03:04:05.123456' };
    const entry = toEntryRow(source, row as unknown as RowDataPacket, '2026-11-05 00:00:00');
    expect(entry.key_number).toBe('18446744073709551615');
    expect(entry.published_at).toBe('2026-01-02 03:04:05');
  });
});

describe('元のページのURL', () => {
  it('保存したURLを先に使い、無ければ型から作る', () => {
    expect(sourceUrl(source, 'a b', 'https://stored.example/')).toBe('https://stored.example/');
    expect(sourceUrl(source, 'a b', '')).toBe('https://example.com/watch/a%20b');
    expect(sourceUrl(source, '', '')).toBeNull();
  });
});
