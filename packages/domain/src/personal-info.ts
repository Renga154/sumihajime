/**
 * 個人情報(マイナンバー・電話番号・メールアドレス)の検出と、回答中の連絡先の根拠照合(純関数)。
 *
 * なぜ @tmn/domain に置くか: CLAUDE.md 原則6「電話・メール・マイナンバーを収集しない」を、
 * 送信前の web(入力欄の直下で止める)と受信直後の api(422 で断る)で**同じ判定**にするため。
 * 判定が2つあると、web だけが止めて api は通す(またはその逆)という食い違いが起きる。
 *
 * 検出は「止めるべき形」を狙い撃ちにし、普通の質問に現れる数字(日付・年度・郵便番号・金額・
 * 時刻・日数)は誤検知しないことを優先する。誤検知は利用者の正当な質問を送れなくするため、
 * 境界は personal-info.test.ts の負例で固定している。
 *
 * 入力はすべて NFKC で正規化してから見る。全角数字・全角ハイフン・全角＠で書かれても同じ扱いに
 * するため(日本語入力では全角のまま打たれることが多い)。
 */

export type PersonalInfoKind = 'my_number' | 'phone' | 'email';

/**
 * 利用者へ返す固定文(web のインライン表示と api の 422 で共通)。
 * なぜ入力値を引用しないか: 検出した番号を画面や応答へ反射すると、それ自体が個人情報の複製になる。
 */
export const PERSONAL_INFO_MESSAGE =
  '電話番号・メールアドレス・マイナンバーなどの個人情報が含まれている可能性があるため、送信を止めました。該当する部分を削除してから、もう一度送信してください（窓口の電話番号などをお調べの場合は、番号を書かずにご質問ください）。';

/**
 * 電話番号の区切りとして許す文字。ハイフン類(全角はNFKCで '-' になる)・長音符(日本語入力で
 * ハイフン代わりに打たれる)・空白・括弧(03(1234)5678 形式)。コロンやスラッシュは含めない
 * (時刻 08:30・日付 2026/04/01 を電話番号と誤認しないため)。
 */
const PHONE_SEPARATOR_CLASS = '[-\\u2010\\u2011\\u2013\\u2014\\u2015\\u2212\\u30fc\\s()]';

/**
 * 電話番号の候補。先頭は 0 または +81、その後に「区切り0〜2文字+数字」が8〜11回続く。
 * 前後に数字が続く場合は電話番号の一部ではない(マイナンバー等の長い数列)ので拾わない。
 * 桁数(国内表記で10〜11桁)は一致後に数字だけ数えて確かめる。
 */
const PHONE_CANDIDATE = new RegExp(
  `(?<![\\d+])(?:\\+81|0)(?:${PHONE_SEPARATOR_CLASS}{0,2}\\d){8,11}(?!\\d)`,
  'gu',
);

/** マイナンバー(個人番号)= 12桁。4桁ごとの区切り(空白・ハイフン類)は任意。 */
const MY_NUMBER_CANDIDATE = /(?<!\d)\d{4}(?:[ \-‐‑–—―−ー]?\d{4}){2}(?!\d)/gu;

/** メールアドレス(実用上の形。厳密なRFC準拠より、日本語文中で誤検知しないことを優先)。 */
const EMAIL_CANDIDATE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu;

function normalize(text: string): string {
  return text.normalize('NFKC');
}

/** 電話番号の候補文字列 → 数字だけの国内表記(0始まり)。電話番号として成り立たなければ null。 */
function toDomesticDigits(candidate: string): string | null {
  let digits = candidate.replace(/\D/g, '');
  if (candidate.startsWith('+81')) {
    // +81 の後ろに国内の 0 を括弧書きで残す書き方(+81 (0)3 …)もあるため、重複した 0 は落とす。
    digits = digits.slice(2).replace(/^0/, '');
    digits = `0${digits}`;
  }
  // 国内の電話番号は 0 始まりの10〜11桁。00 始まりは国際電話の識別番号で、番号そのものではない。
  if (digits.length < 10 || digits.length > 11) return null;
  if (!digits.startsWith('0') || digits.startsWith('00')) return null;
  return digits;
}

/** 文中の電話番号を、数字だけの国内表記(例 0354321111)で出現順に返す。 */
export function findPhoneNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of normalize(text).matchAll(PHONE_CANDIDATE)) {
    const digits = toDomesticDigits(m[0]);
    if (digits !== null) out.push(digits);
  }
  return out;
}

/** 文中のメールアドレスを、小文字へ正規化して出現順に返す。 */
export function findEmailAddresses(text: string): string[] {
  return [...normalize(text).matchAll(EMAIL_CANDIDATE)].map((m) => m[0].toLowerCase());
}

function hasMyNumber(text: string): boolean {
  return [...normalize(text).matchAll(MY_NUMBER_CANDIDATE)].length > 0;
}

/**
 * 質問文に含まれる個人情報の種類を、固定順(my_number → phone → email)・重複なしで返す。
 * 空配列なら送信してよい。
 */
export function detectPersonalInfo(text: string): PersonalInfoKind[] {
  const kinds: PersonalInfoKind[] = [];
  if (hasMyNumber(text)) kinds.push('my_number');
  if (findPhoneNumbers(text).length > 0) kinds.push('phone');
  if (findEmailAddresses(text).length > 0) kinds.push('email');
  return kinds;
}

/**
 * 生成回答に書かれた電話番号・メールアドレスのうち、参考抜粋に現れないものを返す(純関数)。
 *
 * なぜ: URL と同じく、連絡先も「質問文に書かせて回答へ写させる」ことができる(公式根拠カードの隣に
 * 攻撃者の電話番号が窓口の番号として並ぶ)。また生成モデルが番号を1桁取り違えれば、利用者は
 * 無関係な番号へ電話する。連絡先は抜粋(=承認済み公式ページ)にそのまま書かれているものだけを許す。
 *
 * 照合は表記ゆれを吸収する: 電話番号は区切りを除いた数字列で比べ(03-5432-1111 と 03(5432)1111 と
 * ０３５４３２１１１１ は同じ)、メールは大文字小文字を区別しない。
 */
export function findUngroundedContacts(
  answer: string,
  excerpts: readonly string[],
): { phones: string[]; emails: string[] } {
  const source = normalize(excerpts.join('\n'));
  const excerptPhones = new Set(findPhoneNumbers(source));
  // なぜ区切りを除いた本文でも探すか: 抜粋側の書き方が候補パターンから外れていても
  // (例: 「電話03‐5432‐1111(直通)」の直後に数字が続く等)、数字の並びが同じなら根拠ありとみなす。
  // 甘くなる方向(保留が減る方向)の補完であり、抜粋に無い番号を通すことはない。
  const compact = source.replace(new RegExp(PHONE_SEPARATOR_CLASS, 'gu'), '');
  const lowerSource = source.toLowerCase();

  const phones = findPhoneNumbers(answer).filter(
    (p) => !excerptPhones.has(p) && !compact.includes(p),
  );
  const emails = findEmailAddresses(answer).filter((e) => !lowerSource.includes(e));
  return { phones, emails };
}
