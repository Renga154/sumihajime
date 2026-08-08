import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GeneratedTask } from '@tmn/schemas';
import { getMunicipalities, postChecklist } from '../api/client';
import { useAppState } from '../state/AppState';
import { loadDone, loadProfile, saveDone, toggleDone, isDone, type DoneMap } from '../lib/storage';
import { groupIntoSections, sectionDescription, sectionLabel } from '../lib/sections';
import { formatDate, formatDateFromDateTime } from '../lib/format';
import { isOverdue, overdueDays, todayInTokyo } from '../lib/move-date';
import { useDocumentTitle } from '../lib/navigation';
import { buildChecklistIcs, datedTasks } from '../lib/ics';
import { useAsync } from '../lib/useAsync';
import { conditionGapNotice, type ConditionGapNotice } from '../lib/condition-gaps';
import { Card, EmptyState, ErrorMessage, Loading } from '../components/ui';
import {
  NeedsConfirmationBadge,
  NonMunicipalBadge,
  OverdueBadge,
  PriorityBadge,
} from '../components/Badge';
import { isNonMunicipal } from '../lib/provider-scope';
import { ChatPanel } from '../components/ChatPanel';

/**
 * チェックリスト画面(§7.4)。ヘッダー(自治体・転入日・条件修正)、進捗(完了n/全m)、
 * 期限順セクション、各カード(優先度・期限or要確認・1行理由・完了チェック・詳細へ)を表示する。
 * 完了状態は procedureId キーで localStorage に保持し(C-4)、リロード後も維持される。
 */
