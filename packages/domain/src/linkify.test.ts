import { describe, expect, it } from 'vitest';
import {
  answerScopeHosts,
  findOutOfScopeAnswerUrls,
  isTrustedAnswerUrl,
  type AnswerUrlScope,
} from './linkify.js';

/**
 * なぜ: 本番で、質問文に書いた攻撃者のURLが生成回答へ写り、公式根拠カードの隣でクリック可能な
 * リンクになった。web のリンク化と api の保留判定が同じこの2関数を使うので、境界をここで固定する。
 */
describe('isTrustedAnswerUrl', () => {
  it('公式ホストは引用に無くても信頼する', () => {
    expect(isTrustedAnswerUrl('https://www.city.setagaya.lg.jp/02233/88.html', [])).toBe(true);
    expect(isTrustedAnswerUrl('https://www.digital.go.jp/', [])).toBe(true);
  });

  it('非公式ホストは拒む(本番で確認された注入の形)', () => {
    expect(isTrustedAnswerUrl('https://evil.example/phish', [])).toBe(false);
    // 公式ドメインを装った接尾辞・http は公式扱いしない。
    expect(isTrustedAnswerUrl('https://www.city.setagaya.lg.jp.evil.example/', [])).toBe(false);
    expect(isTrustedAnswerUrl('http://www.city.setagaya.lg.jp/', [])).toBe(false);
  });

  it('非公式ホストでも、台帳由来のURLと完全一致すれば信頼する(八丈町の公式トップ等)', () => {
    const trusted = ['https://www.town.hachijo.tokyo.jp/'];
    expect(isTrustedAnswerUrl('https://www.town.hachijo.tokyo.jp/', trusted)).toBe(true);
    // ホストの大文字表記ゆれは同一URLとして扱う。
    expect(isTrustedAnswerUrl('https://WWW.TOWN.HACHIJO.TOKYO.JP/', trusted)).toBe(true);
    // 同じホストでも別パスは完全一致ではないので信頼しない(台帳が保証するのはそのURLだけ)。
    expect(isTrustedAnswerUrl('https://www.town.hachijo.tokyo.jp/other', trusted)).toBe(false);
  });
});

/**
 * なぜ(2026-10-02 監査・原則4): サーバーの保留判定は以前 isOfficialUrl(.lg.jp / .go.jp の接尾辞)で
 * URLを信頼していたため、**別の区の公式URL**(例: 世田谷区の回答に目黒区のページ)が保留されずに
 * 回答へ残り、リンクとして並んだ。「公式かどうか」ではなく「選択自治体に適用される承認済みソースの
 * ホストかどうか」で判定する。
 */
const SETAGAYA_SCOPE: AnswerUrlScope = {
  hosts: answerScopeHosts([
    'https://www.city.setagaya.lg.jp/02233/88.html',
    'https://www.metro.tokyo.lg.jp/tosei/index.html',
    'https://www.digital.go.jp/policies/mynumber',
  ]),
  urls: ['https://www.nenkin.go.jp/service/kokunen.html'],
};

describe('findOutOfScopeAnswerUrls — 選択自治体に適用されるホストだけを許す', () => {
  it('選択自治体・都・国の承認済みホスト、抜粋に現れたURLは許す', () => {
    const answer = [
      '転入届は14日以内です(https://www.city.setagaya.lg.jp/02233/88.html)。',
      '区のトップ https://www.city.setagaya.lg.jp/ 、都 https://www.metro.tokyo.lg.jp/x 、',
      'マイナンバー https://www.digital.go.jp/ 、年金 https://www.nenkin.go.jp/service/kokunen.html',
    ].join('\n');
    expect(findOutOfScopeAnswerUrls(answer, SETAGAYA_SCOPE)).toEqual([]);
  });

  it('別の区の公式URLは .lg.jp / .tokyo.jp でも範囲外として返す(越境混入)', () => {
    const answer =
      '目黒区は https://www.city.meguro.tokyo.jp/x.html 、新宿区は https://www.city.shinjuku.lg.jp/ です。';
    expect(findOutOfScopeAnswerUrls(answer, SETAGAYA_SCOPE)).toEqual([
      'https://www.city.meguro.tokyo.jp/x.html',
      'https://www.city.shinjuku.lg.jp/',
    ]);
  });

  it('範囲内ホストでも http・明示ポート・userinfo は範囲外', () => {
    const answer = [
      'http://www.city.setagaya.lg.jp/a',
      'https://www.city.setagaya.lg.jp:8443/a',
      'https://u:p@www.city.setagaya.lg.jp/a',
    ].join(' ');
    expect(findOutOfScopeAnswerUrls(answer, SETAGAYA_SCOPE)).toHaveLength(3);
  });

  it('範囲外の国のホストは、抜粋に同じURLが無ければ範囲外(.go.jp を接尾辞で信頼しない)', () => {
    expect(
      findOutOfScopeAnswerUrls('詳しくは https://www.nenkin.go.jp/other.html', SETAGAYA_SCOPE),
    ).toEqual(['https://www.nenkin.go.jp/other.html']);
  });

  it('混入した非公式URLを出現順に返し、URLが無い回答は空', () => {
    const answer = '詳しくは https://evil.example/a と http://phish.test/b を参照。';
    expect(findOutOfScopeAnswerUrls(answer, SETAGAYA_SCOPE)).toEqual([
      'https://evil.example/a',
      'http://phish.test/b',
    ]);
    expect(findOutOfScopeAnswerUrls('本人確認書類が必要です。', SETAGAYA_SCOPE)).toEqual([]);
  });
});

describe('answerScopeHosts', () => {
  it('https のホスト名だけを小文字・重複なしで集め、不正URL・http・ポート付きは捨てる', () => {
    expect(
      answerScopeHosts([
        'https://WWW.CITY.SETAGAYA.LG.JP/a',
        'https://www.city.setagaya.lg.jp/b',
        'http://insecure.lg.jp/',
        'https://www.city.setagaya.lg.jp:8443/',
        'not a url',
      ]),
    ).toEqual(['www.city.setagaya.lg.jp']);
  });
});
