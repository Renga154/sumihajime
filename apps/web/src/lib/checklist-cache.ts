import { z } from 'zod';
import { checklistResponseSchema, type ChecklistResponse, type Profile } from '@tmn/schemas';

/**
 * 生成済みチェックリストの端末内控え(APIへ届かないときの読み出し元)。
 *
 * なぜ持つのか(独立点検 P1 / 原則8): これまで生成結果はメモリ上にしかなく、APIへ届かない限り
 * 画面には何も残らなかった。最悪の場面は区役所の弱い電波で、必要な手続きも、そこへ辿るための
 * 公式リンクも、窓口の前で全部消える。原則8はRAG障害時にチェックリストと公式リンクが
 * 使えることを求めているが、守られるべき「本体」の可用性のほうが手薄だった。
 *
 * ---- 何を保存し、何を保存しないか ----
 *
 * 保存する:
 *  - 生成されたタスク一覧(件名・期限・必要書類・窓口・公式URL・最終確認日)。窓口の前で
 *    必要になるのはこれで、公式URLと最終確認日を伴わないタスクは表示できない(原則2)。
 *  - 自治体名と自治体コード、取得時刻。**いつ時点の内容か**を必ず言うために要る(原則3)。
 *  - ルールのバージョン(そのまま表示はしない。下の「古い判定を出し続けない」を参照)。
 *
 * 保存しない:
 *  - プロフィールそのもの。同じ条件の結果かを確かめるには**同じ入力か**が分かれば足りるので、
 *    照合用の短い指紋(profileDigest)だけを持つ。妊娠・障害・介護といった条件を端末内でも
 *    2か所へ複製しない(§13 データ最小化。プロフィールの正は `tmn:profile:<code>` の1か所)。
 *  - チャットの質問文と回答。画面で「質問文と回答は保存もログ記録もしていません」と約束して
 *    いる以上、可用性を理由にそれを破らない。チャットは補助機能で、落ちたら落ちたでよい。
 *  - サーバーへは何も送らない。この控えは端末内(localStorage)だけに置く。
 *
 * ---- 古い判定を出し続けないための決まり ----
 *
 *  1. 控えは**代替であって既定ではない**。毎回まずAPIを叩き、成功したら必ず控えを上書きする。
 *     ルールのバージョンが変わっていれば、次に繋がった瞬間に新しい判定へ置き換わる。
 *  2. 条件を変えたら(profileDigest 不一致)、その控えは使わない。修正前の判定が復活しない。
 *  3. 形式が変わったら(FORMAT_VERSION 不一致)、読まずに捨てる。
 *  4. 自治体をまたいで持たない。控えは常に最後に見た1自治体ぶんだけ(原則4の混入防止と、
 *     端末に残す量を増やさないため)。
 *  5. オフラインではルールが変わったかどうかを知る術がない。だから最新だとは決して言わず、
 *     取得時刻と経過日数を必ず添えて出す(表示側の責任。ChecklistPage)。
 */

const KEY_PREFIX = 'tmn:checklist-cache:';
const cacheKey = (code: string) => `${KEY_PREFIX}${code}`;

/** 保存形式のバージョン。形が変わったら上げる(古い控えは読まずに捨てられる)。 */
const FORMAT_VERSION = 1;

const cachedChecklistSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  municipalityCode: z.string().min(1),
  municipalityName: z.string().min(1),
  profileDigest: z.string().min(1),
  /** 端末内で控えを作った時刻(サーバーの generatedAt とは別物)。 */
  cachedAt: z.iso.datetime(),
  checklist: checklistResponseSchema,
});
export type CachedChecklist = z.infer<typeof cachedChecklistSchema>;

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * キー順に安定化したJSON。JSON.stringify はオブジェクトの列挙順をそのまま使うため、
 * 同じ内容でも生成経路で並びが変わりうる。指紋が入力ではなく並びで変わると、
 * 条件を変えていないのに控えが使えなくなる。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // FNV素数 16777619 の乗算を32bitで行う(Math.imul で桁あふれを切り捨てる)。
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * プロフィールの指紋(純関数)。控えが「今の条件の結果か」を照合するためだけに使う。
 *
 * なぜハッシュなのか: 照合に必要なのは同一性だけで、内容を読み返す必要はない。指紋からは
 * 条件を復元できないため、プロフィールをもう1本持つより端末に残る情報が少なくて済む。
 * 種違いの2本を連結して衝突を実質的に無くす(別条件の結果を同じ条件のものと誤認しない)。
 */
