/**
 * SPAが引き受けるURL空間の単一の真実。
 *
 * なぜ共有パッケージに置くのか: 同じ一覧を web(ルータ定義)と api(未定義URLに404を返す判定・
 * sitemap.xml の生成)の両方が必要とする。どちらかに書き写すと「画面はあるのにサーバーが404を返す」
 * 「新しいページがsitemapに載らない」といった追随漏れが必ず起きる。ここを唯一の定義とし、
 * web 側のルータはこの表から生成する(要素の対応は Record 型で網羅を強制するため、
 * 表に足さずにページだけ足すことはできない)。
 */

export interface SpaRoute {
  /**
   * react-router 記法のパスパターン。`:name` は「空でない1セグメント」のワイルドカード。
   * ワイルドカード(`*`)は含めない(未定義URLの受け皿はルータ側の責務で、既知ルートではない)。
   */
  readonly path: string;
  /**
   * sitemap.xml に載せるか。
   *
   * 載せない条件: (a) 選択自治体などのアプリ状態が無いと中身が出ないページ、(b) 動的パス、
   * (c) 旧URL互換のためだけに残しているパス。クローラへ「中身のないURL」を提示しないため
   * (存在しないURLを載せない)。
   */
  readonly sitemap: boolean;
}

/**
 * 公開中のSPAルート。apps/web/src/main.tsx のルータはこの配列から生成される。
 *
 * sitemap=false の理由(個別):
 *  - /wizard, /checklist, /facilities, /waste: 自治体未選択では「先に自治体を選んでください」しか
 *    出ないため、単体のURLとしては中身が無い。
 *  - /procedures/:id: 手続きIDと municipality クエリの組でしか成立しない動的URL。
 *  - /coverage: /about-data への旧URL互換(リダイレクト専用)。
 */
export const SPA_ROUTES = [
  { path: '/', sitemap: true },
  { path: '/wizard', sitemap: false },
  { path: '/checklist', sitemap: false },
  { path: '/procedures/:id', sitemap: false },
  { path: '/facilities', sitemap: false },
  { path: '/waste', sitemap: false },
  { path: '/differences', sitemap: true },
  { path: '/about-data', sitemap: true },
  { path: '/coverage', sitemap: false },
] as const satisfies readonly SpaRoute[];

/** SPA_ROUTES に載っているパスパターンの合併型(web側のルータ生成で網羅を強制するために使う)。 */
export type SpaRoutePath = (typeof SPA_ROUTES)[number]['path'];

/** `/a/b/` → ['a','b'](空セグメントを落とすので前後のスラッシュ差を吸収する)。 */
function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function patternMatches(pattern: string, segments: readonly string[]): boolean {
  const parts = segmentsOf(pattern);
  if (parts.length !== segments.length) return false;
  return parts.every((part, i) => {
    const actual = segments[i] ?? '';
    // `:id` は空でない任意の1セグメント。空を許すと `/procedures/` が既知扱いになってしまう。
    return part.startsWith(':') ? actual.length > 0 : part === actual;
  });
}

/**
 * このパスをSPAが表示できる既知ルートとして扱ってよいか。
 * Worker はこれが false のとき 404 ステータスで404画面を返す(ソフト404の防止)。
 */
export function isKnownSpaPath(pathname: string): boolean {
  const segments = segmentsOf(pathname);
  return SPA_ROUTES.some((route) => patternMatches(route.path, segments));
}

/** sitemap.xml に載せるパス(定義順)。 */
export function sitemapPaths(): readonly string[] {
  return SPA_ROUTES.filter((route) => route.sitemap).map((route) => route.path);
}
