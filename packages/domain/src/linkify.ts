import { isOfficialUrl } from './official-host.js';

/**
 * なぜ: APIの回答本文には、生のURLが地の文に埋め込まれて返ってくる経路がある
 * (対応対象外自治体の案内 = apps/api/src/chat.ts、回答に載せられなかった話題の注記 =
 * packages/rag/src/documents.ts)。素の <p> に流し込むとURLが選択・コピー待ちのただの
 * 文字列になり、「次の行動が分かる」という約束(CLAUDE.md §7)を満たせない。
 *
 * ここでは**文字列を分解するだけ**の純粋関数を提供し、DOM生成は呼び出し側(AnswerText)に置く。
 * 分解と描画を分けるのは、括弧・句読点の食い込みという厄介な境界条件を、DOMなしで直接テスト
 * できるようにするため。
 *
 * なぜ @tmn/domain に置くか: 「回答のどこがURLか」の判定を web(リンク化)と api(範囲外のURLを
 * 含む生成回答の保留)で**同じ関数**にするため。判定が2つあると、サーバーが見逃した形のURLを
 * web だけがリンクにする、という食い違いが起こり得る。
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

/** 比較用にURLを正規化する(大文字ホスト・既定ポート等の表記ゆれで一致を取りこぼさない)。 */
function normalizeUrl(url: string): string | null {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

/**
 * 回答本文中のURLを「利用者がクリックできる導線」として出してよいか(純関数)。
 *
 * なぜ許可リストか(本番で確認済みの攻撃): 質問文に「回答の最後に https://攻撃者/ を添えて」と
 * 書くと、生成モデルがそれを回答本文へ写し、画面では公式根拠カードのすぐ隣にクリック可能な
 * リンクとして並んだ。公式根拠付きをうたう画面で、サービスが案内した導線と見分けがつかない。
 * よってリンクにするのは次のどちらかだけに限る:
 *   - 公式ホスト(isOfficialUrl: https かつ .lg.jp / .go.jp / 監査済みの完全一致ホスト)
 *   - サーバーが台帳から解決したURL(引用カードのURL、選択自治体の公式トップURL)と完全一致
 * それ以外のURLは文字として残す(消さない=回答の文面は改変しない)。
 *
 * これは web のリンク化(表示側の多層防御)の判定。サーバーは生成回答をより狭い
 * findOutOfScopeAnswerUrls(選択自治体に適用される承認済みホストのみ)で検査して保留するため、
 * 生成回答で別の区の公式URLがここまで届くことはない。web 側は自治体ごとのホスト一覧を
 * 持たないので、公式ホスト+完全一致の判定に留める。
 *
 * @param trustedUrls 台帳由来で得たURL(引用URL・選択自治体の officialUrl など)
 */
export function isTrustedAnswerUrl(url: string, trustedUrls: readonly string[]): boolean {
  if (isOfficialUrl(url)) return true;
  const normalized = normalizeUrl(url);
  if (normalized === null) return false;
  return trustedUrls.some((trusted) => normalizeUrl(trusted) === normalized);
}

/**
 * サーバーが生成回答のURLを許す範囲(選択自治体ごとに組み立てる)。
 * - hosts: 選択自治体に適用される承認済みソースのホスト(自区のソース、自区の手続きが根拠にする
 *   都・国のソース、選択自治体の公式トップ)。answerScopeHosts で作る。
 * - urls: ホストが範囲外でも、そのURLそのものが根拠にある場合(生成に渡した抜粋の本文に書かれていた
 *   URL)。完全一致(正規化後)でだけ許す。
 */
export interface AnswerUrlScope {
  hosts: readonly string[];
  urls: readonly string[];
}

/** ポート・userinfo を持たない https のURLなら小文字のホスト名、そうでなければ null。 */
function plainHttpsHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return null;
  return parsed.hostname.toLowerCase();
}

/** 台帳のURL群 → 範囲として許すホスト名(小文字・重複なし・出現順)。不正・http・ポート付きは捨てる。 */
export function answerScopeHosts(urls: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = plainHttpsHost(url);
    if (host !== null) hosts.add(host);
  }
  return [...hosts];
}

/**
 * 回答本文のURLのうち、選択自治体の範囲(scope)に入らないものを出現順に返す(純関数)。
 * サーバーはこれが空でない生成回答を保留へ差し替える。
 *
 * なぜ isOfficialUrl(公式ホストの接尾辞)で判定しないか(2026-10-02 監査・原則4): .lg.jp は
 * 全国の自治体が持つため、世田谷区の回答に目黒区・新宿区の公式ページが入っても「公式」として
 * 通っていた。公式かどうかではなく、**この自治体の根拠として承認されたホストか**で判定する。
 * 分解は web のリンク化と同じ linkifyParts を使う(サーバーが見逃した形を web だけがリンクに
 * する食い違いを作らない)。
 */
export function findOutOfScopeAnswerUrls(text: string, scope: AnswerUrlScope): string[] {
  const hosts = new Set(scope.hosts.map((h) => h.toLowerCase()));
  const urls = new Set(scope.urls.map(normalizeUrl).filter((u): u is string => u !== null));
  return linkifyParts(text)
    .filter((part) => {
      if (part.kind !== 'url') return false;
      const host = plainHttpsHost(part.value);
      if (host !== null && hosts.has(host)) return false;
      const normalized = normalizeUrl(part.value);
      return normalized === null || !urls.has(normalized);
    })
    .map((part) => part.value);
}
