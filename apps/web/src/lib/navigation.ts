import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * なぜ: SPAでは遷移してもブラウザが `<title>` を差し替えず、フォーカスも `<body>` に
 * 落ちるため、履歴・タブ・スクリーンリーダーのいずれでもページを識別できなくなる
 * (WCAG 2.4.2 Page Titled / 2.4.3 Focus Order)。ここに「ページ名の付け方」と
 * 「遷移時にどこへフォーカスを戻すか」を1か所へ集約する。
 */

export const SITE_TITLE = 'スミハジメ 〜東京の新生活ToDo〜';

const TITLE_SEPARATOR = ' | ';

/** ページ名 → `<title>`。ページ名が無い場合(トップ)はサイト名のみ。 */
export function documentTitleFor(pageTitle?: string): string {
  const trimmed = pageTitle?.trim();
  return trimmed ? `${trimmed}${TITLE_SEPARATOR}${SITE_TITLE}` : SITE_TITLE;
}

/** `<title>` → ページ名(読み上げ通知用)。サイト名だけの場合はサイト名を返す。 */
export function pageTitleFromDocumentTitle(documentTitle: string): string {
  const suffix = `${TITLE_SEPARATOR}${SITE_TITLE}`;
  return documentTitle.endsWith(suffix) ? documentTitle.slice(0, -suffix.length) : documentTitle;
}

/**
 * ページ単位で `<title>` を設定する。各ページの先頭で1行呼ぶ。
 * Layout 側の遷移処理はこの値を読むため、ページ(子)の effect が先に走る順序に依存する。
 */
export function useDocumentTitle(pageTitle?: string): void {
  useEffect(() => {
    document.title = documentTitleFor(pageTitle);
  }, [pageTitle]);
}

/**
 * 遷移のたびに (1) ページ見出しへフォーカスを移し (2) ページ名を読み上げ通知へ流す。
 *
 * - 初回表示(location.key === 'default')ではフォーカスを奪わない。利用者が自分で
 *   開いたページの先頭に、勝手なフォーカス移動を挟まないため。
 * - `preventScroll` を付ける理由: スクロール位置は <ScrollRestoration /> が担当する。
 *   focus() の副作用でスクロールすると、戻る操作時の位置復元と競合する。
 *
 * @returns 読み上げ通知に流す文字列(初回は空文字)。
 */
export function useRouteChangeAnnouncement(): string {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');
  // 同一 key で effect が二重実行されても(StrictMode)処理を1回にする。
  const handledKey = useRef<string | null>(null);

  useEffect(() => {
    if (location.key === 'default') return;
    if (handledKey.current === location.key) return;
    handledKey.current = location.key;

    const main = document.getElementById('main');
    const heading = main?.querySelector('h1') ?? main;
    if (heading instanceof HTMLElement) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    setAnnouncement(pageTitleFromDocumentTitle(document.title));
  }, [location.key]);

  return announcement;
}
