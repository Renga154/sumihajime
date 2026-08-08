import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChecklistResponse, GeneratedTask, Profile } from '@tmn/schemas';
import { ApiError, getMunicipalities, postChecklist } from '../api/client';
import { useAppState } from '../state/AppState';
import {
  loadDone,
  loadProfile,
  loadReviewedSteps,
  saveDone,
  toggleDone,
  isDone,
  type DoneMap,
} from '../lib/storage';
import {
  cacheAgeInDays,
  clearChecklistCache,
  loadChecklistCache,
  saveChecklistCache,
} from '../lib/checklist-cache';
import { groupIntoSections, sectionDescription, sectionLabel } from '../lib/sections';
import { formatDate, formatDateFromDateTime, formatDateTimeInTokyo } from '../lib/format';
import { isOverdue, overdueDays, todayInTokyo } from '../lib/move-date';
import { useDocumentTitle } from '../lib/navigation';
import { buildChecklistIcs, datedTasks } from '../lib/ics';
import { useAsync } from '../lib/useAsync';
import { conditionGapNotice, type ConditionGapNotice } from '../lib/condition-gaps';
import { moveOutDateNotice, type MoveOutDateNotice } from '../lib/move-out-date-gaps';
import { Card, EmptyState, ErrorMessage, Loading } from '../components/ui';
import {
  NeedsConfirmationBadge,
  NonMunicipalBadge,
  OverdueBadge,
  PriorityBadge,
} from '../components/Badge';
import { isNonMunicipal } from '../lib/provider-scope';
import { ChatPanel, ChatUnavailable } from '../components/ChatPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';

/**
 * サーバーからの取得が通らなかったときに、端末内の控えへ切り替えるかどうか。
 *
 * 切り替えてよいのは「今は届かない」失敗だけ:通信断・時間切れ(status 0)、混雑(429)、
 * サーバー側の不調(5xx)。逆に 404/409/422 は「その自治体は対象外」「入力が不正」といった
 * サーバーの**確定した答え**で、控えを出すと利用者に取り下げ済みの案内を見せ続けることになる
 * (原則9: 未対応を対応済みに見せない)。この場合は控えごと捨てる。
 */
function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

interface ChecklistView {
  muniName: string;
  checklist: ChecklistResponse;
  /** 端末内の控えを表示している場合の取得時刻。サーバーから取れたときは null。 */
  cachedAt: string | null;
}

/**
 * 取得の本体。成功したら控えを更新し、届かなければ控えへ退避する。
 *
 * なぜ自治体名だけ別扱いなのか: 以前は一覧とチェックリストを Promise.all で束ねていたため、
 * 表示名を引く GET /api/municipalities が失敗しただけで、生成に成功したチェックリストごと
 * エラー画面になっていた。名前は見出しの飾りで、手続きの中身には関わらない。
 * 取れなければ控えの名前、それも無ければ自治体コードで代替し、本体を落とさない。
 */
async function fetchChecklist(code: string, profile: Profile): Promise<ChecklistView> {
  const [munis, checklist] = await Promise.allSettled([
    getMunicipalities(),
    postChecklist(profile),
  ]);

  if (checklist.status === 'rejected') {
    if (isTransientFailure(checklist.reason)) {
      const cached = loadChecklistCache(code, profile);
      if (cached) {
        return {
          muniName: cached.municipalityName,
          checklist: cached.checklist,
          cachedAt: cached.cachedAt,
        };
      }
    } else {
      clearChecklistCache(code);
    }
    throw checklist.reason;
  }

  const fromList =
    munis.status === 'fulfilled' ? munis.value.find((m) => m.code === code)?.name : undefined;
  const muniName = fromList ?? loadChecklistCache(code, profile)?.municipalityName ?? code;

  saveChecklistCache({
    municipalityCode: code,
    municipalityName: muniName,
    profile,
    checklist: checklist.value,
  });
  return { muniName, checklist: checklist.value, cachedAt: null };
}

/**
 * チェックリスト画面(§7.4)。ヘッダー(自治体・転入日・条件修正)、進捗(完了n/全m)、
 * 期限順セクション、各カード(優先度・期限or要確認・1行理由・完了チェック・詳細へ)を表示する。
 * 完了状態は procedureId キーで localStorage に保持し(C-4)、リロード後も維持される。
 *
 * 生成結果そのものも端末内へ控える(checklist-cache.ts)。APIへ届かないときは控えを出し、
 * 必ず「いつ時点の内容か」を添える。黙って古い内容を最新として見せない(原則3)。
 */
