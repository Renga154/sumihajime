/**
 * 独自ドメイン(sumihajime.com)への一本化。
 *
 * なぜ: 同じ画面が workers.dev の旧URLと独自ドメインの両方で見えると、共有リンク・検索結果・
 * ブックマークが割れ、どちらが正しいサービスか利用者が迷う(行政情報を扱う非公式サービスとして、
 * 入口は1つに揃えたい)。画面(ページ)の要求は 301 で独自ドメインへ送る。
 *
 * /api/* は転送しない: 外形監視・評価の道具・古いタブのJSが旧URLのAPIを叩いても壊れないように、
 * 移行の間はどちらのホストでも同じ応答を返す(POST を 301 すると GET に化ける実装もある)。
 * CANONICAL_ORIGIN が未設定の環境(ミラー・ローカル)では何もしない。
 */
export function canonicalRedirectTarget(
  url: URL,
  method: string,
  canonicalOrigin: string | undefined,
): string | null {
  if (!canonicalOrigin) return null;
  let canonical: URL;
  try {
    canonical = new URL(canonicalOrigin);
  } catch {
    return null;
  }
  if (url.host === canonical.host) return null;
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null;
  if (url.pathname.startsWith('/api/')) return null;
  return `${canonical.origin}${url.pathname}${url.search}`;
}
