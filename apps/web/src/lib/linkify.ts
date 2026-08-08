/**
 * なぜ: APIの回答本文には、生のURLが地の文に埋め込まれて返ってくる経路がある
 * (対応対象外自治体の案内 = apps/api/src/chat.ts、回答に載せられなかった話題の注記 =
 * packages/rag/src/documents.ts)。素の <p> に流し込むとURLが選択・コピー待ちのただの
 * 文字列になり、「次の行動が分かる」という約束(CLAUDE.md §7)を満たせない。
 *
 * ここでは**文字列を分解するだけ**の純粋関数を提供し、DOM生成は呼び出し側(AnswerText)に置く。
 * 分解と描画を分けるのは、括弧・句読点の食い込みという厄介な境界条件を、DOMなしで直接テスト
 * できるようにするため。
 */

export type AnswerPart =
  | { kind: 'text'; value: string }
  /** http(s) のURL。**この値がそのまま href になる**ので、余分な記号を含めてはならない。 */
  | { kind: 'url'; value: string };

/**
 * URLとして拾う文字は RFC 3986 の許可文字(ASCII)だけに限る。
 *
 * なぜ「空白まで」ではないか: 本文は日本語で、URLの直後に助詞や句点が空白なしで続く
 * (「…(https://example.lg.jp/)でご確認ください。」)。除外リスト方式だと、除外し忘れた
 * かな・漢字までURLに飲み込まれる。許可リストなら日本語文字で自然に停止する。
 *
 * 副作用: パスに非ASCII(日本語)を含むURLは途中で切れる。都・区の公式URLは実測でいずれも
 * ASCIIであり、切れたリンクを作るより、リンクにしない方が安全側に倒れる。
 */
const URL_CHARS = "A-Za-z0-9\\-._~:/?#[\\]@!$&'()*+,;=%";
const URL_PATTERN_SOURCE = `https?://[${URL_CHARS}]+`;

/** 文末・引用の閉じ記号としてURLの外にあることが多いASCII記号。 */
const TRAILING_PUNCTUATION = /[.,;:!?'"]/;

function countChar(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n += 1;
  return n;
}

/**
 * URLの末尾に紛れ込んだ文の記号を落とす。
 *
 * `)` `]` は開き括弧の数と突き合わせる。半角括弧つきの案内文
 * 「公式サイト(https://example.lg.jp/)で…」では閉じだけが余るので落とし、
 * 括弧を含む正規のURL(https://example.org/foo_(bar))では釣り合うので残す。
 * 全角括弧（）は URL_CHARS に無いため、そもそも一致しない。
 */
function trimTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const last = out.at(-1);
    if (last === undefined) return out;
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      if (countChar(out, last) <= countChar(out, open)) return out;
    } else if (!TRAILING_PUNCTUATION.test(last)) {
      return out;
    }
    out = out.slice(0, -1);
  }
}

/** スキームだけになっていないか(ホストが1文字以上残っているか)。 */
function hasHost(url: string): boolean {
  return /^https?:\/\/[^/?#]/.test(url);
}

/**
 * 回答本文を「地の文」と「URL」へ分解する。URLが1つも無ければ全体が1つの text になる。
 * 元の文字列は復元可能(結合すると入力と一致する)で、改行もそのまま text 側に残る。
 */
export function linkifyParts(text: string): AnswerPart[] {
  // lastIndex の持ち越しを避けるため、呼び出しごとに正規表現を作る。
  const pattern = new RegExp(URL_PATTERN_SOURCE, 'g');
  const parts: AnswerPart[] = [];
  let lastIndex = 0;

  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const url = trimTrailingPunctuation(match[0]);
    // ホストの無い断片(https:// だけ等)はリンクにせず、地の文として残す。
    if (!hasHost(url)) continue;
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ kind: 'url', value: url });
    lastIndex = match.index + url.length;
  }

  if (lastIndex < text.length) parts.push({ kind: 'text', value: text.slice(lastIndex) });
  return parts;
}
