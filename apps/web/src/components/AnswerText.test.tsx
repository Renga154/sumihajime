import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { linkifyParts } from '../lib/linkify';
import { AnswerText } from './AnswerText';

/**
 * なぜ: 回答本文のURLをクリックできるようにした(CLAUDE.md §7「次の行動が分かる」)。
 * 壊れやすいのは**URLの終わりの判定**で、日本語の案内文はURLの直後に括弧や助詞が空白なしで
 * 続く。実際にAPIが返す2つの文面をそのまま入力に使い、hrefへ記号が食い込まないことを固定する。
 *
 * 入力の出所:
 * - 半角括弧: apps/api/src/chat.ts(対応対象外自治体の案内)
 * - 全角括弧: packages/rag/src/documents.ts(回答へ載せられなかった話題の注記)
 */

const OUT_OF_SCOPE =
  '八丈町は現在このチャットの対応対象外です。お手続きは八丈町の公式サイト(https://www.town.hachijo.tokyo.jp/)でご確認ください。';

const UNRESOLVED_NOTICE = [
  '■ 必ず必要なもの',
  '・本人確認書類',
  '',
  '■ この回答でご案内できなかったこと',
  '・粗大ごみ: お尋ねの内容は、この回答ではご案内できませんでした。世田谷区の公式ページ（https://www.city.setagaya.lg.jp/mokuji/kurashi/003/002/index.html）でご確認ください。',
  '・犬の登録: お尋ねの内容は、この回答ではご案内できませんでした。世田谷区の公式ページ（https://www.city.setagaya.lg.jp/02216/865.html）でご確認ください。',
].join('\n');

describe('AnswerText — URLが1つの回答', () => {
  it('URLだけをリンクにし、隣接する半角括弧・助詞は地の文に残す', () => {
    render(<AnswerText text={OUT_OF_SCOPE} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    // 閉じ括弧 ")" がhrefへ食い込まない。
    expect(links[0]).toHaveAttribute('href', 'https://www.town.hachijo.tokyo.jp/');

    // 表示される文面はAPIの回答と1文字も違わない(括弧も助詞もそのまま残る)。
    const paragraph = links[0]!.closest('p');
    expect(paragraph?.textContent).toBe(OUT_OF_SCOPE);
  });

  it('別タブで開く安全な属性を持ち、キーボードで到達できる', () => {
    render(<AnswerText text={OUT_OF_SCOPE} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // href付き <a> は既定でタブ順に入る。tabIndex を -1 にしていないことを固定する。
    expect(link.tabIndex).toBe(0);
    // 色だけに頼らず下線で区別する(WCAG 1.4.1)。
    expect(link.className).toContain('underline');
  });
});

describe('AnswerText — URLが複数ある回答', () => {
  it('全角括弧に囲まれた各URLをリンクにし、括弧をhrefへ含めない', () => {
    render(<AnswerText text={UNRESOLVED_NOTICE} />);

    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.city.setagaya.lg.jp/mokuji/kurashi/003/002/index.html',
      'https://www.city.setagaya.lg.jp/02216/865.html',
    ]);
    for (const link of links) {
      expect(link.getAttribute('href')).not.toContain('）');
      expect(link.getAttribute('href')).not.toContain('（');
    }

    // 全角括弧と改行(whitespace-pre-wrap)は本文側に保持される。
    const paragraph = links[0]!.closest('p');
    expect(paragraph?.textContent).toBe(UNRESOLVED_NOTICE);
    expect(paragraph?.textContent).toContain('■ この回答でご案内できなかったこと\n');
    expect(paragraph).toHaveClass('whitespace-pre-wrap');
  });
});

describe('AnswerText — URLが無い回答', () => {
  it('リンクを作らず本文をそのまま表示する', () => {
    const answer = '転入届は引越し日から14日以内に窓口へ提出してください。';
    render(<AnswerText text={answer} />);

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(answer)).toBeInTheDocument();
  });

  it('http(s) 以外のスキームはリンクにしない', () => {
    render(
      <AnswerText text="javascript:alert(1) と mailto:info@example.lg.jp は本文のままにする。" />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('linkifyParts — 分解の境界条件', () => {
  it('元の文字列を復元できる(1文字も足さない・落とさない)', () => {
    for (const text of [OUT_OF_SCOPE, UNRESOLVED_NOTICE, 'URLなしの文', '']) {
      expect(
        linkifyParts(text)
          .map((p) => p.value)
          .join(''),
      ).toBe(text);
    }
  });

  it('括弧が釣り合うURLでは末尾の ")" を残す', () => {
    const parts = linkifyParts('詳しくは https://example.org/foo_(bar) を参照。');
    expect(parts.filter((p) => p.kind === 'url').map((p) => p.value)).toEqual([
      'https://example.org/foo_(bar)',
    ]);
  });

  it('文末の句読点はURLに含めない', () => {
    const parts = linkifyParts('See https://example.lg.jp/a., and https://example.lg.jp/b!');
    expect(parts.filter((p) => p.kind === 'url').map((p) => p.value)).toEqual([
      'https://example.lg.jp/a',
      'https://example.lg.jp/b',
    ]);
  });

  it('ホストの無い断片はリンクにしない', () => {
    expect(linkifyParts('https:// だけの断片').every((p) => p.kind === 'text')).toBe(true);
  });
});
