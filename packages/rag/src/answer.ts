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

/** cosine スコア(高いほど近い)→ 確度ラベル。閾値未満はそもそも保留になる想定。 */
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
