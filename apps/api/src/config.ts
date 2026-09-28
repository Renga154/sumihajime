/**
 * wrangler.jsonc の vars(文字列)を数値設定へ読み替える純関数群。
 *
 * なぜ専用の関数か: 以前は `Number(env.X)` や `Number(env.X) || 既定値` で読んでいた。
 * 前者は空文字・誤記で NaN になり(巡回の LIMIT ? に NaN が入る)、後者は正当な 0 まで
 * 既定値へ化かす(RAG_MIN_SCORE='0' が黙って 0.3 になる)。どちらも設定ミスが静かに
 * 別の値で動く壊れ方なので、「形式が正しければその値、そうでなければ既定値」に統一する。
 */

/** 10進の非負整数だけを受け付ける(指数表記・小数・符号・空白入りは設定ミスとみなす)。 */
function parseNonNegativeInt(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}

/** チャットの全体1日上限の既定値(OpenAI への課金リクエストを伴う質問の件数)。 */
export const DEFAULT_CHAT_DAILY_LIMIT = 1500;

/**
 * CHAT_DAILY_LIMIT を読む。0 は「本日は生成を受け付けない」の意味で有効(緊急停止に使える)。
 * 不正・未設定は既定値(NaN にしない。NaN だと `count > NaN` が常に偽になり上限が消える)。
 */
export function parseChatDailyLimit(raw: string | undefined): number {
  return parseNonNegativeInt(raw) ?? DEFAULT_CHAT_DAILY_LIMIT;
}

/** 検索スコア閾値の既定値(cosine類似度)。 */
export const DEFAULT_MIN_SCORE = 0.3;

/** RAG_MIN_SCORE を読む。0〜1 の10進小数のみ有効(0 も有効=閾値なし)。 */
export function parseMinScore(raw: string | undefined): number {
  const s = (raw ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return DEFAULT_MIN_SCORE;
  const n = Number(s);
  return n >= 0 && n <= 1 ? n : DEFAULT_MIN_SCORE;
}

/** 定期巡回1回あたりの件数の既定値(ADR-014)。 */
export const DEFAULT_DRIFT_BATCH_SIZE = 10;
/**
 * 上限。Workers Free の外部サブリクエストは1実行50(リダイレクトの各ホップを含む)。
 * これを超える件数は1回の実行で取り切れないので、設定ミスとして既定値へ戻す。
 */
export const MAX_DRIFT_BATCH_SIZE = 50;

/** DRIFT_BATCH_SIZE を読む。1〜50 の整数のみ有効。 */
export function parseDriftBatchSize(raw: string | undefined): number {
  const n = parseNonNegativeInt(raw);
  return n !== null && n >= 1 && n <= MAX_DRIFT_BATCH_SIZE ? n : DEFAULT_DRIFT_BATCH_SIZE;
}
