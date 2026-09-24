import { useMemo, useState, type ReactNode } from 'react';
import type {
  CoverageStatus,
  MunicipalityWithCoverage,
  ServiceStats,
  SourceLedgerEntry,
  SourceType,
} from '@tmn/schemas';
import { getMunicipalities, getServiceStats, getSources } from '../api/client';
import { useAsync } from '../lib/useAsync';
import {
  categoryText,
  coverageStatusLabel,
  formatDate,
  formatDateFromDateTime,
  formatDateTimeInTokyo,
  updateFrequencyText,
} from '../lib/format';
import {
  jstDateString,
  latestVerifiedDate,
  summarizeFreshness,
  type FreshnessSummary,
  type YearDataCountdown,
} from '../lib/provenance';
import { filterByQuery, normalizeSearchText } from '../lib/municipality-search';
import { OPENDATA_GAPS_SOURCE_DOC, OPENDATA_GAP_CASES } from '../content/opendata-gaps';
import { Badge } from '../components/Badge';
import { MunicipalityFilter } from '../components/MunicipalityFilter';
import { Card, EmptyState, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { useDocumentTitle } from '../lib/navigation';

/**
 * 「このサービスのデータについて」(透明性ページ / §7 / FR-020・FR-024)。
 * 本プロダクトの核である「公式根拠と来歴の徹底」(CLAUDE.md原則2・3・10)を、利用者に安心して
 * 使ってもらうために、平易な言葉で公開する。構成は利用者の関心順(Step2):
 *  1. 対応している自治体と内容(カバレッジ表)
 *  2. データの新しさ(鮮度サマリー)
 *  3. 出典一覧(データソース台帳。CC BYは帰属表示)
 *  4. オープンデータ品質レポート(改善への建設的な貢献。技術寄りの詳細は末尾)
 *
 * データは公開API(/api/sources, /api/municipalities)からのみ取得し、判定ロジックは持たない
 * (鮮度計算は lib/provenance の純関数)。自治体名は台帳に無いため municipalities から引く。
 * 開発トラッキング(タスクID・進捗)はリポジトリのdocsが正であり、この画面には出さない。
 *
 * 表示の設計(重要): 62自治体 × 332ソースを一度に展開すると、モバイルで12万px超になり
 * 「全部載っているが誰も辿れない」ページになる。透明性は到達可能性で決まるため、
 * 情報は一切削らずに、自治体ごとの詳細を既定で折りたたみ、冒頭に要約と自治体名の絞り込みを
 * 置いて初期表示を短くする。折りたたみは <details> で、キーボード操作とスクリーンリーダーの
 * 開閉に標準対応させる。
 */

const sourceTypeLabel: Record<SourceType, string> = {
  api: 'API',
  csv: 'CSV',
  json: 'JSON',
  html: 'HTML',
  pdf: 'PDF',
  // Step5-B: sourceTypeSchema に 'xlsx' を追加(大田区の収集曜日オープンデータ配信形式)したため、
  // 網羅的な Record を満たす表示ラベルを追加(型の網羅性による必須の追従。表示専用)。
  xlsx: 'XLSX',
};

const statusTone: Record<CoverageStatus, 'green' | 'amber' | 'gray'> = {
  verified: 'green',
  partial: 'amber',
  unavailable: 'gray',
};

/** CC BY 系ライセンスか(帰属表示バッジの対象)。データ側のライセンス文字列で判定する。 */
function isCcBy(license: string): boolean {
  return license.includes('CC BY');
}

interface MunicipalityGroup {
  code: string;
  name: string;
  sources: SourceLedgerEntry[];
}

/** 台帳を自治体別にまとめ、コード昇順で返す。自治体名は munis から引く(無ければ共通扱い)。 */
function groupSourcesByMunicipality(
  sources: SourceLedgerEntry[],
  nameByCode: Map<string, string>,
): MunicipalityGroup[] {
  const groups = new Map<string, SourceLedgerEntry[]>();
  for (const s of sources) {
    const code = s.municipalityCode ?? '00000';
    const list = groups.get(code) ?? [];
    list.push(s);
    groups.set(code, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, list]) => ({
      code,
      // 13000=東京都の機関(水道局・下水道局・警視庁等)、00000=国/全国共通(デジタル庁・日本郵便)。
      // どちらも区ではないため、区名と取り違えられない見出しにする(ADR-009)。
      name: nameByCode.get(code) ?? providerGroupName(code),
      sources: list,
    }));
}

