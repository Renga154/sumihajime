/**
 * なぜ: ADR-014 の測定で、生バイトの SHA-256 は HTML の 14/20 件で理由なく揺れ(CSRFトークン・
 * 広告・ナビ)、信号にならなかった。一方、自治体ページ自身が掲げる「更新日：令和8年9月15日」の
 * 変化は標本内で誤検知ゼロだった。「自治体が更新したと宣言した」ことをそのまま信号にする。
 *
 * 基準値は publish 時に承認時スナップショットからこの同じ関数で機械的に得る(人手記入の
 * source_last_modified_at は 248 件中 17 件が本文表記と食い違っており基準にできない)。
 * publish(Node)と Worker(cron)で同一の純関数を共有するため、この package に置く。
 */

/**
 * 「更新日」系ラベル。ページ内で最初に日付が続くラベル出現を採用する
 * (Python の測定用正規表現と同じ語彙。台帳の人手記入値と 231/248 で一致した)。
 */
const LABEL_RE = /(最終更新日|更新日|ページ更新日|更新年月日|最終更新)/g;

/**
 * ラベルの直後に日付を探す窓の長さ。
 * なぜ約200文字か: 渋谷区のように `<p class="update-hdg">更新日</p><p class="update-date">
 * 2026年5月28日</p>` とラベルと日付の間にタグが挟まる形式があり、タグを剥いだ後でも
 * 日付までにクラス名等で数十〜百文字程度が入る。広げすぎると無関係な日付(ページ末尾の
 * 年度表記等)を拾うため、ここで止める。
 */
const WINDOW_CHARS = 200;

/**
 * 日付の3形式(順に試す)。
 *  1. 令和N年M月D日(令和N = 2018+N)
 *  2. YYYY年M月D日
 *  3. YYYY/M/D・YYYY.M.D・YYYY-M-D
 * ラベルと日付の間には任意の `:`/`：` と空白を許す。
 */
const DATE_AFTER_LABEL_RE =
  /^[\s:：]*(?:令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日|(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{4})[/.-](\d{1,2})[/.-](\d{1,2}))/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string | null {
  // なぜ範囲検査するか: 「更新日：2026年13月40日」のような壊れた表記を日付として返さない
  // (UTC で組み立てて月日が繰り上がらないことを確認する=決定論的)。
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function matchDate(text: string): string | null {
  const m = DATE_AFTER_LABEL_RE.exec(text);
  if (!m) return null;
  if (m[1] !== undefined) {
    return toIso(2018 + Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (m[4] !== undefined) {
    return toIso(Number(m[4]), Number(m[5]), Number(m[6]));
  }
  return toIso(Number(m[7]), Number(m[8]), Number(m[9]));
}

/**
 * HTML からページ自身の「更新日」を ISO(YYYY-MM-DD)で抽出する。無ければ null。
 *
 * 手順: ラベル出現ごとに直後 WINDOW_CHARS 文字を取り、タグを剥いでから日付を探す。
 * 最初に日付が得られたラベル出現を採用する(ラベルはあるが日付が続かない出現は読み飛ばす)。
 * 本文全体のテキスト抽出はしない(Workers Free の CPU 10ms に収めるため。ADR-014)。
 */
export function extractPageUpdatedOn(html: string): string | null {
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(html)) !== null) {
    const start = m.index + m[0].length;
    const window = html.slice(start, start + WINDOW_CHARS).replace(/<[^>]*>/g, '');
    const iso = matchDate(window);
    if (iso) return iso;
  }
  return null;
}