export function ChecklistPage() {
  useDocumentTitle('あなたのチェックリスト');
  const { municipalityCode } = useAppState();
  // 期限超過の判定基準日。日本時間の暦日で固定する(端末のタイムゾーンに左右されない)。
  const today = useMemo(() => todayInTokyo(), []);
  const profile = municipalityCode ? loadProfile(municipalityCode) : null;
  const profileSig = profile ? JSON.stringify(profile) : '';

  const state = useAsync<ChecklistView | null>(async () => {
    if (!municipalityCode || !profile) return null;
    return fetchChecklist(municipalityCode, profile);
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
  // ステップ3を「開かずに」生成した場合、期限つきの重要手続き(マイナンバーカードの継続利用など)が
  // 一件も出ない。開いたうえで1つも当てはまらなかった利用者には出さない(その人にとっては
  // これが正しい全量であり、「未入力です」は事実に反する)。判定は純関数に委ねる。
  const reviewedSteps = municipalityCode
    ? loadReviewedSteps(municipalityCode)
    : { household: false, conditions: false };
  const gapNotice = conditionGapNotice(profile, reviewedSteps);
  // 転出予定日(ステップ1の任意項目)が空欄のままだと、区が「転出予定日の翌日から15日以内」と
  // 明記している手続きまで「期限は要確認」にしかならない。入れれば日付が出せることを、
  // その人のチェックリストに実際に効く手続き名を添えて伝える。判定は純関数に委ねる。
  const moveOutNotice = moveOutDateNotice(profile, state.data?.checklist ?? null);

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
              className="tap-target inline-flex items-center gap-1 font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              条件を修正する
            </Link>
          </div>
        )}
      </header>

      {state.loading && <Loading label="チェックリストを作成中です…" />}
      {state.error != null && (
        <ErrorMessage error={state.error} onRetry={state.reload} retryLabel="もう一度作成する" />
      )}

      {state.data && (
        <>
          {state.data.cachedAt && (
            <OfflineCopyNotice cachedAt={state.data.cachedAt} onRetry={state.reload} />
          )}

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

          {/* 「期限は要確認」を見る前に、日付を出せる方法があることを知らせる。 */}
          {moveOutNotice.show && <MoveOutDateCard notice={moveOutNotice} />}

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

          {/*
            チャットは補助機能。描画中に落ちても、チェックリスト本体と公式リンクは
            そのまま残さなければならない(原則8)。ルータの errorElement は画面全体の
            受け皿なので、ここまで届かせない。
          */}
          <div className="print-hide">
            <ErrorBoundary
              label="ChatPanel"
              fallback={(retry) => <ChatUnavailable retry={retry} />}
            >
              <ChatPanel
                municipalityCode={municipalityCode}
                municipalityName={state.data.muniName}
              />
            </ErrorBoundary>
          </div>

          {/*
            比較ページへの導線。CLAUDE.md原則4を守るため、ここに出すのはリンク1つだけで、
            他の区の期限・区名・値は一切表示しない(比較は /differences でのみ行う)。
          */}
          <p className="print-hide text-sm text-slate-600">
            <Link
              to="/differences"
              className="tap-target-inline font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
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
 * 端末内の控えを表示していることの告知。
 *
 * なぜ目立たせるのか(原則3): 控えは黙って出すと「今の内容」に見える。取得時刻と経過日数を
 * 添え、その後に変わっている可能性があること、公式ページで確かめられることを必ず言う。
 * ここを飾りにすると、古い期限を最新として信じさせることになる。
 *
 * なぜ print-hide にしないのか: 紙に印刷して窓口へ持って行く使い方がある。画面では
 * 「◯月◯日時点」と断っておきながら、紙からその断りだけ落ちるのは、いちばん誤解が
 * 起きやすい形になる。
 *
 * role="status" を付けないのは、進捗表示が既に使っているため(1画面に複数のステータスを
 * 置くと読み上げが競合する)。見出しつきの region にして辿れるようにする。
 */
function OfflineCopyNotice({ cachedAt, onRetry }: { cachedAt: string; onRetry: () => void }) {
  const days = cacheAgeInDays(cachedAt);
  return (
    <section
      aria-labelledby="offline-copy-heading"
      className="rounded-lg border border-slate-400 bg-slate-100 p-4"
    >
      <div className="flex gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 4a1 1 0 10-2 0v4.3l3 1.8a1 1 0 101-1.72L11 9.4V6z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0">
          <h2 id="offline-copy-heading" className="font-bold text-slate-900">
            保存してあった内容を表示しています
          </h2>
          <p className="mt-1 text-sm text-slate-800">
            サーバーに接続できなかったため、
            <span className="font-semibold">{formatDateTimeInTokyo(cachedAt)}</span>
            に取得した内容を表示しています（
            {days === 0 ? '本日取得' : `${days}日前に取得`}
            ）。これは最新の取得ではありません。その後に期限や必要書類が変わっている場合があります。
          </p>
          <p className="mt-1 text-sm text-slate-800">
            各手続きの「詳細・必要書類・公式根拠」から、公式ページで最新の内容をご確認ください。
          </p>
          <p className="print-hide mt-3">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-900 active:bg-black"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M10 3a7 7 0 016.32 4h-2.2a5 5 0 100 6h2.2A7 7 0 1110 3z" />
                <path d="M17 3v5h-5l1.9-1.9A5 5 0 0010 5V3h7z" />
              </svg>
              最新の内容を取得する
            </button>
          </p>
        </div>
      </div>
    </section>
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

/** 案内文で手続き名を並べるときの区切り。手続き名自体が中黒を含みうるため読点にする。 */
function joinTitles(topics: readonly { title: string }[]): string {
  return topics.map((t) => t.title).join('、');
}

/**
 * 「前住所地の転出予定日を入れると期限を日付で出せます」の案内。
 *
 * なぜ出すか: 転出予定日は任意入力なので大半の利用者が空欄のまま進む。その結果、区が
 * 「前住所地の転出予定日の翌日から15日以内」と明記している児童手当のような手続きでも、
 * 画面には「期限は要確認」としか出ない。入れれば日付が出ることを知らせないのは、
 * 期限順のToDoを掲げるサービスとしての取りこぼしになる(ADR-013)。
 *
 * どの手続きの名前を出すかは API 応答(区のルール由来)から受け取る。画面側で区コードを
 * 分岐させない(CLAUDE.md §4)。該当ルールが1件も無い区、海外からの転入、既に入力済みの
 * 利用者には出さない(判定は move-out-date-gaps.ts)。
 *
 * role="status" を付けないのは、進捗表示が既に使っているため(1画面に複数のステータスを
 * 置くと読み上げが競合する)。見出しつきの region にして辿れるようにする。
 */
function MoveOutDateCard({ notice }: { notice: MoveOutDateNotice }) {
  /*
    見出しを2通り持つ理由: 新宿のように「期日は既に出ているが、より早くなりうる」だけの区がある。
    そこで「期限を日付で出せます」と書くと、入力しても新しい日付が出ないので約束を破ることになる。
    その人に起きることをそのまま見出しにする(原則3: 事実でないことを断定しない)。
  */
  const heading =
    notice.enables.length > 0
      ? '前住所地の転出予定日を入れると、期限を日付で出せます'
      : '前住所地の転出予定日を入れると、期限がより早い日になることがあります';
  return (
    <section
      aria-labelledby="move-out-date-heading"
      className="print-hide rounded-lg border border-brand-300 bg-brand-50 p-4"
    >
      <div className="flex gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-brand-700"
          fill="currentColor"
        >
          <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
        </svg>
        <div className="min-w-0">
          <h2 id="move-out-date-heading" className="font-bold text-brand-900">
            {heading}
          </h2>
          {notice.enables.length > 0 && (
            <p className="mt-1 text-sm text-slate-800">
              いま「期限は要確認」と表示している
              <span className="font-semibold">{joinTitles(notice.enables)}</span>
              は、前住所地の転出予定日を起算日として期限が決まります。この日を入力すると、期限を日付で表示し、カレンダー（.ics）にも書き出せるようになります。
            </p>
          )}
          {notice.advances.length > 0 && (
            <p className="mt-1 text-sm text-slate-800">
              {notice.enables.length > 0 ? 'また、' : ''}
              <span className="font-semibold">{joinTitles(notice.advances)}</span>
              は既に日付を表示していますが、転入先の区は転出予定日からの日数も期限の条件にしているため、入力するとより早い期限に変わることがあります。
            </p>
          )}
          <p className="mt-1 text-sm text-slate-800">
            転出予定日は、前の住所の市区町村へ転出届を出すときに「いつ引っ越すか」として届け出た日です（転出証明書にも記載されています）。分からない場合や、まだ転出届を出していない場合は、空欄のままで構いません（その場合は「期限は要確認」のまま表示します）。
          </p>
          <p className="mt-3">
            <Link
              to="/wizard?step=1"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800 active:bg-brand-900"
            >
              転出予定日を入力する
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
        {/* h-6 w-6: 完了チェックはこの画面の主操作。要求の24px×24px(SC 2.5.8)を実寸で満たす
            (label[htmlFor] は見出し側にあり、チェックボックス自体と連続した面にならないため
            ラベル側の面積では代替できない)。 */}
        <input
          id={checkboxId}
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-6 w-6 shrink-0 cursor-pointer"
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
              className="tap-target inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
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
