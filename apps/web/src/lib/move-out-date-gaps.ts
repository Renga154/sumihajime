import type { ChecklistResponse, Profile } from '@tmn/schemas';

/**
 * なぜ: ウィザードのステップ1にある「前住所地の転出予定日（任意）」は、入れると児童手当の
 * 15日特例やマイナンバーカードの継続利用の期限を日付で算定できる(ADR-013)。しかし任意項目
 * なので多くの利用者は空欄のまま進み、**入れれば日付が出ると知らないまま**「期限は要確認」を
 * 見ることになる。チェックリスト側から、その人にとって何が得られるかを具体的に伝える。
 *
 * condition-gaps.ts と同じ作りにする — 判定の入力は保存済みプロフィール(データ)と
 * 生成済みチェックリストだけで、ウィザードのUI状態には依存しない。再訪・リロード・別タブでも
 * 同じ結果になる(決定論的)。
 *
 * ---- 出す条件を厳しくする理由 ----
 *
 * 関係の無い人に出す案内は、案内そのものの価値を下げる(「またこれか」で読まれなくなる)。
 * 次の4つをすべて満たすときだけ出す。
 *
 *  1. 転出予定日が未入力。入力済みの人には言うことが無い。
 *  2. その人のチェックリストに、転出予定日を起算日とする手続きが実際にある。
 *     判定は API 応答の moveOutScheduledDateImpact(区のルールデータから導出)だけを見る。
 *     **画面に区コードの分岐を書かない**(CLAUDE.md §4: 自治体固有ロジックをUIへ埋め込まない)。
 *     千代田・台東・北のように該当ルールが1件も無い区では、この配列が空になるので出ない。
 *  3. 海外からの転入ではない。前住所地が国外なら日本の市区町村へ転出届を出しておらず、
 *     「転出予定日」という日付自体が存在しない。ウィザードの説明文でも入力不要と書いている
 *     以上、チェックリストから入力を促すのは矛盾する。
 *  4. 手続き名を1件以上出せる。名前を出せないなら「一般論で濁す」ことになるので出さない。
 */

/** 案内に出す手続き(名前は同じ応答の tasks[].title をそのまま使う=カードの見出しと一致する)。 */
export interface MoveOutDateTopic {
  procedureId: string;
  title: string;
}

export interface MoveOutDateNotice {
  /** 案内カードを出すか。 */
  show: boolean;
  /** 転出予定日を入れると、期限を日付で出せるようになる手続き。 */
  enables: MoveOutDateTopic[];
  /** 既に日付は出ているが、入れるとより早い期限に変わりうる手続き。 */
  advances: MoveOutDateTopic[];
}

const NONE: MoveOutDateNotice = { show: false, enables: [], advances: [] };

/**
 * procedureId を、そのチェックリストに実際に出ているタスク名へ解決する。
 * 見つからない ID は落とす — 表に出ていない手続きの名前を案内で持ち出さないため
 * (応答の作り上は起こらないが、古い控えと新しい判定が混ざる可能性を型で潰しておく)。
 */
function toTopics(
  procedureIds: readonly string[],
  checklist: ChecklistResponse,
): MoveOutDateTopic[] {
  const titleById = new Map(checklist.tasks.map((t) => [t.procedureId, t.title]));
  return procedureIds.flatMap((procedureId) => {
    const title = titleById.get(procedureId);
    return title === undefined ? [] : [{ procedureId, title }];
  });
}

/**
 * チェックリスト画面に「転出予定日を入れると期限を出せます」の案内を出すかを決める純関数。
 *
 * moveOutScheduledDateImpact を持たない応答(この項目より前に保存された端末内の控え)では
 * 案内を出さない。判定材料が無いのに出すのは推測になる(CLAUDE.md 原則3)。
 */
export function moveOutDateNotice(
  profile: Profile | null,
  checklist: ChecklistResponse | null,
): MoveOutDateNotice {
  if (!profile || !checklist) return NONE;
  if (profile.moveOutScheduledDate !== undefined) return NONE;
  if (profile.originType === 'overseas') return NONE;

  const impact = checklist.moveOutScheduledDateImpact;
  if (!impact) return NONE;

  const enables = toTopics(impact.enablesDueDateFor, checklist);
  const advances = toTopics(impact.advancesDueDateFor, checklist);
  return { show: enables.length + advances.length > 0, enables, advances };
}
