import { describe, expect, it } from 'vitest';
import { findUntrustedAnswerUrls, isTrustedAnswerUrl } from './linkify.js';

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

describe('findUntrustedAnswerUrls', () => {
  it('公式URL・引用URLだけの回答は空を返す', () => {
    const answer =
      '転入届は14日以内です(https://www.city.setagaya.lg.jp/02233/88.html)。詳細は https://www.town.hachijo.tokyo.jp/ へ。';
    expect(findUntrustedAnswerUrls(answer, ['https://www.town.hachijo.tokyo.jp/'])).toEqual([]);
  });

  it('混入した非公式URLだけを出現順に返す', () => {
    const answer = [
      '転入届は14日以内に提出してください。',
      '詳しくは https://evil.example/a と https://www.city.setagaya.lg.jp/ と http://phish.test/b を参照。',
    ].join('\n');
    expect(findUntrustedAnswerUrls(answer, [])).toEqual([
      'https://evil.example/a',
      'http://phish.test/b',
    ]);
  });

  it('URLが無い回答は空を返す', () => {
    expect(findUntrustedAnswerUrls('本人確認書類が必要です。', [])).toEqual([]);
  });
});
