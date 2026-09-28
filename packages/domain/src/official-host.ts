/**
 * なぜ: 再取得(scripts/ingest)も定期巡回(Worker cron。ADR-014)も公式ドメインのみに限定する
 * (CLAUDE.md原則5「非公式まとめサイトを一次根拠にしない」)。許可リストが2か所に分かれると
 * 片方だけ更新されて食い違うため、判定と一覧をこの package に集約し ingest は再エクスポートする。
 *
 * なぜ @tmn/domain に置くか: web のチャット回答で「どのURLをリンクにしてよいか」の判定にも
 * 同じ一覧を使う(プロンプトインジェクションで混入した非公式URLを公式根拠の隣でクリック可能に
 * しないため)。web は @tmn/drift(巡回の分類器・ハッシュ)を必要としないので、web と api と
 * scripts が共通に依存する最小の package へ移した。@tmn/drift は互換のため再エクスポートする。
 */

/**
 * 許可するホスト接尾辞。
 * - `.lg.jp` 地方公共団体(都・区市町村・都オープンデータ・CKAN)
 * - `.go.jp` 国の機関(デジタル庁等)。いずれも登録主体が限定されており公式性が担保される。
 *
 * なぜ `.tokyo.jp` を接尾辞で許可しないか: 東京都内に住所があれば誰でも取得できる
 * 地域ドメインで、ドメイン自体が公式性の証明にならない。区の公式サイトが .tokyo.jp の
 * 場合は下の完全一致リストへ個別に登録する。
 */
export const ALLOWED_HOST_SUFFIXES = ['.lg.jp', '.go.jp'] as const;

/**
 * 接尾辞では表現できない、監査で公式性を確認済みのホストだけを完全一致で許可する。
 * 追加するときは「その組織の公式サイトであること」または「自治体公式ページから
 * リンクされた公式データの配信先であること」を registry.csv の notes に記録すること。
 */
export const ALLOWED_HOST_EXACT = [
  'lg.jp',
  // 公式サイトが .tokyo.jp の区(いずれも当該区の公式サイトであることを監査で確認済み)
  'www.city.suginami.tokyo.jp',
  'www.city.shinagawa.tokyo.jp',
  'www.city.ota.tokyo.jp',
  'www.city.nerima.tokyo.jp',
  'www.city.itabashi.tokyo.jp',
  'www.city.adachi.tokyo.jp',
  'www.city.edogawa.tokyo.jp',
  // Batch9(目黒13110・渋谷13113)。いずれも当該区の公式サイトであることを監査で確認済み
  // (東京都公式「リンク集／都内区市町村」の href と scripts/publish/src/municipalities.ts の
  // officialUrl に一致する)。
  'www.city.meguro.tokyo.jp',
  'www.city.shibuya.tokyo.jp',
  // 港区13103・荒川区13118。承認済みソースがあるのに一覧から漏れており、定期巡回(ADR-014)の
  // 初回で host_not_official(=取得せず判定不能)になった。どちらも東京都公式「リンク集／都内
  // 区市町村」の href と scripts/publish/src/municipalities.ts の officialUrl に一致する公式サイト。
  'www.city.minato.tokyo.jp',
  'www.city.arakawa.tokyo.jp',
  // 八王子市13201(市部で最初の整備対象。2026-09-25 時点で出典はすべて人手レビュー待ち)。
  // 東京都公式「リンク集／都内区市町村」の href(data/sources/13000/snapshots/
  // src-13000-municipalities-001.20260922.html の「八王子市」行)と scripts/publish/src/
  // municipalities.ts の officialUrl(13201)がともに https://www.city.hachioji.tokyo.jp/ で一致する。
  'www.city.hachioji.tokyo.jp',
  // 八王子市子育て応援サイト。市公式サイトのページ「八王子市子育て応援サイトへの移行について」
  // (/kurashi/kosodate/002/001/p028875.html ほか。2026-09-25 取得)が、児童手当・子ども医療費助成・
  // 保育所の情報をこのサイトへ移したと案内している。サイトのフッターは「八王子市役所」と市の
  // 法人番号(1000020132012。市公式サイトのフッターと同一)を掲げる。市が運営する公式サイトとして
  // このホストだけを完全一致で許可する(city.hachioji.tokyo.jp 配下をワイルドカードで開けない)。
  'kosodate.city.hachioji.tokyo.jp',
  // 渋谷区のオープンデータ配信先(Esri ArcGIS Hub 上の区独自ポータル)。区公式サイトの
  // オープンデータ案内および東京都オープンデータカタログの渋谷区データセット
  // (t131130d0000000027「オープンデータ一覧」)からリンクされた、渋谷区自身が管理する
  // 公式データの配信先であることを監査で確認済み(docs/research/opendata-gaps.md 事例15)。
  // 配信基盤が区公式ドメイン外にあるため、arcgis.com をワイルドカードで開けず
  // このホストだけを完全一致で許可する(ユーザー決裁 2026-08-07「今許可する」)。
  'city-shibuya-data.opendata.arcgis.com',
  // 日本郵便(郵便法上の郵便事業提供者。転居届の一次情報源。ADR-009)
  'www.post.japanpost.jp',
  // 中野区のオープンデータ配信先。区公式ページからリンクされた公式データだが配信は
  // 外部GISサービス上にあるため、ワイルドカードにせずこのホストだけを許可する
  // (ユーザー決裁 2026-08-07)。
  'www2.wagmap.jp',
] as const;

/** 公式ドメイン(.lg.jp 配下等)か判定する。純関数(テスト可能)。 */
export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  if (ALLOWED_HOST_EXACT.includes(h as (typeof ALLOWED_HOST_EXACT)[number])) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * URL 文字列が https かつ公式ホストか。例外を投げずに真偽で返す(巡回はソース単位で
 * 記録して先へ進むため、例外ではなく判定値が欲しい)。不正な URL は false。
 */
export function isOfficialUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && isOfficialHost(parsed.hostname);
}
