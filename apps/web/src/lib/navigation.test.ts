import { describe, expect, it } from 'vitest';
import { SITE_TITLE, documentTitleFor, pageTitleFromDocumentTitle } from './navigation';

/**
 * なぜ: `<title>` が全ページ同一だと、履歴・タブ・スクリーンリーダーのページ読み上げの
 * いずれでもページを識別できない(WCAG 2.4.2)。命名規則を1本の純関数に固定する。
 */

describe('documentTitleFor', () => {
  it('ページ名があれば「ページ名 | サイト名」', () => {
    expect(documentTitleFor('窓口一覧')).toBe(`窓口一覧 | ${SITE_TITLE}`);
  });

  it('ページ名が無い(トップ)ならサイト名のみ', () => {
    expect(documentTitleFor()).toBe(SITE_TITLE);
    expect(documentTitleFor('')).toBe(SITE_TITLE);
    expect(documentTitleFor('   ')).toBe(SITE_TITLE);
  });

  it('ページごとに異なるタイトルになる', () => {
    const titles = ['条件を入力する', 'あなたのチェックリスト', '窓口一覧', undefined].map((t) =>
      documentTitleFor(t),
    );
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('pageTitleFromDocumentTitle', () => {
  it('サイト名の接尾辞を落としてページ名だけを返す', () => {
    expect(pageTitleFromDocumentTitle(`窓口一覧 | ${SITE_TITLE}`)).toBe('窓口一覧');
  });

  it('サイト名だけのときはそのまま返す', () => {
    expect(pageTitleFromDocumentTitle(SITE_TITLE)).toBe(SITE_TITLE);
  });
});
