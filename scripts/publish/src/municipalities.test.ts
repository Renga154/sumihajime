import { describe, expect, it } from 'vitest';
import { municipalitySchema } from '@tmn/schemas';
import { MUNICIPALITIES } from './municipalities.js';

/**
 * なぜ: 東京都62市区町村(23区+26市+5町+8村)の誠実リスト化を固定する。
 * supported は縦切り整備済みの3区のみ、それ以外は未対応(=CLAUDE.md原則9)。
 * 全件が Municipality スキーマ(5桁コード・URL)に適合し、code は一意であることを担保する。
 */
describe('MUNICIPALITIES (東京都62市区町村)', () => {
  it('62件ちょうど', () => {
    expect(MUNICIPALITIES).toHaveLength(62);
  });

  it('内訳: 23区 + 26市 + 5町 + 8村', () => {
    const wards = MUNICIPALITIES.filter((m) => m.name.endsWith('区'));
    const cities = MUNICIPALITIES.filter((m) => m.name.endsWith('市'));
    const towns = MUNICIPALITIES.filter((m) => m.name.endsWith('町'));
    const villages = MUNICIPALITIES.filter((m) => m.name.endsWith('村'));
    expect(wards).toHaveLength(23);
    expect(cities).toHaveLength(26);
    expect(towns).toHaveLength(5);
    expect(villages).toHaveLength(8);
  });

  it('supported は3区(世田谷/江東/新宿)のみ', () => {
    const supported = MUNICIPALITIES.filter((m) => m.supported)
      .map((m) => m.code)
      .sort();
    expect(supported).toEqual(['13104', '13108', '13112']);
  });

  it('全件が Municipality スキーマに適合し、officialUrl を持つ', () => {
    for (const m of MUNICIPALITIES) {
      expect(() => municipalitySchema.parse(m)).not.toThrow();
      expect(m.officialUrl).toBeTruthy();
    }
  });

  it('code は5桁で一意', () => {
    const codes = MUNICIPALITIES.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^\d{5}$/);
  });

  it('既存6自治体の従前 officialUrl を維持する', () => {
    const url = (code: string) => MUNICIPALITIES.find((m) => m.code === code)?.officialUrl;
    expect(url('13112')).toBe('https://www.city.setagaya.lg.jp/');
    expect(url('13108')).toBe('https://www.city.koto.lg.jp/');
    expect(url('13104')).toBe('https://www.city.shinjuku.lg.jp/');
    expect(url('13115')).toBe('https://www.city.suginami.tokyo.jp/');
    expect(url('13101')).toBe('https://www.city.chiyoda.lg.jp/');
    expect(url('13201')).toBe('https://www.city.hachioji.tokyo.jp/');
  });
});
