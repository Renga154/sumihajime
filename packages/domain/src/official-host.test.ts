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

/**
 * なぜ(2026-10-02 監査): 判定は hostname だけを見ていたため、明示ポート(https://x.lg.jp:8443/)や
 * userinfo(https://user:pass@x.lg.jp/)付きの URL も「公式」として通っていた。前者は公式ホスト上の
 * 別サービス(管理画面・検証用ポート)へ導線を作り、後者は「https://www.city.setagaya.lg.jp@…」型の
 * 見た目の偽装に使われる。どちらも台帳の承認済み URL には現れない形なので、一律に拒む。
 */
describe('isOfficialUrl — ポート・userinfo を拒む', () => {
  it('明示ポート付きは公式ホストでも拒む', () => {
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp:8443/x.html')).toBe(false);
    expect(isOfficialUrl('https://www.city.shibuya.tokyo.jp:444/')).toBe(false);
  });

  it('userinfo 付きは公式ホストでも拒む(パスワード無し・空ユーザーも同じ)', () => {
    expect(isOfficialUrl('https://user:pass@www.city.setagaya.lg.jp/x.html')).toBe(false);
    expect(isOfficialUrl('https://user@www.city.setagaya.lg.jp/')).toBe(false);
    expect(isOfficialUrl('https://:pass@www.city.setagaya.lg.jp/')).toBe(false);
    // 公式ホストを userinfo に見せかけた偽装(実ホストは attacker)は従来どおり拒む。
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp@attacker.example/')).toBe(false);
  });

  it('既定ポート(:443)は URL の正規化で消えるため、ポート無しと同じに扱う', () => {
    // なぜ許すか: WHATWG URL は既定ポートを落とすので、:443 と省略形は同一の宛先・同一の href になる。
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp:443/x.html')).toBe(true);
  });

  it('従来の正例(大文字ホスト・IDN・クエリ/フラグメント)は変わらず通る', () => {
    expect(isOfficialUrl('https://WWW.CITY.SETAGAYA.LG.JP/x.html')).toBe(true);
    // IDN は punycode(xn--)へ正規化されてから接尾辞で判定される。
    expect(isOfficialUrl('https://例え.lg.jp/')).toBe(true);
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp/x.html?a=1#b')).toBe(true);
  });

  it('末尾ドットのホストは従来どおり拒む(完全一致・接尾辞のどちらにも一致させない)', () => {
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp./x.html')).toBe(false);
    expect(isOfficialUrl('https://www.city.shibuya.tokyo.jp./')).toBe(false);
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
