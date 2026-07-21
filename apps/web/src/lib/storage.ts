import { profileSchema, type Profile } from '@tmn/schemas';

/**
 * なぜ: §13 データ最小化 / FR-010・FR-011 / C-4。利用者データは端末内(localStorage)のみに
 * 保存し、サーバーへは送らない。保存対象はプロフィール(再訪時の復元)と完了状態のみ。
 * 氏名・電話・メール・番地などの個人情報はそもそも入力させないため保存しない。
 *
 * 完了状態(C-4): procedureId をキーに {doneAt, ruleVersion} を保持する。条件変更で
 * 非該当になったタスクの完了記録は「削除せず」残し、UIは現在該当するタスクだけ表示する。
 * これにより再度該当したとき完了状態が復元される(削除しない=再該当時に復活)。
 */

const MUNICIPALITY_KEY = 'tmn:municipality';
const profileKey = (code: string) => `tmn:profile:${code}`;
const doneKey = (code: string) => `tmn:done:${code}`;

export interface DoneRecord {
  doneAt: string;
  ruleVersion: string;
}
export type DoneMap = Record<string, DoneRecord>;

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** ---- 選択中の自治体コード ---- */

export function loadMunicipalityCode(): string | null {
  return safeLocalStorage()?.getItem(MUNICIPALITY_KEY) ?? null;
}

export function saveMunicipalityCode(code: string): void {
  safeLocalStorage()?.setItem(MUNICIPALITY_KEY, code);
}

/** ---- プロフィール(自治体別) ---- */

export function loadProfile(code: string): Profile | null {
  const raw = safeLocalStorage()?.getItem(profileKey(code));
  if (!raw) return null;
  try {
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveProfile(code: string, profile: Profile): void {
  safeLocalStorage()?.setItem(profileKey(code), JSON.stringify(profile));
}

/** ---- 完了状態(自治体別、procedureId キー) ---- */

export function loadDone(code: string): DoneMap {
  const raw = safeLocalStorage()?.getItem(doneKey(code));
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object') return obj as DoneMap;
    return {};
  } catch {
    return {};
  }
}

export function saveDone(code: string, map: DoneMap): void {
  safeLocalStorage()?.setItem(doneKey(code), JSON.stringify(map));
}

/**
 * 完了状態を切り替えた新しいDoneMapを返す(純関数。呼び出し側で saveDone する)。
 * done=false のときも記録は残さず削除する(明示的な「未完了へ戻す」操作)。ただし
 * 「非該当になったタスクを隠す」処理はUI側(現在のタスク一覧との突き合わせ)で行い、
 * ここでは触らない — これがC-4「非該当でも記録を消さない」を成立させる。
 */
export function toggleDone(
  map: DoneMap,
  procedureId: string,
  ruleVersion: string,
  done: boolean,
): DoneMap {
  const next = { ...map };
  if (done) {
    next[procedureId] = { doneAt: new Date().toISOString(), ruleVersion };
  } else {
    delete next[procedureId];
  }
  return next;
}

export function isDone(map: DoneMap, procedureId: string): boolean {
  return Boolean(map[procedureId]);
}