export function profileDigest(profile: Profile): string {
  const json = JSON.stringify(canonicalize(profile));
  return `${fnv1a(json, 0x811c9dc5)}${fnv1a(json, 0x1000193)}`;
}

/**
 * 控えを書く(自治体をまたいでは持たない)。
 * 容量超過などで書けなくても失敗させない — 控えは付加機能で、これが原因で
 * 今まさに成功している取得を壊してはいけない。
 */
export function saveChecklistCache(args: {
  municipalityCode: string;
  municipalityName: string;
  profile: Profile;
  checklist: ChecklistResponse;
  now?: Date;
}): void {
  const store = safeLocalStorage();
  if (!store) return;
  const entry: CachedChecklist = {
    formatVersion: FORMAT_VERSION,
    municipalityCode: args.municipalityCode,
    municipalityName: args.municipalityName,
    profileDigest: profileDigest(args.profile),
    cachedAt: (args.now ?? new Date()).toISOString(),
    checklist: args.checklist,
  };
  try {
    clearOtherChecklistCaches(args.municipalityCode);
    store.setItem(cacheKey(args.municipalityCode), JSON.stringify(entry));
  } catch {
    // 容量超過・プライベートモード等。控えなしで続行する。
  }
}

/**
 * 控えを読む。今の条件(profile)と一致しない・形式が違う・壊れている場合は null。
 * 一致しなかった控えはその場で消す(使えない古い判定を端末に残しておかない)。
 */
export function loadChecklistCache(
  municipalityCode: string,
  profile: Profile,
): CachedChecklist | null {
  const store = safeLocalStorage();
  if (!store) return null;
  const raw = store.getItem(cacheKey(municipalityCode));
  if (!raw) return null;

  let parsed: CachedChecklist;
  try {
    const result = cachedChecklistSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      clearChecklistCache(municipalityCode);
      return null;
    }
    parsed = result.data;
  } catch {
    clearChecklistCache(municipalityCode);
    return null;
  }

  // 自治体の取り違えを構造的に防ぐ(キーと中身の両方が一致して初めて使う。原則4)。
  if (parsed.municipalityCode !== municipalityCode) {
    clearChecklistCache(municipalityCode);
    return null;
  }
  if (parsed.profileDigest !== profileDigest(profile)) {
    clearChecklistCache(municipalityCode);
    return null;
  }
  return parsed;
}

export function clearChecklistCache(municipalityCode: string): void {
  try {
    safeLocalStorage()?.removeItem(cacheKey(municipalityCode));
  } catch {
    // 消せなくても続行する(読み出し側が形式・指紋で弾く)。
  }
}

/** 指定した自治体**以外**の控えを消す。端末に残す量を1自治体ぶんに抑える。 */
function clearOtherChecklistCaches(keepCode: string): void {
  const store = safeLocalStorage();
  if (!store) return;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && key.startsWith(KEY_PREFIX) && key !== cacheKey(keepCode)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}

/**
 * 控えの古さ(日数)。表示側が「N日前に取得した内容」と言うために使う純関数。
 * 未来の時刻(端末時計のずれ)は 0 日として扱う — 「-3日前」は利用者に意味がない。
 */
export function cacheAgeInDays(cachedAt: string, now: Date = new Date()): number {
  const then = Date.parse(cachedAt);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}
