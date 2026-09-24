/**
 * 再監査(docs/ops/reaudit.md)の機械チェック部分。純関数。
 *
 * なぜ「数値の事実」を見るのか: 公開している手続きの文言は公式ページの言い換えであり、文字列の
 * 完全一致では照合できない。一方、利用者に実害が出る変化はほぼ「数の変化」(期限の日数・
 * 月数・年齢・日付・金額)として現れる。公開文言に含まれる数の事実を抜き出し、承認時の原文と
 * 現在の原文のそれぞれに現れるかを見れば、「根拠が消えた事実」を機械的に拾える。
 * 判定はしない(最後に読むのは人)。拾うだけ。
 */

const FULLWIDTH_DIGITS = /[０-９]/g;

/** 照合用の正規化: 全角数字→半角、「ヶ月/カ月/ケ月/箇月/か月」→「か月」、空白除去。 */
export function normalizeForFacts(s: string): string {
  return s
    .replace(FULLWIDTH_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/(\d+)\s*[ヶカケ箇か]\s*月/g, '$1か月')
    .replace(/[\s\u3000]+/g, '');
}

/**
 * 文から「数＋単位」の事実を抜き出す(正規化済みの表記で返す。重複なし・出現順)。
 * 例: 「翌日から3ヶ月以内」→ ['3か月']、「18歳に達する日以後の最初の3月31日」→ ['18歳','3月31日']
 */
export function extractNumericFacts(text: string): string[] {
  const s = normalizeForFacts(text);
  const out: string[] = [];
  const push = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  // 月日(3月31日)を先に取り、その「31日」を単独の日数として二重に数えない。
  const withoutDates = s.replace(/(\d{1,2})月(\d{1,2})日/g, (m) => {
    push(m);
    return ' ';
  });
  for (const m of withoutDates.matchAll(/(\d+)(か月|日|歳|年|週間|時間|円)/g)) push(m[0]);
  return out;
}

export interface FactPresence {
  fact: string;
  inOld: boolean;
  inNew: boolean;
}

/**
 * 公開文言の事実が、承認時の原文と現在の原文に現れるか。
 * 注目すべきは inOld && !inNew(根拠が消えた)。!inOld の事実はもともと別ページ由来か言い換えで、
 * 今回の差分とは無関係なので参考扱い。
 */
export function checkFacts(
  publishedTexts: readonly string[],
  oldPage: string,
  newPage: string,
): FactPresence[] {
  const oldN = normalizeForFacts(oldPage);
  const newN = normalizeForFacts(newPage);
  const facts: string[] = [];
  for (const t of publishedTexts)
    for (const f of extractNumericFacts(t)) if (!facts.includes(f)) facts.push(f);
  return facts.map((fact) => ({ fact, inOld: oldN.includes(fact), inNew: newN.includes(fact) }));
}

/** 差分の行が「更新日の表記だけ」か(レビューで読み飛ばしてよい行)。 */
export function isDateOnlyLine(line: string): boolean {
  const s = normalizeForFacts(line);
  return /^(最終)?(ページ)?更新(日|年月日)?[:：]?(令和\d+年\d+月\d+日|\d{4}年\d{1,2}月\d{1,2}日|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})$/.test(
    s,
  );
}
