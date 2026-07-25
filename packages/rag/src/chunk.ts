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
  /**
   * 見出し行の手前でチャンクを区切ってよい最小長。既定 200。
   * なぜ: 期限や資格発生日などの答えが、番号見出し(例「5 資格発生日」)配下の短い節に書かれていても、
   * 前後の無関係な節と同じ 500〜800 字チャンクに埋もれると埋め込み類似度が薄まり、上位 TOP_K の
   * 生成プロンプト枠から落ちて保留・誤答になる(本番実測: 大田 子ども医療「6か月」/品川 マイナンバー「90日」)。
   * 見出し境界を優先的な区切り点として使い、節単位の焦点化されたチャンクを作る。承認済みスナップショット
   * 原文は不変(派生データのみ変更)。
   */
  headingMinChars?: number;
}

const SEP = '\n';

/**
 * 節見出しらしい行か。番号見出し(「5 資格発生日」「5．住所が…」)・括弧見出し(【…】/＜…＞)・
 * 箇条書き記号見出し・「第N章/条/節」等を、短い行に限って検出する。
 * 誤検出を避けるため: 数字直後に区切り(空白/. /．/、)が必要(「6か月」「1週間」「1,000円」は非見出し)、
 * かつ行全体が短い(見出しは短い)ことを要件にする。純関数・ケース非依存。
 */
export function isHeadingLine(line: string): boolean {
  const s = line.trim();
  if (s.length === 0 || s.length > 40) return false;
  // 全角空白は \u3000 で明示する(no-irregular-whitespace 対策)。
  return (
    /^[0-9０-９]{1,2}[ \u3000.．、]\s*\S/u.test(s) || // 「5 資格発生日」「5．住所が変更…」
    /^第[0-9０-９一二三四五六七八九十]+[章条節項編款]/u.test(s) || // 「第3章」「第2条」
    /^[（(][0-9０-９]{1,2}[)）]\s*\S/u.test(s) || // 「(1) …」「（2）…」
    /^【[^】]{1,20}】$/u.test(s) || // 「【申請できる条件】」
    /^＜[^＞]{1,20}＞$/u.test(s) || // 「＜申請時にお子様の…＞」
    /^[■◆●○▶▼◇◎][ \u3000]*\S/u.test(s) || // 記号見出し
    /^[Ss]tep[ \u3000]*[0-9]/u.test(s) // 「Step1」
  );
}

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
  const headingMin = opts.headingMinChars ?? 200;

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
    const overMax = joinLen(current) + addLen > max && joinLen(current) >= min;
    if (overMax) {
      // 上限超過: 従来どおりオーバーラップ付きで区切る。
      chunks.push(current.join(SEP));
      current = overlapTail(current);
    } else if (isHeadingLine(unit) && joinLen(current) >= headingMin) {
      // 見出し境界: 節単位で焦点化する。オーバーラップは持ち越さず、節を清潔に開始する
      // (前節の末尾を引き継ぐと焦点が再び薄まるため)。
      chunks.push(current.join(SEP));
      current = [];
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
