import type { RagChunk, RagChunkMetadata } from './types.js';

/**
 * なぜ: 本文抽出済みテキスト行(@tmn/ingest の extractTextLines と同方針で script/form/nav は
 * 除去済み)を、埋め込み・検索に適した 500〜800字・オーバーラップ付きのチャンクへ分割する。
 * オーバーラップにより、チャンク境界をまたぐ文脈(見出し→本文など)の取りこぼしを減らす。
 */

export interface ChunkOptions {
  /** チャンクを閉じてよい最小長。既定 500。 */
  minChars?: number;
  /** チャンクの目標上限長。既定 800。 */
  maxChars?: number;
  /** 隣接チャンク間で重ねる末尾の長さ。既定 120。 */
  overlapChars?: number;
}

const SEP = '\n';

function joinLen(arr: string[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((n, s) => n + s.length, 0) + (arr.length - 1) * SEP.length;
}

/**
 * 行配列 → チャンク文字列配列。
 * - 1行が maxChars を超える場合は文字数で機械分割してから詰める。
 * - チャンクを閉じるたびに、直前チャンクの末尾から overlapChars 以内の行を次チャンク先頭へ引き継ぐ。
 * - オーバーラップにより各チャンクは最大で maxChars + overlapChars 程度になりうる。
 */
export function chunkLines(lines: string[], opts: ChunkOptions = {}): string[] {
  const min = opts.minChars ?? 500;
  const max = opts.maxChars ?? 800;
  const overlap = opts.overlapChars ?? 120;

  // 長すぎる行を先に分割(単一行が max を超えると詰め処理が破綻するため)。
  const units: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length <= max) {
      units.push(trimmed);
    } else {
      for (let i = 0; i < trimmed.length; i += max) units.push(trimmed.slice(i, i + max));
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];

  const overlapTail = (arr: string[]): string[] => {
    const tail: string[] = [];
    let tailLen = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const l = arr[i]!;
      const add = (tail.length === 0 ? 0 : SEP.length) + l.length;
      if (tailLen + add > overlap) break;
      tail.unshift(l);
      tailLen += add;
    }
    return tail;
  };

  for (const unit of units) {
    const addLen = (current.length === 0 ? 0 : SEP.length) + unit.length;
    if (joinLen(current) + addLen > max && joinLen(current) >= min) {
      chunks.push(current.join(SEP));
      current = overlapTail(current);
    }
    current.push(unit);
  }
  if (joinLen(current) > 0) chunks.push(current.join(SEP));

  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * 1ソース分の本文行 → RagChunk[]。id は "<sourceId>#<連番>" で冪等な差し替えを可能にする。
 */
export function buildSourceChunks(
  lines: string[],
  metadata: RagChunkMetadata,
  opts: ChunkOptions = {},
): RagChunk[] {
  return chunkLines(lines, opts).map((text, seq) => ({
    id: `${metadata.sourceId}#${seq}`,
    seq,
    text,
    metadata,
  }));
}
