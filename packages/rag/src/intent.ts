/**
 * なぜ: コーパス拡張(Step3で世田谷に学校・保育ページを追加)後、それらのページが本文中で
 * 「転入届」等に繰り返し言及するため、転入届のような一般的な質問でも学校/保育チャンクが
 * ベクトル検索の上位を占有し、resident_registration の正チャンクが top-K の外へ押し出される
 * 回帰が発生した(本番実測)。生成LLMへの指示強化(prompt.ts)だけでは、そもそも正チャンクが
 * プロンプトに載らないため不足。
 *
 * ここでは **決定論的** に、質問文とチャンクの category(手続き種別メタデータ)の対応を
 * カテゴリ別キーワード辞書で判定し、質問が主題とする手続きのチャンクを候補集合の先頭へ
 * 昇格させる(LLM判定は使わない=CLAUDE.md「該当判定をLLchへ任せない」原則)。
 * 呼び出し側は広めの候補プール(FETCH_K)を取得してから本関数で並べ替え、上位 TOP_K のみを
 * 生成プロンプトへ渡す。これにより、埋め込み類似度で下位に沈んだ正手続きチャンクが復活する。
 *
 * 設計上の注意:
 * - 純関数・ケース非依存の一般規則(rag-eval「個別例にチューニングしない」原則)。
 * - 部分文字列一致だが、他手続きに含まれ得る弱い語(例: 生の「転入」は「転入学」に部分一致)は
 *   避け、手続きを一意に主題化する語(「転入届」「国民健康保険」等)のみを採用する。
 * - どのカテゴリにも一致しなければ並べ替えno-op(検索順を尊重)。
 */

/** category(canonicalType) → その手続きを質問が主題とすると判断できるキーワード群。 */
export const CATEGORY_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  // 「転入届」「住民票」「転出証明書」等。生の「転入」は school(転入学)等と衝突するため不採用。
  resident_registration: ['転入届', '住民票', '転出証明書', '住民異動', '住民登録'],
  my_number: ['マイナンバー', '個人番号', '継続利用', 'マイナ'],
  national_health_insurance: ['国民健康保険', '国保'],
  national_pension: ['国民年金'],
  child_benefits: ['児童手当', '特例給付'],
  child_medical: [
    '子ども医療',
    '子ども等医療',
    '医療費助成',
    '医療証',
    'マル乳',
    'マル子',
    'マル青',
  ],
  dog_registration: ['犬', '鑑札', '狂犬病'],
  // 「小学校」「中学校」は「学校」を含む。生の「学校」「転入」は避け、学校転入学を一意化する語のみ。
  school_transfer: ['転校', '転入学', '転学', '小学校', '中学校', '小・中学校'],
  childcare: ['保育園', '保育所', '保育施設', '入園', '認可保育', '保育の申', '保育課'],
  waste_schedule: ['ごみ', 'ゴミ', '資源', '収集', '粗大', '分別'],
} as const;

/** 質問が主題とする手続きの category 集合(辞書キーワードの部分一致で決定)。 */
export function questionCategories(question: string): Set<string> {
  const hit = new Set<string>();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => question.includes(k))) hit.add(category);
  }
  return hit;
}

/** 並べ替え対象が満たすべき最小形状(category を持つ)。 */
export interface CategorizedChunk {
  category: string;
}

/**
 * 質問が主題とする category のチャンクを、元の順序(=検索スコア順)を保ったまま先頭へ昇格させる
 * 安定並べ替え。一致カテゴリが無ければ入力をそのまま返す。破壊的変更はしない(新配列を返す)。
 *
 * maxPromoted: 先頭へ昇格させる一致チャンクの上限。既定は無制限。
 * なぜ上限が要るか(本番実測 2026-08-07 / 練馬区): 1カテゴリのチャンク数が生成窓(TOP_K=6)以上ある区
 * では、昇格した同カテゴリのチャンクだけで窓が埋まり、**検索スコア最上位のチャンクが1件も生成へ
 * 渡らない**。練馬区は「継続利用は転入届出日から90日以内」を my_number ではなく転入届ページに
 * 書いているため、マイナンバーの質問で my_number 9チャンクが窓を占有し、答えを含む
 * resident_registration チャンクが脱落して保留になっていた(答えがコーパスにあるのに保留=過剰保留)。
 * 上限を設けて数枠を検索スコア順に残すことで、カテゴリ判定が外れた場合の取りこぼしを防ぐ。
 * これは「意図に合うカテゴリを優先しつつ、検索の最上位も必ず見せる」という一般規則であり、
 * 特定の区・質問に依存しない。
 */
export function rerankByProcedureIntent<T extends CategorizedChunk>(
  question: string,
  chunks: readonly T[],
  maxPromoted = Number.POSITIVE_INFINITY,
): T[] {
  const target = questionCategories(question);
  if (target.size === 0) return [...chunks];
  const promoted: T[] = [];
  const rest: T[] = [];
  for (const c of chunks) {
    if (target.has(c.category) && promoted.length < maxPromoted) promoted.push(c);
    else rest.push(c);
  }
  return [...promoted, ...rest];
}
