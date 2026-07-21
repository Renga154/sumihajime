import type { CoverageStatus, MunicipalityWithCoverage, Profile, Source } from '@tmn/schemas';
import { getMunicipalities, getProcedure, postChecklist } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { categoryText, coverageStatusLabel } from '../lib/format';
import { Badge } from '../components/Badge';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { SourceCard } from '../components/SourceCard';

/**
 * カバレッジ/データソースページ(§7 / FR-020・FR-024)。自治体×カテゴリの対応状況表と、
 * 出典一覧(タイトル・提供元・ライセンス・最終確認日・URL)を表示し、CC BYの帰属表示を明記する。
 *
 * 出典一覧は専用エンドポイントが無いため、対応自治体の全手続き(全条件ONの暫定チェックリストで
 * 列挙)の詳細から根拠ソースを収集して重複排除する(UI側集約。API/データは変更しない)。
 */

/** 全カテゴリを列挙するための「全条件ON」プロフィール(出典の網羅用。表示はしない)。 */
function allFlagsProfile(code: string): Profile {
  return {
    destination: { municipalityCode: code },
    moveDate: '2026-08-01',
    originType: 'outside_tokyo',
    household: {
      memberCount: 3,
      ageBands: ['age0_2', 'age3_5', 'elementary', 'junior_senior', 'adult', 'senior65plus'],
    },
    flags: {
      hasMyNumberCard: true,
      needsNationalHealthInsurance: true,
      needsNationalPension: true,
      hasSchoolOrChildcareNeeds: true,
      hasDog: true,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: true,
      needsForeignResidentGuidance: true,
      needsVehicleGuidance: true,
      isPregnantMember: true,
    },
  };
}

async function fetchSourcesFor(code: string): Promise<Source[]> {
  const checklist = await postChecklist(allFlagsProfile(code));
  const ids = [...new Set(checklist.tasks.map((t) => t.procedureId))];
  const details = await Promise.all(ids.map((id) => getProcedure(id, code)));
  const map = new Map<string, Source>();
  for (const d of details) {
    for (const s of d.sources) map.set(s.sourceId, s);
  }
  return [...map.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

const statusTone: Record<CoverageStatus, 'green' | 'amber' | 'gray'> = {
  verified: 'green',
  partial: 'amber',
  unavailable: 'gray',
};

export function CoveragePage() {
  const state = useAsync(async () => {
    const munis = await getMunicipalities();
    const supported = munis.filter((m) => m.supported);
    const sourcesByMuni = await Promise.all(
      supported.map(async (m) => ({ muni: m, sources: await fetchSourcesFor(m.code) })),
    );
    return { munis, sourcesByMuni };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">対応状況とデータの出典</h1>
        <p className="text-sm text-slate-600">
          どの自治体・カテゴリに対応しているか、また表示内容がどの公式データに基づくかを公開しています。
        </p>
      </header>

      {state.loading && <Loading label="読み込み中です…" />}
      {state.error != null && <ErrorMessage error={state.error} />}

      {state.data && (
        <>
          <section aria-labelledby="cov-heading">
            <h2 id="cov-heading" className="text-lg font-bold text-slate-900">
              自治体の対応状況
            </h2>
            <ul className="mt-2 space-y-3">
              {state.data.munis.map((m) => (
                <li key={m.code}>
                  <MunicipalityCoverage municipality={m} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="src-heading">
            <h2 id="src-heading" className="text-lg font-bold text-slate-900">
              データの出典
            </h2>
            <p className="text-sm text-slate-600">
              本サービスは、各自治体が公開するオープンデータや公式ページを出典として利用しています。
              クリエイティブ・コモンズ 表示（CC BY）等のライセンスに基づくデータは、以下のとおり
              提供元・帰属表示・ライセンスを明記しています。
            </p>
            {state.data.sourcesByMuni.map(({ muni, sources }) => (
              <div key={muni.code} className="mt-3">
                <h3 className="font-semibold text-slate-800">{muni.name}</h3>
                {sources.length === 0 ? (
                  <p className="text-sm text-slate-600">出典データがありません。</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {sources.map((s) => (
                      <SourceCard key={s.sourceId} source={s} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

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
