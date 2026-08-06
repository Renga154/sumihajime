import { describe, expect, it } from 'vitest';
import { municipalitySchema } from '@tmn/schemas';
import { MUNICIPALITIES } from './municipalities.js';

/**
 * なぜ: 東京都62市区町村(23区+26市+5町+8村)の誠実リスト化を固定する。
 * supported は縦切り整備済みの7区のみ、それ以外は未対応(=CLAUDE.md原則9)。
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

  it('supported は9区(千代田/新宿/江東/品川/大田/世田谷/杉並/板橋/練馬)。Batch6-Aで板橋・練馬を整備し2026-08-07人手レビュー承認済み', () => {
    // なぜ: 静的 supported は「MVP整備対象」という product 意図を表す。Step4-Aで杉並(13115)、
    // Step4-Bで千代田(13101)、Step5-Aで品川(13109)、Step5-Bで大田(13111)、Batch6-Aで
    // 板橋(13119)・練馬(13120)のデータを整備し supported=true にした。9区すべて人手レビュー
    // 承認済み。板橋・練馬は 2026-08-07 の承認(ユーザー決裁「2区とも承認」)により全ソースが
    // approved・全手続き(自治体以外のライフライン等4件を含む)が verified となったため、
    // 公開ビュー(loadPublishData)でも supported=true になる(gate.test.ts / load.ts の approved
    // 判定で担保)。ここで検証するのは静的な整備意図。
    const supported = MUNICIPALITIES.filter((m) => m.supported)
      .map((m) => m.code)
      .sort();
    expect(supported).toEqual([
      '13101',
      '13104',
      '13108',
      '13109',
      '13111',
      '13112',
      '13115',
      '13119',
      '13120',
    ]);
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
