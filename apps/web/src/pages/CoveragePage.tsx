import type { ReactNode } from 'react';
import type {
  CoverageStatus,
  MunicipalityWithCoverage,
  SourceLedgerEntry,
  SourceType,
} from '@tmn/schemas';
import { getMunicipalities, getSources } from '../api/client';
import { useAsync } from '../lib/useAsync';
import {
  categoryText,
  coverageStatusLabel,
  formatDate,
  formatDateFromDateTime,
} from '../lib/format';
import {
  jstDateString,
  summarizeFreshness,
  type FreshnessSummary,
  type YearDataCountdown,
} from '../lib/provenance';
import { OPENDATA_GAPS_SOURCE_DOC, OPENDATA_GAP_CASES } from '../content/opendata-gaps';
import { Badge } from '../components/Badge';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';

/**
 * 対応状況・データの来歴ダッシュボード(§7 / FR-020・FR-024 / Wave3)。
 * 本プロダクトの核である「公式根拠と来歴の徹底」(CLAUDE.md原則2・3・10)を、利用者・審査員に
 * 見える形で提示する:
 *  1. 鮮度サマリー(ソース総数・最終確認からの経過日数分布・年度データの残日数カウントダウン)
 *  2. 自治体の対応状況(既存のカバレッジ表)
 *  3. データソース台帳テーブル(自治体別。CC BYは帰属表示)
 *  4. オープンデータ品質レポート(改善への建設的な貢献)
 *
 * データは公開API(/api/sources, /api/municipalities)からのみ取得し、判定ロジックは持たない
 * (鮮度計算は lib/provenance の純関数)。自治体名は台帳に無いため municipalities から引く。
 */

const sourceTypeLabel: Record<SourceType, string> = {
  api: 'API',
  csv: 'CSV',
  json: 'JSON',
  html: 'HTML',
  pdf: 'PDF',
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
      name: nameByCode.get(code) ?? (code === '13000' ? '東京都' : '東京都・共通'),
      sources: list,
    }));
}

export function CoveragePage() {
  const state = useAsync(async () => {
    const [munis, sources] = await Promise.all([getMunicipalities(), getSources()]);
    const today = jstDateString();
    const freshness = summarizeFreshness(sources, today);
    const nameByCode = new Map(munis.map((m) => [m.code, m.name]));
    const groups = groupSourcesByMunicipality(sources, nameByCode);
    return { munis, freshness, groups, today };
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">対応状況・データの来歴</h1>
        <p className="text-sm text-slate-600">
          どの自治体・カテゴリに対応しているか、表示内容がどの公式データに基づくか、そのデータを
          いつ確認したかを公開しています。公式根拠と来歴を辿れることが、本サービスの土台です。
        </p>
      </header>

      {state.loading && <Loading label="来歴データを読み込み中です…" />}
      {state.error != null && <ErrorMessage error={state.error} />}

      {state.data && (
        <>
          <FreshnessSection freshness={state.data.freshness} today={state.data.today} />

          <section aria-labelledby="cov-heading" className="space-y-3">
            <SectionHeading id="cov-heading">自治体の対応状況</SectionHeading>
            <ul className="space-y-3">
              {state.data.munis.map((m) => (
                <li key={m.code}>
                  <MunicipalityCoverage municipality={m} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="ledger-heading" className="space-y-3">
            <SectionHeading id="ledger-heading">データソース台帳</SectionHeading>
            <p className="text-sm text-slate-600">
              本サービスが利用する公式データの一覧です。クリエイティブ・コモンズ 表示（CC BY）等の
              ライセンスに基づくデータは、提供元・帰属表示・ライセンスを明記しています。
            </p>
            {state.data.groups.map((g) => (
              <SourceLedgerGroup key={g.code} group={g} />
            ))}
          </section>

          <OpendataQualitySection />
        </>
      )}
    </div>
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
      <SectionHeading id="fresh-heading">データの鮮度</SectionHeading>
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
    <div className={`rounded-xl border p-3 ${toneClass[tone]}`}>
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
    <div className="rounded-xl border border-slate-200 bg-white p-3">
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

function MunicipalityCoverage({ municipality }: { municipality: MunicipalityWithCoverage }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">
          {municipality.name}{' '}
          <Badge tone={municipality.supported ? 'green' : 'gray'}>
            {municipality.supported ? '対応' : '未対応'}
          </Badge>
        </p>
        {municipality.officialUrl && (
          <ExternalLink href={municipality.officialUrl}>公式サイト</ExternalLink>
        )}
      </div>
      {municipality.coverage.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th scope="col" className="py-1 pr-4 font-semibold">
                  カテゴリ
                </th>
                <th scope="col" className="py-1 font-semibold">
                  状況
                </th>
              </tr>
            </thead>
            <tbody>
              {municipality.coverage.map((c) => (
                <tr key={c.category} className="border-b border-slate-100">
                  <th scope="row" className="py-1 pr-4 text-left font-normal text-slate-800">
                    {categoryText(c.category)}
                  </th>
                  <td className="py-1">
                    <Badge tone={statusTone[c.status]}>{coverageStatusLabel[c.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---- 3. データソース台帳テーブル ---- */

function SourceLedgerGroup({ group }: { group: MunicipalityGroup }) {
  return (
    <Card className="print-avoid-break">
      <h3 className="font-semibold text-slate-800">
        {group.name}
        <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
          {group.sources.length}件
        </span>
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{group.name}のデータソース台帳</caption>
          <thead>
            <tr className="border-b border-slate-300 text-left align-bottom">
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                タイトル
              </th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                種別
              </th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                ライセンス
              </th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                最終確認日
              </th>
              <th scope="col" className="py-1.5 font-semibold">
                更新頻度
              </th>
            </tr>
          </thead>
          <tbody>
            {group.sources.map((s) => (
              <tr key={s.sourceId} className="border-b border-slate-100 align-top">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <ExternalLink href={s.sourceUrl}>{s.sourceTitle}</ExternalLink>
                  {isCcBy(s.license) && (
                    <span className="mt-1 block text-xs text-slate-500">{s.attributionText}</span>
                  )}
                </th>
                <td className="py-2 pr-3 text-slate-700">{sourceTypeLabel[s.sourceType]}</td>
                <td className="py-2 pr-3">
                  {isCcBy(s.license) ? (
                    <Badge tone="brand">{s.license}</Badge>
                  ) : (
                    <span className="text-slate-600">{s.license}</span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums text-slate-700">
                  {formatDateFromDateTime(s.lastVerifiedAt) || '—'}
                </td>
                <td className="py-2 text-slate-700">{s.updateFrequency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
