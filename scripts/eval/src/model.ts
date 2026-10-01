/**
 * なぜ: 評価レポートに「どのモデルの回答を採点したか」を残す(モデルの差し替えや既定値の変更で
 * 正答率が動いたとき、原因を切り分けるため)。/api/chat の応答に model があればケースごとに記録する。
 *
 * 2026-10-02 時点の /api/chat は model を返さない(chatResponseSchema は strictObject で model を
 * 持たない)ので、記録は null(レポートでは「不明」)になる。API が将来 model を返すようになっても
 * 評価が「スキーマ違反」で止まらないよう、厳格スキーマで読む前に取り外す。
 *
 * model の値は外部(API)から来てレポートの Markdown にそのまま出るので、モデル名として
 * ありうる文字だけを許し、それ以外は記録しない(改行や HTML でレポートを崩させない)。
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

export function extractModel(body: unknown): { model: string | null; body: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('model' in body)) {
    return { model: null, body };
  }
  const { model, ...rest } = body as Record<string, unknown>;
  return {
    model: typeof model === 'string' && MODEL_NAME.test(model) ? model : null,
    body: rest,
  };
}

/** ケース結果に現れたモデル名(重複なし・出現順)。 */
export function modelsSeen(results: readonly { model?: string | null }[]): string[] {
  const seen: string[] = [];
  for (const r of results) {
    if (r.model && !seen.includes(r.model)) seen.push(r.model);
  }
  return seen;
}
