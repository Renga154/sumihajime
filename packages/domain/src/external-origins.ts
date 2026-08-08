/**
 * ブラウザから直接叩く外部オリジンの単一の真実。
 *
 * なぜ共有パッケージに置くのか: 同じオリジンを web(実際にリクエストする側)と
 * api(Content-Security-Policy の許可リスト)の両方が持つ必要がある。別々に書くと
 * 「タイル配信元を変えたのにCSPが古いまま=地図だけ無言で真っ白」という、
 * ブラウザを開くまで気づけない壊れ方をする。定義を1か所にしてズレを構造的に防ぐ。
 */

/** 国土地理院の地理院タイル配信オリジン(ADR-005 で利用条件を検証済み)。 */
export const GSI_TILE_ORIGIN = 'https://cyberjapandata.gsi.go.jp';

/** 地理院タイル(標準地図)のURLテンプレート。 */
export const GSI_STD_TILE_URL = `${GSI_TILE_ORIGIN}/xyz/std/{z}/{x}/{y}.png`;

/** ブラウザが外部へ出す通信先(CSP の img-src / connect-src 許可リストの元データ)。 */
export const BROWSER_EXTERNAL_ORIGINS = [GSI_TILE_ORIGIN] as const;