export function ChecklistPage() {
  useDocumentTitle('あなたのチェックリスト');
  const { municipalityCode } = useAppState();
  // 期限超過の判定基準日。日本時間の暦日で固定する(端末のタイムゾーンに左右されない)。
  const today = useMemo(() => todayInTokyo(), []);
  const profile = municipalityCode ? loadProfile(municipalityCode) : null;
  const profileSig = profile ? JSON.stringify(profile) : '';

  const state = useAsync(async () => {
    if (!municipalityCode || !profile) return null;
    const [munis, checklist] = await Promise.all([getMunicipalities(), postChecklist(profile)]);
    const muni = munis.find((m) => m.code === municipalityCode) ?? null;
    return { muniName: muni?.name ?? municipalityCode, checklist };
  }, [municipalityCode, profileSig]);

  const [doneMap, setDoneMap] = useState<DoneMap>(() =>
    municipalityCode ? loadDone(municipalityCode) : {},
  );

  function onToggle(task: GeneratedTask, done: boolean) {
    if (!municipalityCode) return;
    const next = toggleDone(doneMap, task.procedureId, task.ruleVersion, done);
    setDoneMap(next);
    saveDone(municipalityCode, next);
  }

  const tasks = state.data?.checklist.tasks ?? [];
  const sections = useMemo(
    () => (profile ? groupIntoSections(tasks, profile.moveDate) : []),
    [tasks, profile],
  );
  const doneCount = tasks.filter((t) => isDone(doneMap, t.procedureId)).length;
  const icsTaskCount = datedTasks(tasks).length;
  // 条件を1つも選ばずに生成した場合、期限つきの重要手続き(マイナンバーカードの継続利用など)が
  // 一件も出ない。判定は保存済みプロフィールだけを見る純関数に委ねる(lib/condition-gaps)。
  const gapNotice = conditionGapNotice(profile);

  /**
   * 期限つきタスクを .ics(終日イベント)にしてクライアントで生成・ダウンロードする。
   * サーバーへは一切送らない(§13 プライバシー: 収集する個人情報を増やさない)。
   */
  function downloadIcs() {
    if (!municipalityCode) return;
    const ics = buildChecklistIcs(tasks, municipalityCode);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tokyo-move-navi-${municipalityCode}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (!municipalityCode) {
    return (
      <Card>
        <p className="text-slate-700">先に自治体を選んでください。</p>
        <Link to="/" className="mt-2 inline-block font-semibold text-brand-700 underline">
          自治体選択へ
        </Link>
      </Card>
    );
  }
  if (!profile) {
    return (
      <Card>
        <p className="text-slate-700">まだ条件が入力されていません。</p>
        <Link to="/wizard" className="mt-2 inline-block font-semibold text-brand-700 underline">
          条件を入力する
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">あなたのチェックリスト</h1>
        {state.data && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-800 ring-1 ring-inset ring-brand-100">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 2a5 5 0 00-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 00-5-5zm0 6.5A1.5 1.5 0 1110 5.5a1.5 1.5 0 010 3z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="sr-only">自治体：</span>
              {state.data.muniName}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
              </svg>
              <span className="sr-only">引越し日：</span>
              {formatDate(profile.moveDate)}
            </span>
            <Link
              to="/wizard"
              className="inline-flex items-center gap-1 font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              条件を修正する
            </Link>
          </div>
        )}
      </header>

      {state.loading && <Loading label="チェックリストを作成中です…" />}
      {state.error != null && <ErrorMessage error={state.error} />}

      {state.data && (
        <>
          <div
            className="rounded-lg border border-slate-200 bg-white p-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm text-slate-700">
                進捗：<span className="text-lg font-bold text-slate-900">{doneCount}</span> /{' '}
                {tasks.length} 件 完了
              </p>
              <span className="text-2xl font-bold tabular-nums text-brand-700">
                {tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0}
                {/* slate-400 は白背景で CR 2.63:1 と WCAG 1.4.3(4.5:1)を満たさない。
                    単位記号も本文テキストなので slate-600(CR 6.0:1)へ上げる。 */}
                <span className="text-sm font-semibold text-slate-600">%</span>
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-green-500 transition-[width] duration-500 ease-out"
                style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* 進捗のすぐ下に置く。「n/m件」を全量だと受け取る前に、未判定があることを知らせる。 */}
          {gapNotice.show && <ConditionGapCard notice={gapNotice} />}

          {/* 書き出し操作(印刷・カレンダー登録)。印刷時は非表示。 */}
          <div className="print-hide flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5 3a1 1 0 00-1 1v3h12V4a1 1 0 00-1-1H5zM3 8a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h10a1 1 0 001-1v-2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3zm3 6h8v3H6v-3z"
                  clipRule="evenodd"
                />
              </svg>
              印刷する
            </button>
            <button
              type="button"
              onClick={downloadIcs}
              disabled={icsTaskCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
              </svg>
              カレンダーに登録（.ics）
            </button>
          </div>
          <p className="print-hide -mt-1 text-xs text-slate-500">
            カレンダーには期限のあるタスク（{icsTaskCount}
            件）のみを終日予定として書き出します。期限が未確定のタスクは含まれません。ファイルはこの端末内で作成され、サーバーには送信されません。
          </p>

          {sections.length === 0 && (
            <EmptyState title="該当する手続きはありませんでした">
              条件を追加すると項目が増えることがあります。「条件を修正する」からお試しください。
            </EmptyState>
          )}

          {sections.map((section) => (
            <section key={section.key} aria-labelledby={`sec-${section.key}`}>
              <h2
                id={`sec-${section.key}`}
                className="flex items-center gap-2 text-lg font-bold text-slate-900"
              >
                <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                {sectionLabel[section.key]}
                <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                  {section.tasks.length}件
                </span>
              </h2>
              <p className="mt-0.5 pl-3.5 text-xs text-slate-500">
                {sectionDescription[section.key]}
              </p>
              <ul className="mt-2.5 space-y-2.5">
                {section.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      today={today}
                      done={isDone(doneMap, task.procedureId)}
                      onToggle={(d) => onToggle(task, d)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="print-hide">
            <ChatPanel municipalityCode={municipalityCode} municipalityName={state.data.muniName} />
          </div>

          {/*
            比較ページへの導線。CLAUDE.md原則4を守るため、ここに出すのはリンク1つだけで、
            他の区の期限・区名・値は一切表示しない(比較は /differences でのみ行う)。
          */}
          <p className="print-hide text-sm text-slate-600">
            <Link
              to="/differences"
              className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              区ごとの期限のちがいを見る
            </Link>
            <span className="ml-1.5">
              — 同じ手続きでも期限が異なることがあります（自治体間の比較ページです）
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 「まだ判定していない条件がある」案内(欠陥①への対処)。
 *
 * なぜ: ステップ2/3は任意のため、ステップ1だけで生成すると条件フラグがすべて false のまま
 * 評価され、マイナンバーカードの継続利用・国民健康保険・国民年金といった期限つきの手続きが
 * 一件も出ない。それでも画面は「あなたのチェックリスト」「n/m件完了」と表示されるため、
 * 利用者はこれが全量だと受け取ってしまう。フラグを勝手に true へ倒す(=状況を推測する)ことは
 * CLAUDE.md 原則3に反するのでせず、「まだ判定していない」ことを明示して条件入力へ導く。
 *
 * role="status" は進捗表示が既に使っているため付けない(1画面に複数のステータスを置かない)。
 * 見出しつきの region にして、スクリーンリーダーの見出し/ランドマーク移動から辿れるようにする。
 */
function ConditionGapCard({ notice }: { notice: ConditionGapNotice }) {
  // 案内文が長くなりすぎないよう、実害の大きい上位5件だけ名前を出して残りは件数で示す。
  const shown = notice.unselected.slice(0, 5);
  const rest = notice.unselected.length - shown.length;
  return (
    <section
      aria-labelledby="condition-gap-heading"
      className="print-hide rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 4a1 1 0 10-2 0v5a1 1 0 102 0V6zm-1 9.5a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0">
          <h2 id="condition-gap-heading" className="font-bold text-amber-900">
            まだ判定していない条件があります
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            条件チェック（ステップ3）が未入力です。
            {/* ラベル自体が「お子さまの学校・保育」のように中黒を含むため、区切りは読点にする。 */}
            {shown.map((t) => t.label).join('、')}
            {rest > 0 && `ほか${rest}項目`}
            に該当する手続きは、条件を選ぶと表示されます。
          </p>
          {notice.householdUntouched && (
            <p className="mt-1 text-sm text-amber-900">
              世帯（ステップ2）も未入力のため、お子さまや高齢のご家族に関する手続きは含まれていません。
            </p>
          )}
          <p className="mt-3">
            <Link
              to="/wizard?step=3"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 active:bg-amber-900"
            >
              条件を追加する
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 11-1.4-1.4L11.58 10 7.3 5.7a1 1 0 010-1.4z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function TaskCard({
  task,
  today,
  done,
  onToggle,
}: {
  task: GeneratedTask;
  today: string;
  done: boolean;
  onToggle: (done: boolean) => void;
}) {
  const needsConfirmation = task.applicable === 'needs_confirmation';
  // 転入後にこのサービスを知る利用者が主要ターゲットのため、期限を過ぎた状態を黙って
  // 通常表示しない。ただし届出済みかどうかは分からないので断定はしない(原則3)。
  const overdue = !done && isOverdue(task.dueDate, today);
  const overdueBy = overdue ? overdueDays(task.dueDate, today) : 0;
  const checkboxId = `done-${task.id}`;
  const borderByPriority: Record<typeof task.priority, string> = {
    urgent: 'border-l-red-400',
    high: 'border-l-orange-400',
    normal: 'border-l-brand-400',
    optional: 'border-l-slate-300',
  };
  return (
    <Card
      interactive
      className={`print-avoid-break border-l-4 ${
        done ? 'border-l-green-400 bg-green-50/40' : borderByPriority[task.priority]
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            {/* ADR-009: 区の窓口では済まない手続き(水道・郵便・電気ガス・免許)を区別する。 */}
            {isNonMunicipal(task.category) && <NonMunicipalBadge />}
            {overdue && <OverdueBadge days={overdueBy} />}
            {needsConfirmation && <NeedsConfirmationBadge />}
            {done && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-200">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z"
                    clipRule="evenodd"
                  />
                </svg>
                完了
              </span>
            )}
          </div>
          {/* 見出し要素にする理由: スクリーンリーダーの見出しジャンプでタスクを辿れるようにする
              (セクション見出し h2 の下位=h3)。クリックでチェックできる label は内側に保つ。
              視覚デザインは従来どおり(見出しの既定余白はTailwindのpreflightで消えている)。 */}
          <h3 className="mt-1.5">
            <label
              htmlFor={checkboxId}
              className={`block cursor-pointer font-bold leading-snug ${
                done ? 'text-slate-400 line-through' : 'text-slate-900'
              }`}
            >
              {task.title}
            </label>
          </h3>

          <div className="mt-1.5">
            {task.dueDate ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold ring-1 ring-inset ${
                  done
                    ? 'bg-slate-50 text-slate-400 ring-slate-200'
                    : 'bg-slate-50 text-slate-800 ring-slate-200'
                }`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-4 w-4 text-slate-500"
                  fill="currentColor"
                >
                  <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
                </svg>
                <span className="text-slate-500">期限：</span>
                {formatDate(task.dueDate)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 7a1 1 0 112 0 1 1 0 01-2 0zm2 3a1 1 0 10-2 0v4a1 1 0 102 0v-4z"
                    clipRule="evenodd"
                  />
                </svg>
                期限は要確認
              </span>
            )}
          </div>
          {!task.dueDate && task.dueDescription && (
            <p className="mt-1 text-xs text-slate-500">{task.dueDescription}</p>
          )}
          {overdue && (
            <p className="mt-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-900">
              期限の日付を過ぎています。遅れても手続きは必要です。お早めに区の窓口へご相談ください。手続き済みの場合は、このまま完了にしてください。
            </p>
          )}

          <p className="mt-2 text-sm text-slate-700">{task.applicabilityReason}</p>

          {/* 印刷専用: 紙でも公式根拠を辿れるよう、公式URL文字列と最終確認日を明示する。 */}
          {task.sources.length > 0 && (
            <div className="print-only mt-2 text-sm text-slate-700">
              {task.sources.map((s) => (
                <p key={s.sourceId} className="mt-0.5">
                  公式: {s.url}
                  <span className="ml-2">
                    （最終確認日: {formatDateFromDateTime(s.lastVerifiedAt)}）
                  </span>
                </p>
              ))}
            </div>
          )}

          <p className="mt-2.5 print-hide">
            <Link
              to={`/procedures/${encodeURIComponent(task.procedureId)}`}
              state={{ task }}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              詳細・必要書類・公式根拠を見る
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 11-1.4-1.4L11.58 10 7.3 5.7a1 1 0 010-1.4z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
          </p>
        </div>
      </div>
    </Card>
  );
}
