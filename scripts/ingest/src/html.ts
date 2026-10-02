/**
 * なぜ: HTML差分は生タグ込みだとノイズ(スクリプト・スタイル・ナビの微差)で埋もれる。
 * ADR-004のRAG本文抽出と同じ方針で script/style/nav/header/footer/コメントを除去し、
 * 本文テキストの行diff要約だけを出すことで「本当に中身が変わったか」を人が判断できる。
 * 依存を足さず正規表現ベースで十分な近似を行う(取込レビューの一次シグナル用途)。
 */

const STRIP_BLOCKS = ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'template'];

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * 数値文字参照のコードポイント → 文字。原文(外部入力)が値を決めるので、文字にしてはいけない値は
 * HTML の仕様と同じく置換文字(U+FFFD)にする:
 * - NUL・範囲外(> U+10FFFF。String.fromCodePoint は RangeError を投げ、索引の構築ごと落ちる)
 * - サロゲート(単独では文字にならず、UTF-8 で書くと化ける)
 * - TAB/LF/CR 以外の C0 制御文字と DEL(後段のシード SQL 生成が拒否する値。1ページの参照で
 *   全体を止めない)
 */
function codePointToChar(cp: number): string {
  if (
    !Number.isSafeInteger(cp) ||
    cp === 0 ||
    cp > 0x10ffff ||
    (cp >= 0xd800 && cp <= 0xdfff) ||
    (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
    cp === 0x7f
  ) {
    return '�';
  }
  return String.fromCodePoint(cp);
}

function decodeEntities(s: string): string {
  let out = s.replace(/&#(\d+);/g, (_, d: string) => codePointToChar(Number(d)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePointToChar(parseInt(h, 16)));
  for (const [name, ch] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(name).join(ch);
  }
  return out;
}

/** 中身を持たない要素(開始タグだけを除けばよい)。 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const START_OR_END_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const HIDING_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important\s*)?(?:;|$)/i;

/**
 * 開始タグの属性から「画面に表示されない要素」かを判定する。CSS ファイルは読まないので、
 * 属性だけで分かるもの(hidden / aria-hidden="true" / インラインの display:none・visibility:hidden)に限る。
 */
function isHiddenStartTag(attrs: string): boolean {
  ATTRIBUTE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTRIBUTE.exec(attrs)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    if (name === 'hidden') return true;
    if (name === 'aria-hidden' && value?.trim().toLowerCase() === 'true') return true;
    if (name === 'style' && value !== undefined && HIDING_STYLE.test(value)) return true;
  }
  return false;
}

/** from 以降で、name 要素の対応する閉じタグの直後の位置。入れ子を数える。無ければ null。 */
function findMatchingClose(s: string, name: string, from: number): number | null {
  const re = new RegExp(`<(/?)${name}\\b([^>]*)>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) return re.lastIndex;
    } else if (!/\/\s*$/.test(m[2] ?? '')) {
      depth += 1;
    }
  }
  return null;
}

/**
 * 画面に表示されない要素を中身ごと除く。
 *
 * なぜ: REQUIREMENTS §11.6(RAG の本文からスクリプト・フォーム・ナビ・広告を除く)。表示されない
 * 要素の文字は利用者にも、承認時に原文を見たレビュアにも見えないのに、索引に入るとチャットの
 * 回答根拠になる。公式ページが改ざんされたときの間接プロンプトインジェクションの経路なので除く。
 * 入れ子の同名要素は数えて対応する閉じタグまで除く。閉じタグが見つからない(<p> の省略など)
 * ときは開始タグだけを除く(後続の表示される本文まで消さないため)。
 */
export function stripHiddenElements(html: string): string {
  let out = '';
  let last = 0;
  START_OR_END_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START_OR_END_TAG.exec(html)) !== null) {
    if (m[1] === '/' || !isHiddenStartTag(m[3] ?? '')) continue;
    const name = m[2]!.toLowerCase();
    let end = START_OR_END_TAG.lastIndex;
    if (!VOID_ELEMENTS.has(name)) {
      const close = findMatchingClose(html, name, end);
      if (close !== null) end = close;
    }
    out += html.slice(last, m.index);
    last = end;
    START_OR_END_TAG.lastIndex = end;
  }
  return out + html.slice(last);
}

/** HTML → 本文テキスト行の配列(空行除去・trim済み)。 */
export function extractTextLines(html: string): string[] {
  let s = html;
  // コメント除去。
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // ノイズブロックを中身ごと除去。
  for (const tag of STRIP_BLOCKS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '');
  }
  // 表示されない要素を中身ごと除去(間接プロンプトインジェクション対策)。
  s = stripHiddenElements(s);
  // ブロック境界を改行に(段落・見出し・li・tr・div・br 等)。
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dl|dd|dt)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // 残りのタグを除去。
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

export interface LineDiffSummary {
  addedCount: number;
  removedCount: number;
  /** 追加された行(先頭 sampleLimit 件)。 */
  addedSample: string[];
  /** 削除された行(先頭 sampleLimit 件)。 */
  removedSample: string[];
}

/**
 * 旧本文と新本文の行集合diff要約。順序ではなく集合差で「増えた行/消えた行」を出す
 * (取込レビューの一次シグナルには十分で、誤検知が少ない)。
 */
export function summarizeLineDiff(
  oldText: string,
  newText: string,
  sampleLimit = 8,
): LineDiffSummary {
  const oldLines = new Set(extractTextLines(oldText));
  const newLines = extractTextLines(newText);
  const oldArr = [...oldLines];
  const newSet = new Set(newLines);

  const added: string[] = [];
  for (const line of newLines) {
    if (!oldLines.has(line) && !added.includes(line)) added.push(line);
  }
  const removed: string[] = [];
  for (const line of oldArr) {
    if (!newSet.has(line)) removed.push(line);
  }
  return {
    addedCount: added.length,
    removedCount: removed.length,
    addedSample: added.slice(0, sampleLimit),
    removedSample: removed.slice(0, sampleLimit),
  };
}
