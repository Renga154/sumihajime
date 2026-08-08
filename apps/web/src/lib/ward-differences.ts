import type { WardDifferenceCell, WardDifferencesResponse } from '@tmn/schemas';

/**
 * なぜ: 比較ページ(/differences)の「どの区とくらべるか」の初期値決定と、選択2区ぶんの
 * セル抽出を、UIから切り離した純関数にする(CLAUDE.md §7「純粋関数として書ける判定は純粋関数に」)。
 * 区が増えても表やしきい値をハードコードせず、APIが返した分布から毎回決める。
 */

/** 指定コードのセルをトピックごとに引く(無ければ undefined)。 */
export function cellFor(
  report: WardDifferencesResponse,
  topicId: string,
  municipalityCode: string,
): WardDifferenceCell | undefined {
  return report.topics
    .find((t) => t.topicId === topicId)
    ?.cells.find((c) => c.municipalityCode === municipalityCode);
}

/** 2区が「違う値」になっているトピック数。比較の見どころの多さを表す。 */
export function differingTopicCount(report: WardDifferencesResponse, a: string, b: string): number {
  let n = 0;
  for (const topic of report.topics) {
    const ca = topic.cells.find((c) => c.municipalityCode === a);
    const cb = topic.cells.find((c) => c.municipalityCode === b);
    if (ca && cb && ca.valueId !== cb.valueId) n += 1;
  }
  return n;
}

/**
 * 初期表示でくらべる相手を選ぶ。
 * 「自分の区といちばん違いが多い区」を選ぶことで、最初の1画面で差があること自体が伝わる。
 * 同点は自治体コード昇順で決め、再読み込みしても結果が変わらないようにする(決定論)。
 * 比較できる相手がいない場合は undefined を返し、UIは「比較できません」を出す。
 */
export function pickContrastMunicipality(
  report: WardDifferencesResponse,
  mine: string,
): string | undefined {
  let best: { code: string; count: number } | undefined;
  for (const m of report.municipalities) {
    if (m.code === mine) continue;
    const count = differingTopicCount(report, mine, m.code);
    if (!best || count > best.count) best = { code: m.code, count };
  }
  return best?.code;
}

/** 自治体コード → 名称(APIが返した一覧から引く。UI側に区名を持たない)。 */
export function municipalityNameMap(report: WardDifferencesResponse): Map<string, string> {
  return new Map(report.municipalities.map((m) => [m.code, m.name]));
}
