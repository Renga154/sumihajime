import { describe, expect, it } from 'vitest';
import { municipalitySchema } from '@tmn/schemas';
import { MUNICIPALITIES } from './municipalities.js';

/**
 * なぜ: 東京都62市区町村(23区+26市+5町+8村)の誠実リスト化を固定する。
 * supported は23特別区のみ、多摩地域・島しょの39市町村は未対応(=CLAUDE.md原則9)。
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

  it('supported は23特別区すべて。Batch8で中央・港・文京・台東・墨田、Batch9で目黒・渋谷・葛飾を整備し2026-08-07人手レビュー承認済み', () => {
    // なぜ: 静的 supported は「MVP整備対象」という product 意図を表す。Step4-Aで杉並(13115)、
    // Step4-Bで千代田(13101)、Step5-Aで品川(13109)、Step5-Bで大田(13111)、Batch6-Aで
    // 板橋(13119)・練馬(13120)、Batch7で中野(13114)・豊島(13116)・北(13117)・荒川(13118)、
    // Batch10で足立(13121)・江戸川(13123)、最後に Batch8で中央(13102)・港(13103)・文京(13105)・
    // 台東(13106)・墨田(13107)、Batch9で目黒(13110)・渋谷(13113)・葛飾(13122)のデータを整備し
    // supported=true にした。これで23特別区が出そろい、23区すべてが人手レビュー承認済みである。
    // 最後の8区は2026-08-07の承認(ユーザー決裁「5区とも承認」「3区とも承認」)により全ソースが
    // approved・全手続き(自治体以外のライフライン等4件を含む)が verified となったため、公開ビュー
    // (loadPublishData)でも supported=true になる(gate.test.ts / load.ts の approved 判定で
    // 担保)。ここで検証するのは静的な整備意図。
    const supported = MUNICIPALITIES.filter((m) => m.supported)
      .map((m) => m.code)
      .sort();
    // 23特別区のコードは 13101〜13123 の連番(特別区の法定コード)。
    const allWards = MUNICIPALITIES.filter((m) => m.name.endsWith('区'))
      .map((m) => m.code)
      .sort();
    expect(supported).toEqual(allWards);
    expect(supported).toHaveLength(23);
    // 多摩地域・島しょ(13201〜)は1件も supported にしない(未対応を対応済みに見せない=原則9)。
    expect(supported.filter((c) => !c.startsWith('131'))).toEqual([]);
  });

  it('北区(13117)の officialUrl は移行後の新ドメイン(city.kita.lg.jp)である', () => {
    // なぜ: 都リンク集の href は旧ドメイン(http://www.city.kita.tokyo.jp/)のままで、実測で
    // https://www.city.kita.lg.jp/ への301恒久リダイレクトを確認した(2026-08-07)。registry.csv に
    // 登録した北区の出典URLは全件が新ドメインのため、出典整合性のため officialUrl も揃える。
    // 旧ドメインへ巻き戻ったら落ちるようにしておく。
    const kita = MUNICIPALITIES.find((m) => m.code === '13117');
    expect(kita?.officialUrl).toBe('https://www.city.kita.lg.jp/');
  });

  it('officialUrl は御蔵島村(13382)を除き https。平文HTTPへ利用者を誘導しない', () => {
    // なぜ: 2026-08-08 に都リンク集由来の http 20件すべてについて https 版を実測し、
    // 「同一ホストで 200・リダイレクト0・本文に自治体名あり」を確認できた19件を https へ引き上げた
    // (docs/data-sources/url-verification-2026-08-08.md)。http へ巻き戻ったら落ちるようにしておく。
    // 御蔵島村だけは https 版が証明書エラー(対象ホスト名不一致)で到達できず、到達しない URL へは
    // 差し替えないため http のまま。承認を経て移転先へ差し替える際はこのテストも更新する。
    const http = MUNICIPALITIES.filter((m) => m.officialUrl?.startsWith('http://')).map(
      (m) => m.code,
    );
    expect(http).toEqual([]);
  });

  it('ホスト移転を承認済みの3件が実測どおりの移転先を指す', () => {
    // なぜ固定するか: この3件は旧ホストからのリダイレクトで到達できるため放置もできたが、
    // 2026-08-08 に人手レビュー承認を得て移転先へ差し替えた(実測: 200・転送0回・本文に自治体名)。
    // 出典の値へ戻す変更は再び承認事項なので、意図しない差し戻しをここで落とす
    // (実測記録: docs/data-sources/url-verification-2026-08-08.md)。
    const expected: Record<string, string> = {
      '13382': 'https://www.vill.mikurasima.tokyo.jp/',
      '13208': 'https://www.city.chofu.lg.jp/',
      '13364': 'https://www.vill.kouzushima.tokyo.jp/',
    };
    for (const [code, url] of Object.entries(expected)) {
      expect(MUNICIPALITIES.find((m) => m.code === code)?.officialUrl).toBe(url);
    }
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
