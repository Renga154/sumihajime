import { describe, expect, it } from 'vitest';
import { isOfficialHost, isOfficialUrl } from './official-host.js';

describe('isOfficialUrl', () => {
  it('https の公式ホストだけを許す', () => {
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp/x.html')).toBe(true);
    expect(isOfficialUrl('https://www.city.shibuya.tokyo.jp/x')).toBe(true);
  });
  it('http・非公式ホスト・不正URLは拒む', () => {
    expect(isOfficialUrl('http://www.city.setagaya.lg.jp/x.html')).toBe(false);
    expect(isOfficialUrl('https://example.com/x')).toBe(false);
    expect(isOfficialUrl('not a url')).toBe(false);
  });
  it('isOfficialHost は接尾辞の偽装を拒む', () => {
    expect(isOfficialHost('evil-lg.jp.attacker.com')).toBe(false);
    expect(isOfficialHost('notlg.jp')).toBe(false);
  });

  it('八王子市の公式サイトと子育て応援サイトは完全一致でだけ許す', () => {
    // なぜ: 市部で初めて .tokyo.jp のホストを2つ足した。完全一致の範囲を負例で固定し、
    // city.hachioji.tokyo.jp 配下の別ホストや接尾辞の偽装へ広がらないことを確かめる。
    expect(isOfficialUrl('https://www.city.hachioji.tokyo.jp/kurashi/index.html')).toBe(true);
    expect(isOfficialUrl('https://kosodate.city.hachioji.tokyo.jp/index.html')).toBe(true);
    expect(isOfficialHost('city.hachioji.tokyo.jp')).toBe(false);
    expect(isOfficialHost('evil.city.hachioji.tokyo.jp')).toBe(false);
    expect(isOfficialHost('www.city.hachioji.tokyo.jp.attacker.com')).toBe(false);
  });
});

describe('承認済みソースの全ホストが許可される(巡回が取得せずに判定不能へ落ちない)', () => {
  it('registry.csv の approved 行の URL はすべて isOfficialUrl を通る', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const csv = readFileSync(
      resolve(here, '../../../docs/data-sources/registry.csv'),
      'utf8',
    ).replace(/^\uFEFF/, '');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines[0]!.split(',');
    const iUrl = header.indexOf('source_url');
    const iStatus = header.indexOf('review_status');
    // 台帳の URL 列と review_status 列はカンマを含まない(単純分割で足りる)。
    const rejected = lines
      .slice(1)
      .map((l) => l.split(','))
      .filter((r) => r[iStatus] === 'approved' && !isOfficialUrl(r[iUrl]!))
      .map((r) => r[iUrl]);
    expect(rejected).toEqual([]);
  });
});
