import type {
  DueOrigin,
  DueRule,
  MoveOutScheduledDateImpact,
  Profile,
  RuleSet,
} from '@tmn/schemas';
import { moveOutScheduledDateImpactSchema } from '@tmn/schemas';
import { evaluateCondition } from './evaluate.js';
import { resolveDueRule } from './dates.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * 「前住所地の転出予定日を入れたら、この人の期日表示は何が変わるか」を、区のルールデータから
 * 導く純関数(ADR-013 の後日追記)。
 *
 * なぜ必要か: 転出予定日は任意入力なので大半の利用者は空欄のまま進み、児童手当のように
 * 区が「前住所地の転出予定日の翌日から15日以内」と明記している手続きでも「期限は要確認」
 * としか出ない。**入れれば日付が出る**ことを知らないまま要確認を見るのは、期限順のToDoを
 * 掲げるサービスとして取りこぼしである。かといって画面に「この区なら児童手当が出せます」と
 * 書けば自治体固有ロジックがUIへ漏れる(CLAUDE.md §4)。判定はここ(ルール層)で行い、
 * UIへは procedureId だけを渡す。
 *
 * 判定は「仮の日付を入れて再評価する」のではなく、dueRule の**構造**から決める。
 * 仮の日付を置くと、その値次第で結果が変わる(earliestOf のどちらが早いか)ため、
 * 利用者へ見せる案内が入力前に決め打ちできなくなる。構造から言えるのは次の2つだけで、
 * これはどんな転出予定日でも成り立つ:
 *
 *  - enablesDueDateFor: いま期日が出ていない + 起算日に転出予定日を含む
 *      → 転出予定日が入れば必ず日付が出る(offsetDays は起算日が揃えば必ず解ける)。
 *  - advancesDueDateFor: いま期日が出ている + 起算日に転出予定日を含む(= earliestOf)
 *      → earliestOf は最も早い候補を採るので、期日が遅くなることは無く、早くなる**ことがある**。
 *
 * 対象は「チェックリストに出るタスク」だけに限る。not_applicable の手続き(子どものいない
 * 世帯の児童手当など)を案内に出すと、その人には無関係な警告になり、案内自体の価値が下がる。
 */

/** dueRule が参照している起算日(earliestOf は全候補ぶん)。 */
function dueOrigins(dueRule: DueRule): DueOrigin[] {
  if (dueRule.type === 'offsetDays') return [dueRule.from];
  if (dueRule.type === 'earliestOf') return dueRule.of.map((r) => r.from);
  return [];
}

export function moveOutScheduledDateImpact(
  profile: Profile,
  ruleSet: RuleSet,
): MoveOutScheduledDateImpact {
  if (profile.destination.municipalityCode !== ruleSet.municipalityCode) {
    // 他区のルールで「あなたの区ならこの期限が出せます」と案内するのは原則4違反そのもの。
    // evaluate() と同じく、評価を一切進めずに落とす。
    throw new MunicipalityScopeMismatchError(
      profile.destination.municipalityCode,
      ruleSet.municipalityCode,
    );
  }

  const enablesDueDateFor: string[] = [];
  const advancesDueDateFor: string[] = [];

  // 既に入力済みなら、これ以上入力で得られるものは無い(期日は既に反映済み)。
  if (profile.moveOutScheduledDate === undefined) {
    for (const rule of ruleSet.rules) {
      if (!dueOrigins(rule.dueRule).includes('moveOutScheduledDate')) continue;
      // 'false' = not_applicable。'unknown'(要確認)はチェックリストに出るので対象に含める。
      if (evaluateCondition(rule.condition, profile) === 'false') continue;

      const current = resolveDueRule(rule.dueRule, { moveDate: profile.moveDate });
      if (current.dueDate === undefined) enablesDueDateFor.push(rule.procedureId);
      else advancesDueDateFor.push(rule.procedureId);
    }
  }

  // 契約(@tmn/schemas)を導出側でも裏書きする(evaluateRule と同じ方針)。
  return moveOutScheduledDateImpactSchema.parse({ enablesDueDateFor, advancesDueDateFor });
}
