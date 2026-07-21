import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GeneratedTask } from '@tmn/schemas';
import { getMunicipalities, postChecklist } from '../api/client';
import { useAppState } from '../state/AppState';
import { loadDone, loadProfile, saveDone, toggleDone, isDone, type DoneMap } from '../lib/storage';
import { groupIntoSections, sectionDescription, sectionLabel } from '../lib/sections';
import { formatDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Card, ErrorMessage, Loading } from '../components/ui';
import { NeedsConfirmationBadge, PriorityBadge } from '../components/Badge';

/**
 * チェックリスト画面(§7.4)。ヘッダー(自治体・転入日・条件修正)、進捗(完了n/全m)、
 * 期限順セクション、各カード(優先度・期限or要確認・1行理由・完了チェック・詳細へ)を表示する。
 * 完了状態は procedureId キーで localStorage に保持し(C-4)、リロード後も維持される。
 */
export function ChecklistPage() {
  const { municipalityCode } = useAppState();
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

  if (!municipalityCode) {
    return (
      <Card>
        <p className="text-slate-700">先に自治体を選んでください。</p>
        <Link to="/" className="mt-2 inline-block font-semibold text-blue-700 underline">
          自治体選択へ
        </Link>
      </Card>
    );
  }
  if (!profile) {
    return (
      <Card>
        <p className="text-slate-700">まだ条件が入力されていません。</p>
        <Link to="/wizard" className="mt-2 inline-block font-semibold text-blue-700 underline">
          条件を入力する
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">あなたのチェックリスト</h1>
        {state.data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
            <span>
              <span className="text-slate-500">自治体：</span>
              <span className="font-semibold">{state.data.muniName}</span>
            </span>
            <span>
              <span className="text-slate-500">引越し日：</span>
              <span className="font-semibold">{formatDate(profile.moveDate)}</span>
            </span>
            <Link to="/wizard" className="font-semibold text-blue-700 underline">
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
            <p className="text-sm text-slate-700">
              進捗：<span className="font-bold">{doneCount}</span> / {tasks.length} 件 完了
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-green-500"
                style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          {sections.length === 0 && (
            <Card>
              <p className="text-slate-700">
                現在の条件に該当する手続きはありませんでした。条件を追加すると項目が増えることがあります。
              </p>
            </Card>
          )}

          {sections.map((section) => (
            <section key={section.key} aria-labelledby={`sec-${section.key}`}>
              <h2 id={`sec-${section.key}`} className="text-lg font-bold text-slate-900">
                {sectionLabel[section.key]}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  （{section.tasks.length}件）
                </span>
              </h2>
              <p className="text-xs text-slate-500">{sectionDescription[section.key]}</p>
              <ul className="mt-2 space-y-2">
                {section.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      done={isDone(doneMap, task.procedureId)}
                      onToggle={(d) => onToggle(task, d)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function TaskCard({
  task,
  done,
  onToggle,
}: {
  task: GeneratedTask;
  done: boolean;
  onToggle: (done: boolean) => void;
}) {
  const needsConfirmation = task.applicable === 'needs_confirmation';
  const checkboxId = `done-${task.id}`;
  return (
    <Card className={done ? 'opacity-70' : ''}>
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            {needsConfirmation && <NeedsConfirmationBadge />}
          </div>
          <label
            htmlFor={checkboxId}
            className={`mt-1 block font-bold ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}
          >
            {task.title}
          </label>

          <p className="mt-1 text-sm">
            {task.dueDate ? (
              <span>
                <span className="text-slate-500">期限：</span>
                <span className="font-semibold text-slate-800">{formatDate(task.dueDate)}</span>
              </span>
            ) : (
              <span className="font-semibold text-amber-800">期限は要確認</span>
            )}
          </p>
          {!task.dueDate && task.dueDescription && (
            <p className="text-xs text-slate-500">{task.dueDescription}</p>
          )}

          <p className="mt-1 text-sm text-slate-700">{task.applicabilityReason}</p>

          <p className="mt-2">
            <Link
              to={`/procedures/${encodeURIComponent(task.procedureId)}`}
              className="text-sm font-semibold text-blue-700 underline"
            >
              詳細・必要書類・公式根拠を見る
            </Link>
          </p>
        </div>
      </div>
    </Card>
  );
}
