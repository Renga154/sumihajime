import { useNavigate } from 'react-router-dom';
import type { MunicipalityWithCoverage } from '@tmn/schemas';
import { getMunicipalities } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { useAppState } from '../state/AppState';
import { Disclaimer } from '../components/Disclaimer';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { Badge } from '../components/Badge';

/**
 * ランディング/自治体選択(§7.2)。対応自治体のみ選択可能にし、未対応自治体は
 * 「未対応」表示と公式サイトへの外部リンクのみを出す(FR-021 / CLAUDE.md原則9:
 * 未対応を対応済みに見せない)。§16.2の説明(Disclaimer)を上部に表示する。
 */
export function LandingPage() {
  const navigate = useNavigate();
  const { setMunicipalityCode } = useAppState();
  const { data, error, loading } = useAsync(() => getMunicipalities(), []);

  function start(m: MunicipalityWithCoverage) {
    setMunicipalityCode(m.code);
    navigate('/wizard');
  }

  const supported = (data ?? []).filter((m) => m.supported);
  const unsupported = (data ?? []).filter((m) => !m.supported);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold text-slate-900">
          東京への転入手続きを、やることリストに
        </h1>
        <p className="mt-2 text-slate-700">
          お住まいになる自治体・引越し日・当てはまる条件を選ぶと、公式ページの根拠と最終確認日つきで、
          期限順のToDoチェックリストを作成します。まずは自治体を選んでください。
        </p>
      </section>

      <Disclaimer />

      <section aria-labelledby="muni-heading">
        <h2 id="muni-heading" className="text-lg font-bold text-slate-900">
          自治体を選ぶ
        </h2>

        {loading && <Loading label="対応自治体を読み込み中です…" />}
        {error != null && (
          <div className="mt-3">
            <ErrorMessage error={error} />
          </div>
        )}

        {data && (
          <div className="mt-3 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-600">対応している自治体</h3>
              <ul className="mt-2 space-y-2">
                {supported.map((m) => (
                  <li key={m.code}>
                    <Card className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{m.name}</p>
                        {m.note && <p className="text-xs text-slate-500">{m.note}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => start(m)}
                        className="shrink-0 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        この自治体で始める
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-600">未対応の自治体</h3>
              <p className="text-xs text-slate-500">
                現在チェックリストは作成できません。手続きは各自治体の公式サイトでご確認ください。
              </p>
              <ul className="mt-2 space-y-2">
                {unsupported.map((m) => (
                  <li key={m.code}>
                    <Card className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {m.name} <Badge tone="gray">未対応{m.note ? `（${m.note}）` : ''}</Badge>
                        </p>
                        {m.officialUrl && (
                          <p className="mt-1 text-sm">
                            <ExternalLink href={m.officialUrl}>公式サイトを見る</ExternalLink>
                          </p>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
