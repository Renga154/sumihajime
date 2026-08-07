import { describe, expect, it } from 'vitest';
import { assertOfficialUrl, DisallowedHostError, isOfficialHost } from './http.js';

describe('isOfficialHost — official-domain allowlist', () => {
  it('allows municipal and Tokyo open-data hosts under .lg.jp', () => {
    expect(isOfficialHost('www.city.setagaya.lg.jp')).toBe(true);
    expect(isOfficialHost('www.city.shinjuku.lg.jp')).toBe(true);
    expect(isOfficialHost('opendata.metro.tokyo.lg.jp')).toBe(true);
    expect(isOfficialHost('catalog.data.metro.tokyo.lg.jp')).toBe(true);
  });

  it('rejects non-official hosts', () => {
    expect(isOfficialHost('example.com')).toBe(false);
    expect(isOfficialHost('evil-lg.jp.attacker.com')).toBe(false);
    expect(isOfficialHost('notlg.jp')).toBe(false); // suffix ".lg.jp" は "notlg.jp" に一致しない
  });
});

describe('assertOfficialUrl', () => {
  it('accepts https official urls', () => {
    expect(() => assertOfficialUrl('https://www.city.setagaya.lg.jp/x.html')).not.toThrow();
  });
  it('rejects http (non-https)', () => {
    expect(() => assertOfficialUrl('http://www.city.setagaya.lg.jp/x.html')).toThrow(
      DisallowedHostError,
    );
  });
  it('rejects non-official host', () => {
    expect(() => assertOfficialUrl('https://example.com/x')).toThrow(DisallowedHostError);
  });
});

describe('許可ホストの拡張(2026-08-07)', () => {
  it('国の機関(.go.jp)を許可する', () => {
    expect(isOfficialHost('www.digital.go.jp')).toBe(true);
  });

  it('公式サイトが .tokyo.jp の区を完全一致で許可する', () => {
    for (const h of [
      'www.city.suginami.tokyo.jp',
      'www.city.shinagawa.tokyo.jp',
      'www.city.ota.tokyo.jp',
      'www.city.nerima.tokyo.jp',
      'www.city.itabashi.tokyo.jp',
      // Batch10(足立区13121 / 江戸川区13123)。いずれも当該区の公式サイトであることを監査で確認済み。
      'www.city.adachi.tokyo.jp',
      'www.city.edogawa.tokyo.jp',
      'www.city.meguro.tokyo.jp',
      'www.city.shibuya.tokyo.jp',
    ]) {
      expect(isOfficialHost(h)).toBe(true);
    }
  });

  /**
   * なぜ: 渋谷区の実質的なオープンデータ(122件・公共施設CSV 527行)は Esri ArcGIS Hub 上の
   * 区公式ドメイン外ホストで配信されている。中野区の wagmap.jp と同種の論点であり
   * ユーザー決裁を要したが、2026-08-07 に「今許可する」との決裁を得て許可リストへ
   * 完全一致で追加した(docs/research/opendata-gaps.md 事例15)。
   *
   * ここで固定するのは「決裁されたのは渋谷区のこの1ホストだけ」という範囲。
   * arcgis.com は世界中の誰でもHubサイトを作れる汎用SaaSドメインなので、
   * 接尾辞許可や兄弟ホストへ広がっていないことを負例で押さえる。
   */
  it('渋谷区のArcGIS Hub配信ホストはユーザー決裁(2026-08-07)により許可する', () => {
    expect(isOfficialHost('city-shibuya-data.opendata.arcgis.com')).toBe(true);
  });

  it('決裁の範囲は渋谷区の当該ホストのみで、arcgis.com の他ホストへは広げない', () => {
    expect(isOfficialHost('opendata.arcgis.com')).toBe(false);
    expect(isOfficialHost('arcgis.com')).toBe(false);
    expect(isOfficialHost('evil.opendata.arcgis.com')).toBe(false);
    // 接尾辞一致で通ってしまう実装退行(endsWith 化)を捕まえる負例。
    expect(isOfficialHost('evil-city-shibuya-data.opendata.arcgis.com')).toBe(false);
    expect(isOfficialHost('city-shibuya-data.opendata.arcgis.com.evil.com')).toBe(false);
  });

  it('日本郵便と中野区のデータ配信先を許可する', () => {
    expect(isOfficialHost('www.post.japanpost.jp')).toBe(true);
    expect(isOfficialHost('www2.wagmap.jp')).toBe(true);
  });

  // なぜ: .tokyo.jp は都内に住所があれば誰でも取れる地域ドメインで、公式性の証明にならない。
  // 接尾辞ではなく完全一致で許可している不変条件を固定する。
  it('未登録の .tokyo.jp と wagmap のサブドメインは拒否する', () => {
    expect(isOfficialHost('evil.tokyo.jp')).toBe(false);
    expect(isOfficialHost('www.city.fake.tokyo.jp')).toBe(false);
    expect(isOfficialHost('evil.wagmap.jp')).toBe(false);
    expect(isOfficialHost('www2.wagmap.jp.evil.com')).toBe(false);
  });
});
