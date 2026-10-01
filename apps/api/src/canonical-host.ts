/**
 * 入口の一本化: 平文HTTP → https、旧URL・www → 独自ドメイン(sumihajime.com)。
 *
 * なぜ: 同じ画面が workers.dev の旧URLと独自ドメインの両方で見えると、共有リンク・検索結果・
 * ブックマークが割れ、どちらが正しいサービスか利用者が迷う(行政情報を扱う非公式サービスとして、
 * 入口は1つに揃えたい)。画面(ページ)の要求は 301 で独自ドメインへ送る。
 *
 * /api/* は独自ドメインへは転送しない: 外形監視・評価の道具・古いタブのJSが旧URLのAPIを叩いても
 * 壊れないように、移行の間はどちらのホストでも同じ応答を返す(POST を 301 すると GET に化ける
 * 実装もある)。CANONICAL_ORIGIN が未設定の環境(ミラー・ローカル)では独自ドメインへは送らない。
 */

/**
 * ループバック(ローカル開発)のホスト名か。URL.hostname は IPv6 を角括弧付きで返す。
 * なぜ: wrangler dev / Vite は http://localhost で動く。ここに https を強制すると手元で開けなくなる。
 * 本番の要求がこのホスト名で届くことは無い(Cloudflare のエッジは登録したホスト名でしか受けない)。
 */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

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
  if (isLoopbackHostname(url.hostname)) return null;
  if (url.pathname.startsWith('/api/')) return null;
  return `${canonical.origin}${url.pathname}${url.search}`;
}

/**
 * 入口で返す判断。redirect は 301 の転送先、reject は「平文HTTPで本文を送ってきた」ので断る。
 */
export type EntryDecision = { kind: 'redirect'; location: string } | { kind: 'reject_insecure' };

/**
 * 平文HTTPと非正典ホストをまとめて判断する(index.ts の最初のミドルウェアが使う)。
 *
 * なぜ平文HTTPを Worker でも断るのか: 以前は canonicalRedirectTarget がホスト名しか見ておらず、
 * http://sumihajime.com/ や /api/health が平文のまま 200 を返していた。HSTS はブラウザが一度
 * https で訪れた後にしか効かないため、初回の平文アクセス(手打ち・古いリンク)はサーバー側で
 * 送り直すしかない。CANONICAL_ORIGIN が空のミラーにも効くよう、独自ドメインの設定とは独立に判断する。
 *
 * なぜ転送を1回にまとめるのか: http://旧URL/画面 を「https://旧URL → https://独自ドメイン」と
 * 2段で送ると、1段目が平文のまま別ホストを経由し、往復も増える。行き先が決まっているなら直接送る。
 *
 * なぜ POST 等は転送せず断るのか: 301/302 で POST が GET に化けるブラウザ・ライブラリがあり、
 * 本文(世帯属性・質問)は既に平文で経路上を流れてしまっている。転送して処理を続けるより、
 * 失敗を返して https で送り直させるほうが安全側。
 */
export function entryDecision(
  url: URL,
  method: string,
  canonicalOrigin: string | undefined,
): EntryDecision | null {
  const canonicalTarget = canonicalRedirectTarget(url, method, canonicalOrigin);
  const insecure = url.protocol === 'http:' && !isLoopbackHostname(url.hostname);
  if (insecure) {
    if (method !== 'GET' && method !== 'HEAD') return { kind: 'reject_insecure' };
    // 独自ドメインの転送先は常に https(CANONICAL_ORIGIN は https で設定する)。
    return {
      kind: 'redirect',
      location: canonicalTarget ?? `https://${url.host}${url.pathname}${url.search}`,
    };
  }
  return canonicalTarget ? { kind: 'redirect', location: canonicalTarget } : null;
}
