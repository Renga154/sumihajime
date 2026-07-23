import { useNavigate } from 'react-router-dom';
import type { MunicipalityWithCoverage } from '@tmn/schemas';
import { getMunicipalities } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { useAppState } from '../state/AppState';
import { Disclaimer } from '../components/Disclaimer';
import { Card, ErrorMessage, ExternalLink, SkeletonCard } from '../components/ui';
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

  // なぜ: 未対応59自治体を「23区/市部/町村部」に分けて折りたたむ(主役=対応中3を埋もれさせない)。
  // 分類は自治体コードの上位桁で決まる(131xx=区, 132xx=市, 133xx/134xx=町村)。
  const unsupportedGroups: { key: string; label: string; items: MunicipalityWithCoverage[] }[] = [
    { key: 'wards', label: '23区', items: unsupported.filter((m) => m.code.startsWith('131')) },
    { key: 'cities', label: '市部', items: unsupported.filter((m) => m.code.startsWith('132')) },
    {
      key: 'towns',
      label: '町村部',
      items: unsupported.filter((m) => m.code.startsWith('133') || m.code.startsWith('134')),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-accent-50/40 px-5 py-7 sm:px-7 sm:py-9">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand-100/50 blur-2xl"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
            公式根拠つき・期限順
          </span>
          <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight text-slate-900 sm:text-3xl">
            東京への転入手続きを、
            <br className="hidden sm:block" />
            やることリストに
          </h1>
          <p className="mt-3 max-w-xl text-slate-700">
            お住まいになる自治体・引越し日・当てはまる条件を選ぶと、公式ページの根拠と最終確認日つきで、
            期限順のToDoチェックリストを作成します。まずは自治体を選んでください。
          </p>
        </div>
      </section>

      <Disclaimer />

      <section aria-labelledby="muni-heading">
        <h2 id="muni-heading" className="text-lg font-bold text-slate-900">
          自治体を選ぶ
        </h2>

        {loading && (
          <div className="mt-3 space-y-2" aria-hidden="true">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {error != null && (
          <div className="mt-3">
            <ErrorMessage error={error} />
          </div>
        )}

        {data && (
          <div className="mt-3 space-y-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <span className="h-4 w-1 rounded-full bg-brand-500" aria-hidden="true" />
                対応している自治体
                <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                  {supported.length}
                </span>
              </h3>
              <ul className="mt-2 space-y-2">
                {supported.map((m) => (
                  <li key={m.code}>
                    <Card interactive className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100"
                        >
                          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M10 2a5 5 0 00-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 00-5-5zm0 6.5A1.5 1.5 0 1110 5.5a1.5 1.5 0 010 3z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{m.name}</p>
                          {m.note && <p className="text-xs text-slate-500">{m.note}</p>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => start(m)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800"
                      >
                        この自治体で始める
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="h-4 w-4"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 11-1.4-1.4L11.58 10 7.3 5.7a1 1 0 010-1.4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <span className="h-4 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                未対応の自治体
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                  {unsupported.length}
                </span>
              </h3>
              <p className="mt-0.5 pl-3 text-xs text-slate-500">
                現在チェックリストは作成できません。グループを開くと各自治体の公式サイトへの導線を表示します。
              </p>

              <div className="mt-2 space-y-2">
                {unsupportedGroups.map((g) => (
                  <details
                    key={g.key}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold text-slate-800 marker:content-none hover:bg-slate-100 focus-visible:bg-slate-100">
                      <span className="flex items-center gap-2">
                        {g.label}
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                          {g.items.length}件
                        </span>
                      </span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        className="h-4 w-4 shrink-0 text-slate-400 transition-transform"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.3 7.3a1 1 0 011.4 0L10 10.58l3.3-3.3a1 1 0 111.4 1.42l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.42z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </summary>
                    <ul className="space-y-2 border-t border-slate-200 p-3">
                      {g.items.map((m) => (
                        <li key={m.code}>
                          <Card className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {m.name}{' '}
                                <Badge tone="gray">未対応{m.note ? `（${m.note}）` : ''}</Badge>
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
                  </details>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
