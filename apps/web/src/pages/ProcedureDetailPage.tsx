import { Link, useLocation, useParams } from 'react-router-dom';
import type { GeneratedTask } from '@tmn/schemas';
import { getProcedure } from '../api/client';
import { useAppState } from '../state/AppState';
import { useAsync } from '../lib/useAsync';
import { channelLabel, documentStatusLabel, formatDate } from '../lib/format';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { DataStatusBadge, PriorityBadge } from '../components/Badge';
import { SourceCard } from '../components/SourceCard';
import { ChatPanel } from '../components/ChatPanel';

/**
 * タスク詳細(§7.4/§10)。必要書類(unknownは「公式ページで要確認」)・方法(channels)・
 * 場所・注意事項・根拠カード(FR-008)・dataStatusバッジ(verified/partial/stale)を表示する。
 *
 * 期限表示: ProcedureVersion自体はdueRuleを持たず期限を計算できないため、チェックリスト画面
 * (ChecklistPage)から遷移した場合はルール評価済みのGeneratedTask(state)を受け取り、その
 * dueDateを表示する。直接URLで訪問された場合(stateなし)は、公式文言(dueDescription)のみの
 * 現行表示にフォールバックする。
 */
export function ProcedureDetailPage() {
  const { id } = useParams();
  const { municipalityCode } = useAppState();
  const location = useLocation();
  const stateTask = (location.state as { task?: GeneratedTask } | null)?.task;
  const stateDueDate = stateTask && stateTask.procedureId === id ? stateTask.dueDate : undefined;

  const state = useAsync(async () => {
    if (!municipalityCode || !id) return null;
    return getProcedure(id, municipalityCode);
  }, [municipalityCode, id]);

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

  return (
    <div className="space-y-4">
      <p>
        <Link to="/checklist" className="text-sm font-semibold text-brand-700 underline">
          ← チェックリストに戻る
        </Link>
      </p>

      {state.loading && <Loading label="手続きの詳細を読み込み中です…" />}
      {state.error != null && <ErrorMessage error={state.error} />}

      {state.data && (
        <article className="space-y-5">
          <header className="space-y-2 rounded-xl border border-slate-200 bg-gradient-to-br from-brand-50/60 to-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge priority={state.data.procedure.priority} />
              <DataStatusBadge status={state.data.procedure.dataStatus} />
            </div>
            <h1 className="text-2xl font-bold leading-snug tracking-tight text-slate-900">
              {state.data.procedure.title}
            </h1>
            <p className="text-slate-700">{state.data.procedure.shortDescription}</p>
          </header>

          <Card className="space-y-2">
            <div>
              {(stateDueDate ?? state.data.procedure.dueDate) ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-200">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="h-4 w-4 text-slate-500"
                    fill="currentColor"
                  >
                    <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
                  </svg>
                  <span className="text-slate-500">期限：</span>
                  {formatDate(stateDueDate ?? state.data.procedure.dueDate!)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="currentColor"
                  >
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
            {state.data.procedure.dueDescription && (
              <p className="text-sm text-slate-600">{state.data.procedure.dueDescription}</p>
            )}
            <p className="text-sm text-slate-700">{state.data.procedure.applicabilityReason}</p>
          </Card>

          <Section title="必要な書類">
            {state.data.procedure.requiredDocuments.length === 0 ? (
              <p className="text-sm text-slate-600">
                特にありません（公式ページでご確認ください）。
              </p>
            ) : (
              <ul className="space-y-1">
                {state.data.procedure.requiredDocuments.map((doc, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                        doc.status === 'unknown'
                          ? 'bg-amber-100 text-amber-900 ring-amber-300'
                          : doc.status === 'required'
                            ? 'bg-slate-200 text-slate-800 ring-slate-300'
                            : 'bg-brand-50 text-brand-800 ring-brand-200'
                      }`}
                    >
                      {documentStatusLabel[doc.status]}
                    </span>
                    <span className="text-slate-800">{doc.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="手続きの方法">
            <ul className="flex flex-wrap gap-2">
              {state.data.procedure.channels.map((ch) => (
                <li
                  key={ch}
                  className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800 ring-1 ring-inset ring-slate-300"
                >
                  {channelLabel[ch]}
                </li>
              ))}
            </ul>
            {state.data.procedure.onlineUrl && (
              <p className="mt-2 text-sm">
                <ExternalLink href={state.data.procedure.onlineUrl}>
                  オンライン手続きページ
                </ExternalLink>
              </p>
            )}
            {state.data.procedure.contact && (
              <p className="mt-1 text-sm text-slate-700">
                <span className="text-slate-500">問い合わせ：</span>
                {state.data.procedure.contact}
              </p>
            )}
          </Section>

          {state.data.procedure.locations && state.data.procedure.locations.length > 0 && (
            <Section title="場所・窓口">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                {state.data.procedure.locations.map((loc, i) => (
                  <li key={i}>{loc}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                <Link to="/facilities" className="font-semibold text-brand-700 underline">
                  窓口一覧（住所・地図リンク）を見る
                </Link>
              </p>
            </Section>
          )}

          {state.data.procedure.cautions && state.data.procedure.cautions.length > 0 && (
            <Section title="注意事項">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                {state.data.procedure.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="公式の根拠">
            <p className="text-xs text-slate-500">
              この手続きの内容は、以下の公式ページを根拠にしています。最新情報は必ず公式ページでご確認ください。
            </p>
            <div className="mt-2 space-y-2">
              {state.data.sources.map((s) => (
                <SourceCard key={s.sourceId} source={s} />
              ))}
            </div>
          </Section>

          <ChatPanel
            municipalityCode={municipalityCode}
            procedureId={state.data.procedure.id}
            category={state.data.procedure.canonicalType}
          />
        </article>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-2 pl-3.5">{children}</div>
    </section>
  );
}
