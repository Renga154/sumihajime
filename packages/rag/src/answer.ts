import type { Confidence, VectorizeMatch } from './types.js';

/**
 * なぜ: §11.6「出典のない事実を生成しないよう出力検証する」。モデル出力の末尾 SOURCES 行を
 * 解析し、検索でヒットした sourceId(許可集合)に解決できる引用だけを残す。1つも残らなければ
 * 呼び出し側が保留応答へ差し替える。抜粋外の捏造sourceIdはここで確実に落とす。
 */

export interface ParsedAnswer {
  /** SOURCES 行を除いた本文。 */
  body: string;
  /** SOURCES 行に列挙された sourceId(生・未検証)。 */
  citedSourceIds: string[];
}

/** 末尾(または最後に現れる)の "SOURCES:" 行を解析して本文と分離する。 */
export function parseAnswer(answer: string): ParsedAnswer {
  const lines = answer.split(/\r?\n/);
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*SOURCES\s*[:：]/i.test(lines[i]!)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { body: answer.trim(), citedSourceIds: [] };

  const raw = lines[idx]!.replace(/^\s*SOURCES\s*[:：]/i, '');
  const citedSourceIds = raw
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const body = lines.slice(0, idx).join('\n').trim();
  return { body, citedSourceIds };
}

/**
 * なぜ: モデルが「①端的な回答」の位置で確認不能(保留)を述べつつ、SOURCES に抜粋を列挙して
 * しまうことがある(本文は保留なのに引用付き=矛盾)。この「保留を主文とする回答」は、引用付きの
 * 実回答として提示すべきでない(§11.5 保留 / §11.6 出力検証)。システムが標準化している保留語彙
 * 「確認できません/確認できませんでした/確認できない」を主文の先頭に検出したら保留とみなす。
 *
 * 一般規則: 正しい回答は事実を先頭に述べる(システムプロンプト⑨「①端的な回答」)。先頭が保留語で
 * 始まる本文は、どの抜粋を引用していても保留として扱う(手続き・自治体に依存しない=個別ケース非依存)。
 */
export function isHoldAnswer(body: string): boolean {
  // 先頭の列挙・装飾記号(①②③ / 1. / - / ・ 等)を剥がしてから判定する。
  // \s は全角空白(U+3000)を含む。角括弧等の稀な装飾は対象外(過剰に剥がして本文を誤判定しないため)。
  const head = body.replace(/^[\s①-⑳0-9.．、。:：)）(（\-—・*＊#＃「」『』"'`>＞]+/u, '');
  return /^確認でき(ませんでした|ません|ない)/u.test(head);
}

/**
 * 引用検証: cited のうち allowed(検索でヒットしたsourceId集合)に含まれるものだけを、
 * 重複除去・順序保持で返す。allowed 外の捏造引用は除外される。
 */
export function validateCitations(citedSourceIds: string[], allowed: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of citedSourceIds) {
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * cosine スコア(高いほど近い)→ 確度ラベル。閾値未満はそもそも保留になる想定。
 *
 * 注意(ADR-010): この値は **UIに表示しない**。検索スコアは「質問に近い抜粋が見つかったか」を
 * 表すだけで、**回答の正しさを表さない**(実測: 持ち物を統合し損ねた誤答にも 'high' が付いた)。
 * 評価・計測のための内部値として残している。利用者向けの品質シグナルは
 * 「保留かどうか」と「公式根拠(出典・最終確認日)」に一本化した。
 */
export function confidenceFromScore(topScore: number | undefined): Confidence {
  if (topScore === undefined) return 'unknown';
  if (topScore >= 0.5) return 'high';
  if (topScore >= 0.4) return 'medium';
  if (topScore >= 0.3) return 'low';
  return 'unknown';
}

/** §11.5: 閾値以上のマッチが1件も無ければ保留(確認できません)。 */
export function shouldAbstain(matches: VectorizeMatch[], minScore: number): boolean {
  return matches.filter((m) => m.score >= minScore).length === 0;
}

/** 閾値以上のマッチのみを、スコア降順で返す(生成に渡す抜粋の選別)。 */
export function selectMatches(matches: VectorizeMatch[], minScore: number): VectorizeMatch[] {
  return matches.filter((m) => m.score >= minScore).sort((a, b) => b.score - a.score);
}