function providerGroupName(code: string): string {
  if (code === '13000') return '東京都（都の機関）';
  if (code === '00000') return '国・全国共通（市区町村以外）';
  return '東京都・共通';
}

export function CoveragePage() {
  useDocumentTitle('このサービスのデータについて');
  const state = useAsync(async () => {
    const [munis, sources] = await Promise.all([getMunicipalities(), getSources()]);
    const today = jstDateString();
    const freshness = summarizeFreshness(sources, today);
    const nameByCode = new Map(munis.map((m) => [m.code, m.name]));
    const groups = groupSourcesByMunicipality(sources, nameByCode);
    const lastVerified = latestVerifiedDate(sources);
    return { munis, freshness, groups, today, lastVerified };
  }, []);

  // ADR-014: 機械巡回の要約は /api/stats から別に取る。失敗しても対応状況・出典一覧は
  // 見せ続ける(原則8)ため、本体の読み込みとは結合しない。
  const statsState = useAsync(() => getServiceStats(), []);

  const [query, setQuery] = useState('');
  const filtering = normalizeSearchText(query) !== '';

  const munis = state.data?.munis;
  const groups = state.data?.groups;
  const filteredMunis = useMemo(() => filterByQuery(munis ?? [], query), [munis, query]);
  const filteredGroups = useMemo(() => filterByQuery(groups ?? [], query), [groups, query]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">このサービスのデータについて</h1>
        <p className="mt-1 text-sm text-slate-600">
          安心してお使いいただけるよう、どの自治体・内容に対応しているか、表示している情報がどの公式
          データに基づき、いつ確認したものかを、このページですべて公開しています。情報のもとをたどれる
          状態にしておくことが、本サービスの土台です。
        </p>
      </header>

      {state.loading && <Loading label="データを読み込み中です…" />}
      {state.error != null && <ErrorMessage error={state.error} onRetry={state.reload} />}

      {state.data && (
        <>
          <section aria-labelledby="summary-heading" className="space-y-3">
            <SectionHeading id="summary-heading">このページの要約</SectionHeading>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="対応している自治体"
                value={state.data.munis.filter((m) => m.supported).length}
                unit="件"
                tone="brand"
              />
              <StatTile
                label="掲載している自治体"
                value={state.data.munis.length}
                unit="件"
                tone="gray"
              />
              <StatTile
                label="承認済み公式ソース"
                value={state.data.freshness.total}
                unit="件"
                tone="green"
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">最終更新日</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {state.data.lastVerified ? formatDate(state.data.lastVerified) : '—'}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              自治体ごとの対応状況と出典の一覧は、下の各セクションで自治体名をタップすると開きます。
              情報は省略していません。長い一覧を辿りやすくするため、既定では閉じています。
            </p>
            <MunicipalityFilter
              id="about-data-filter"
              label="自治体名で絞り込む"
              hint="漢字・ひらがな・カタカナ・ローマ字のいずれでも探せます。対応状況と出典の両方に効きます。"
              value={query}
              onChange={setQuery}
              resultText={
                filtering
                  ? `対応状況 ${filteredMunis.length}件 / 出典グループ ${filteredGroups.length}件が一致`
                  : `対応状況 ${filteredMunis.length}件 / 出典グループ ${filteredGroups.length}件を掲載中`
              }
            />
          </section>

          <section aria-labelledby="cov-heading" className="space-y-3">
            <SectionHeading id="cov-heading">対応している自治体と内容</SectionHeading>
            <p className="text-sm text-slate-600">
              対応している自治体と、カテゴリごとの対応状況です。未対応の自治体は、対応済みのように
              見せることはしません。
            </p>
            {filteredMunis.length === 0 ? (
              <EmptyState title="一致する自治体は見つかりませんでした">
                絞り込みの入力を短くしてお試しください。
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {filteredMunis.map((m) => (
                  <li key={m.code}>
                    <MunicipalityCoverage municipality={m} open={filtering} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <FreshnessSection freshness={state.data.freshness} today={state.data.today} />

          <DriftPatrolSection stats={statsState.data ?? undefined} loading={statsState.loading} />

          <section aria-labelledby="ledger-heading" className="space-y-3">
            <SectionHeading id="ledger-heading">出典一覧（データソース台帳）</SectionHeading>
            <p className="text-sm text-slate-600">
              本サービスが利用している公式データの一覧です。クリエイティブ・コモンズ 表示（CC
              BY）等の ライセンスに基づくデータは、提供元・帰属表示・ライセンスを明記しています。
            </p>
            {filteredGroups.length === 0 ? (
              <EmptyState title="一致する出典グループは見つかりませんでした">
                絞り込みの入力を短くしてお試しください。
              </EmptyState>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map((g) => (
                  <SourceLedgerGroup key={g.code} group={g} open={filtering} />
                ))}
              </div>
            )}
          </section>

          <OpendataQualitySection />
        </>
      )}
    </div>
  );
}

/**
 * 自治体別の折りたたみ枠(対応状況・出典一覧で共用)。
 * <summary> は見出し(h3)を内包し、見出しジャンプでも自治体を辿れるようにする。
 */
function CollapsibleMunicipality({
  open,
  heading,
  badge,
  children,
}: {
  open: boolean;
  heading: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className="print-avoid-break overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 marker:content-none hover:bg-slate-50 focus-visible:bg-slate-50">
        <span className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{heading}</h3>
          {badge}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0 text-slate-400"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 011.4 0L10 10.58l3.3-3.3a1 1 0 111.4 1.42l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.42z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-lg font-bold text-slate-900">
      <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
      {children}
    </h2>
  );
}

/* ---- 1. 鮮度サマリー ---- */

function FreshnessSection({ freshness, today }: { freshness: FreshnessSummary; today: string }) {
  const { total, within7, within30, older, unknown, yearData } = freshness;
  return (
    <section aria-labelledby="fresh-heading" className="space-y-3">
      <SectionHeading id="fresh-heading">データの新しさ</SectionHeading>
      <p className="text-sm text-slate-600">
        基準日 {formatDate(today)}（日本時間）時点での、公式データの最終確認状況です。
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="公式ソース総数" value={total} unit="件" tone="brand" />
        <StatTile label="7日以内に確認" value={within7} unit="件" tone="green" />
        <StatTile label="30日以内に確認" value={within30} unit="件" tone="amber" />
        <StatTile label="30日より前" value={older} unit="件" tone="gray" />
      </div>
      {unknown > 0 && (
        <p className="text-xs text-slate-500">
          ※ 最終確認日が未記録のソースが {unknown} 件あります（鮮度分布から除外）。
        </p>
      )}

      {yearData.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">
            年度データの有効期限（更新が必要になるまでの残り日数）
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {yearData.map((y) => (
              <li key={y.sourceId}>
                <YearDataCountdownCard countdown={y} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---- 1b. 機械巡回の状況(ADR-014) ---- */

/**
 * なぜ公開するのか: 「根拠が揺らいだら黙って古くならない」を約束するなら、巡回が動いていること・
 * いま何件を再確認中にしているかも利用者に見せる(原則9: 検知できないものは検知できないと示す)。
 * 数値はすべて /api/stats(D1 の source_drift)由来で、画面に定数を持たない。
 */
function DriftPatrolSection({
  stats,
  loading,
}: {
  stats: ServiceStats | undefined;
  loading: boolean;
}) {
  const flagged = stats?.driftFlaggedSources;
  const lastChecked = stats?.driftLastCheckedAt;
  return (
    <section aria-labelledby="drift-heading" className="space-y-3">
      <SectionHeading id="drift-heading">機械巡回の状況</SectionHeading>
      <p className="text-sm text-slate-600">
        承認済みの公式ソースを毎時10件ずつ再取得し、自治体ページの「更新日」が変わったものを自動で「再確認中」にしています。
        再確認中の手続きもチェックリストから消さず、公式ページへのリンクは残します。解除は人が再確認してからです。
      </p>
      {loading ? (
        <p className="text-sm text-slate-500">巡回の状況を読み込み中です…</p>
      ) : stats === undefined ? (
        <p className="text-sm text-slate-500">巡回の状況を読み込めませんでした。</p>
      ) : lastChecked === undefined ? (
        <p className="text-sm text-slate-700">まだ巡回していません。</p>
      ) : (
        <p className="text-sm text-slate-700">
          現在 <span className="font-bold tabular-nums text-slate-900">{flagged ?? 0}</span>{' '}
          件が再確認中です（最終巡回: {formatDateTimeInTokyo(lastChecked)} JST）。
        </p>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  tone: 'brand' | 'green' | 'amber' | 'gray';
}) {
  const toneClass: Record<typeof tone, string> = {
    brand: 'border-brand-200 bg-brand-50',
    green: 'border-green-200 bg-green-50',
    amber: 'border-amber-200 bg-amber-50',
    gray: 'border-slate-200 bg-slate-50',
  };
  return (
    <div className={`rounded-lg border p-3 ${toneClass[tone]}`}>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
        {value}
        <span className="ml-0.5 text-sm font-semibold text-slate-500">{unit}</span>
      </p>
    </div>
  );
}

function YearDataCountdownCard({ countdown }: { countdown: YearDataCountdown }) {
  const { title, category, effectiveTo, daysRemaining, expired } = countdown;
  const soon = !expired && daysRemaining <= 90;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">{categoryText(category)}</span>
        {expired ? (
          <Badge tone="red">要更新（期限切れ）</Badge>
        ) : soon ? (
          <Badge tone="amber">まもなく更新</Badge>
        ) : (
          <Badge tone="green">有効</Badge>
        )}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug text-slate-900">{title}</p>
      <p className="mt-1.5 text-sm text-slate-700">
        有効期限 <span className="font-semibold">{formatDate(effectiveTo)}</span>
        {expired ? (
          <span className="ml-1 font-semibold text-red-700">
            （{Math.abs(daysRemaining)}日超過）
          </span>
        ) : (
          <span className="ml-1 font-semibold tabular-nums text-brand-700">
            （残り {daysRemaining}日）
          </span>
        )}
      </p>
    </div>
  );
}

/* ---- 2. 対応状況(既存の維持) ---- */

function MunicipalityCoverage({
  municipality,
  open,
}: {
  municipality: MunicipalityWithCoverage;
  open: boolean;
}) {
  return (
    <CollapsibleMunicipality
      open={open}
      heading={municipality.name}
      badge={
        <>
          <Badge tone={municipality.supported ? 'green' : 'gray'}>
            {municipality.supported ? '対応' : '未対応'}
          </Badge>
          {municipality.coverage.length > 0 && (
            <span className="text-xs text-slate-500">カテゴリ{municipality.coverage.length}件</span>
          )}
        </>
      }
    >
      {municipality.officialUrl && (
        <p className="text-sm">
          <ExternalLink href={municipality.officialUrl}>公式サイト</ExternalLink>
        </p>
      )}
      {municipality.coverage.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {/* DADSのテーブル作法: ヘッダは淡い帯で本文と区別し、下に濃い罫線を敷く。 */}
              <tr className="border-b border-slate-300 bg-slate-50 text-left">
                <th scope="col" className="px-2 py-1.5 font-semibold">
                  カテゴリ
                </th>
                <th scope="col" className="px-2 py-1.5 font-semibold">
                  状況
                </th>
              </tr>
            </thead>
            <tbody>
              {municipality.coverage.map((c) => (
                <tr key={c.category} className="border-b border-slate-100">
                  <th scope="row" className="px-2 py-1.5 text-left font-normal text-slate-800">
                    {categoryText(c.category)}
                  </th>
                  <td className="px-2 py-1.5">
                    <Badge tone={statusTone[c.status]}>{coverageStatusLabel[c.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleMunicipality>
  );
}

/* ---- 3. データソース台帳テーブル ---- */

function SourceLedgerGroup({ group, open }: { group: MunicipalityGroup; open: boolean }) {
  return (
    <CollapsibleMunicipality
      open={open}
      heading={group.name}
      badge={
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
          {group.sources.length}件
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{group.name}のデータソース台帳</caption>
          <thead>
            {/* DADSのテーブル作法: ヘッダ帯(淡いグレー)+濃い罫線で列見出しを明確にする。 */}
            <tr className="border-b border-slate-300 bg-slate-50 text-left align-bottom">
              <th scope="col" className="px-2 py-2 font-semibold">
                タイトル
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                種別
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                ライセンス
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                最終確認日
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                更新頻度
              </th>
            </tr>
          </thead>
          <tbody>
            {group.sources.map((s) => (
              <tr key={s.sourceId} className="border-b border-slate-100 align-top">
                <th scope="row" className="px-2 py-2 text-left font-normal">
                  <ExternalLink href={s.sourceUrl}>{s.sourceTitle}</ExternalLink>
                  {isCcBy(s.license) && (
                    <span className="mt-1 block text-xs text-slate-500">{s.attributionText}</span>
                  )}
                </th>
                <td className="px-2 py-2 text-slate-700">{sourceTypeLabel[s.sourceType]}</td>
                <td className="px-2 py-2">
                  {isCcBy(s.license) ? (
                    <Badge tone="brand">{s.license}</Badge>
                  ) : (
                    <span className="text-slate-600">{s.license}</span>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-700">
                  {formatDateFromDateTime(s.lastVerifiedAt) || '—'}
                </td>
                <td className="px-2 py-2 text-slate-700">
                  {updateFrequencyText(s.updateFrequency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleMunicipality>
  );
}

/* ---- 4. オープンデータ品質レポート ---- */

function OpendataQualitySection() {
  return (
    <section aria-labelledby="oq-heading" className="space-y-3">
      <SectionHeading id="oq-heading">オープンデータ品質レポート</SectionHeading>
      <p className="text-sm text-slate-600">
        データ整備の過程で気づいた、公開オープンデータの改善余地を記録しています。自治体の
        オープンデータ公開は横断利用の基盤であり、以下は品質向上に建設的に貢献する目的でまとめた
        ものです（出典:{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{OPENDATA_GAPS_SOURCE_DOC}</code>
        ）。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPENDATA_GAP_CASES.map((c) => (
          <Card key={c.id} className="print-avoid-break">
            <div className="flex items-center gap-2">
              <Badge tone="blue">{c.municipality}</Badge>
              <span className="text-xs text-slate-500">確認日 {formatDate(c.confirmedOn)}</span>
            </div>
            <h3 className="mt-2 font-semibold leading-snug text-slate-900">{c.headline}</h3>
            <p className="mt-1 text-xs text-slate-500">{c.dataset}</p>
            <p className="mt-2 text-sm text-slate-700">{c.summary}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  本サービスの対応
                </dt>
                <dd className="mt-0.5 text-slate-700">{c.contribution}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  一般化できる観点
                </dt>
                <dd className="mt-0.5 text-slate-700">{c.takeaway}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
    </section>
  );
}
