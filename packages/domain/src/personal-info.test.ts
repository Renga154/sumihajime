import { describe, expect, it } from 'vitest';
import {
  PERSONAL_INFO_MESSAGE,
  detectPersonalInfo,
  findEmailAddresses,
  findPhoneNumbers,
  findUngroundedContacts,
} from './personal-info.js';

/**
 * なぜ: CLAUDE.md 原則6「電話・メール・マイナンバーを収集しない」。チャットの質問欄は自由入力で、
 * 注意文を読まずに書かれた個人情報はそのままサーバーと外部AIへ送られる。送る前(web)と受けた直後
 * (api)に同じ純関数で止めるため、正例(止めるべき入力)と負例(日付・郵便番号・金額など、止めては
 * いけない普通の質問)の両方をここで固定する。
 */
describe('detectPersonalInfo — 止めるべき入力', () => {
  it('マイナンバー(12桁)を区切りの有無・全角を問わず検出する', () => {
    expect(detectPersonalInfo('私の番号は123456789012です')).toEqual(['my_number']);
    expect(detectPersonalInfo('1234 5678 9012 で登録できますか')).toEqual(['my_number']);
    expect(detectPersonalInfo('1234-5678-9012')).toEqual(['my_number']);
    expect(detectPersonalInfo('１２３４－５６７８－９０１２')).toEqual(['my_number']);
  });

  it('日本の電話番号(固定・携帯・フリーダイヤル・+81・括弧・全角)を検出する', () => {
    for (const q of [
      '連絡先は090-1234-5678です',
      '09012345678に電話ください',
      '03-1234-5678',
      '03(1234)5678',
      '０３－１２３４－５６７８',
      '0120-123-456',
      '+81-90-1234-5678',
      '+81 3 1234 5678',
      '090ー1234ー5678',
    ]) {
      expect(detectPersonalInfo(q), q).toEqual(['phone']);
    }
  });

  it('メールアドレスを検出する(全角の＠も)', () => {
    expect(detectPersonalInfo('taro.yamada@example.com に返信を')).toEqual(['email']);
    expect(detectPersonalInfo('ｔａｒｏ＠ｅｘａｍｐｌｅ．ｊｐ')).toEqual(['email']);
  });

  it('複数種類が混ざれば全部を返す(重複なし・固定順)', () => {
    expect(detectPersonalInfo('a@example.jp 090-1234-5678 123456789012 b@example.jp')).toEqual([
      'my_number',
      'phone',
      'email',
    ]);
  });
});

describe('detectPersonalInfo — 止めてはいけない普通の質問(誤検知しない)', () => {
  it.each([
    '2026年4月1日に引っ越します。転入届はいつまで？',
    '2026-04-01 に転入しました',
    '2026/04/01から住んでいます',
    '令和8年度の児童手当は？',
    '〒100-0001 の窓口はどこですか',
    '郵便番号154-0017の地域のごみの日は？',
    '粗大ごみの手数料は15,000円ですか？',
    '1,000,000円以上の所得制限はありますか',
    '受付時間は08:30～17:15ですか',
    '9時から17時まで開いていますか',
    '14日以内に出せばいいですか？',
    '0歳と3歳の子どもがいます',
    '第2号被保険者の手続きは？',
    '手続き番号 13112 の書類は？',
    '2026 2027 年度の保育料は？',
    '内線1234 につないでもらえますか',
    'ご案内のメール@の使い方を教えて',
  ])('%s', (q) => {
    expect(detectPersonalInfo(q)).toEqual([]);
  });
});

describe('findPhoneNumbers / findEmailAddresses', () => {
  it('電話番号は数字だけ・先頭0の国内表記へ正規化して返す', () => {
    expect(findPhoneNumbers('代表 03-5432-1111、夜間 +81 (0)3 5432 2222')).toEqual([
      '0354321111',
      '0354322222',
    ]);
  });

  it('00 で始まる数列(国際プレフィックス)や桁数違いは電話番号としない', () => {
    expect(findPhoneNumbers('0012345678')).toEqual([]);
    expect(findPhoneNumbers('03-1234-567')).toEqual([]);
    expect(findPhoneNumbers('03-1234-56789-0')).toEqual([]);
  });

  it('メールアドレスは小文字へ正規化して返す', () => {
    expect(findEmailAddresses('問い合わせ: Info@City.Example.LG.JP まで')).toEqual([
      'info@city.example.lg.jp',
    ]);
  });
});

describe('findUngroundedContacts — 回答の電話番号・メールが抜粋に無ければ根拠なしとして返す', () => {
  const excerpts = [
    '戸籍住民課 電話：03-5432-1111 ファクシミリ 03(5432)3000',
    'お問い合わせ jumin@city.setagaya.lg.jp',
  ];

  it('抜粋にある番号・メールは表記を変えても根拠あり', () => {
    expect(
      findUngroundedContacts(
        '窓口(03 5432 1111)または ０３－５４３２－３０００ へ。JUMIN@city.setagaya.lg.jp',
        excerpts,
      ),
    ).toEqual({ phones: [], emails: [] });
  });

  it('抜粋に無い番号・メール(質問から写された・捏造された連絡先)を返す', () => {
    expect(
      findUngroundedContacts('お急ぎの方は 090-9999-0000 か help@evil.example へ', excerpts),
    ).toEqual({ phones: ['09099990000'], emails: ['help@evil.example'] });
  });

  it('日付・郵便番号・金額は電話番号として扱わない(誤って保留にしない)', () => {
    expect(
      findUngroundedContacts(
        '2026年4月1日から、〒154-0017 の窓口で手数料15,000円。受付は08:30～17:15。',
        excerpts,
      ),
    ).toEqual({ phones: [], emails: [] });
  });
});

describe('PERSONAL_INFO_MESSAGE', () => {
  it('次の行動(削除して送り直す)が分かり、入力値を含まない固定文', () => {
    expect(PERSONAL_INFO_MESSAGE).toMatch(/削除/);
    expect(PERSONAL_INFO_MESSAGE).toMatch(/もう一度/);
  });
});
