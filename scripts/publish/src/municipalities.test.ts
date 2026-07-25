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

  it('supported は4区(千代田/新宿/江東/世田谷)のみ', () => {
    // なぜ: Step4-Bで千代田(13101)を supported に追加(手続き10件・窓口施設7件・分別辞書446品目)。
    // 静的 supported は「MVP整備対象」であり、公開ビュー(seed→D1)の supported は承認済みソース有無に
    // 従う(load.ts)。千代田は全ソース pending のため承認まで公開ビューでは非対応表示のまま(原則9)。
    const supported = MUNICIPALITIES.filter((m) => m.supported)
      .map((m) => m.code)
      .sort();
    expect(supported).toEqual(['13101', '13104', '13108', '13112']);
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

  it('note(利用者に表示される表示専用文言)に内部用語を含まない(Step2)', () => {
    // なぜ: note は LandingPage で利用者に表示される。開発の進捗・工程用語(タスクID・Wave・
    // MVP・縦切り・レビュー/承認/pending)が利用者の目に触れないことを固定する。
    const internalJargon = /MVP|T-0\d|Wave\s*\d|Wave\d|縦切り|人手レビュー|pending|承認後|準備中/i;
    for (const m of MUNICIPALITIES) {
      if (m.note != null) {
        expect(m.note, `${m.name} の note に内部用語: ${m.note}`).not.toMatch(internalJargon);
      }
    }
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
