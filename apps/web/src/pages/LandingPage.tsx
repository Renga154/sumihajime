import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MunicipalityWithCoverage } from '@tmn/schemas';
import { getMunicipalities, getServiceStats } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { useAppState } from '../state/AppState';
import { filterByQuery, normalizeSearchText } from '../lib/municipality-search';
import { Disclaimer } from '../components/Disclaimer';
import { DataProvenance } from '../components/DataProvenance';
import { MunicipalityFilter } from '../components/MunicipalityFilter';
import { Card, EmptyState, ErrorMessage, ExternalLink, SkeletonCard } from '../components/ui';
import { Badge } from '../components/Badge';
import { useDocumentTitle } from '../lib/navigation';

/**
 * ランディング/自治体選択(§7.2)。対応自治体のみ選択可能にし、未対応自治体は
 * 「未対応」表示と公式サイトへの外部リンクのみを出す(FR-021 / CLAUDE.md原則9:
 * 未対応を対応済みに見せない)。§16.2の説明(Disclaimer)を上部に表示する。
 *
 * 62自治体を縦に並べるだけでは自分の区に辿り着くまでのスクロールが長すぎるため、
 * 一覧の先頭に絞り込み(漢字/かな/ローマ字/コード)を置く。絞り込みは対応・未対応の
 * 双方に等しく効かせ、件数表示も追随させる(未対応を対応済みに見せない原則は維持)。
 */

/**
 * 対応自治体を既定で何件まで並べるか。
 *
 * 8件の根拠(2026-08-09 実測、モバイル375px): カード1枚が約88pxで、23件を常に並べると
 * この一覧だけで2,014pxを占め、続く節が実質見えない位置まで押し下げられていた。
 * 8件なら約700pxに収まり、かつ「一覧がある」ことは十分に伝わる。
 */
const SUPPORTED_PREVIEW_COUNT = 8;

export function LandingPage() {
  // トップはサイト名そのものを <title> にする(他ページは「ページ名 | サイト名」)。
  useDocumentTitle();
  const navigate = useNavigate();
  const { setMunicipalityCode } = useAppState();
  const { data, error, loading, reload } = useAsync(() => getMunicipalities(), []);
  // トップの実測サマリー。失敗しても自治体選択(主要導線)は無傷にしたいので、
  // useAsync のエラーはここでは表示せず、数値を出さないだけに縮退する(推測しない)。
  const statsState = useAsync(() => getServiceStats(), []);
  const [query, setQuery] = useState('');

  function start(m: MunicipalityWithCoverage) {
    setMunicipalityCode(m.code);
    navigate('/wizard');
  }

  const [showAllSupported, setShowAllSupported] = useState(false);

  const filtering = normalizeSearchText(query) !== '';
  const all = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => filterByQuery(all, query), [all, query]);
  const supported = filtered.filter((m) => m.supported);
  const unsupported = filtered.filter((m) => !m.supported);

  /*
   * 対応自治体は既定で先頭 SUPPORTED_PREVIEW_COUNT 件だけ出し、残りは「もっと見る」で開く。
   *
   * なぜ(2026-08-09 実測): 23件を常に並べるとモバイル375pxでこの一覧だけで2,014pxあり、
   * 続く節が誰の目にも入らない位置まで押し下げられていた。名前で探す導線(絞り込み)が
   * 上にあるため、全件を最初から積む必要がない。
   *
   * 絞り込み中は必ず全件出す。検索した結果が隠れていては検索の意味がないため。
   */
  const truncateSupported =
    !filtering && !showAllSupported && supported.length > SUPPORTED_PREVIEW_COUNT;
  const visibleSupported = truncateSupported
    ? supported.slice(0, SUPPORTED_PREVIEW_COUNT)
    : supported;

  // なぜ: 未対応の自治体を「23区/市部/町村部」に分けて折りたたむ(主役=対応中を埋もれさせない)。
  // 分類は自治体コードの上位桁で決まる(131xx=区, 132xx=市, 133xx/134xx=町村)。
  // 2026-08-07 に23特別区がすべて対応済みになったため「23区」グループは空になり、末尾の
  // フィルタで非表示になる(0件のグループを見出しだけ残さない)。未対応は市部26+町村部13の39件。
  // 絞り込み中は絞り込み後の一覧を対象にするため、一致0件のグループも同様に消える。
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
      <section className="relative overflow-hidden rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-accent-50/40 px-5 py-7 sm:px-7 sm:py-9">
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
            <ErrorMessage error={error} onRetry={reload} />
          </div>
        )}

        {data && (
          <div className="mt-3 space-y-4">
            <MunicipalityFilter
              id="muni-filter"
              label="自治体名で絞り込む"
              hint="漢字・ひらがな・カタカナ・ローマ字のいずれでも探せます。"
              value={query}
              onChange={setQuery}
              resultText={
                filtering
                  ? `${filtered.length}件が一致（対応 ${supported.length}件 / 未対応 ${unsupported.length}件）`
                  : // 一部だけ描画している状態で「全件を表示中」と書くと事実に反する(原則3・9)。
                    `全${all.length}件（対応 ${supported.length}件 / 未対応 ${unsupported.length}件）`
              }
            />

            {filtering && filtered.length === 0 && (
              <EmptyState title="一致する自治体は見つかりませんでした">
                入力を短くするか、区・市・町村の名前の一部（例:
                練馬、ねりま、nerima）でお試しください。
              </EmptyState>
            )}

            {supported.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                  <span className="h-4 w-1 rounded-full bg-brand-500" aria-hidden="true" />
                  対応している自治体
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                    {supported.length}
                  </span>
                </h3>
                {truncateSupported && (
                  <p className="mt-0.5 pl-3 text-xs text-slate-500">
                    {supported.length}件のうち{visibleSupported.length}
                    件を表示しています。上の絞り込みで名前から探せます。
                  </p>
                )}
                <ul id="supported-list" className="mt-2 space-y-2">
                  {visibleSupported.map((m) => (
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
                            <p id={`muni-name-${m.code}`} className="font-semibold text-slate-900">
                              {m.name}
                            </p>
                            {m.note && <p className="text-xs text-slate-500">{m.note}</p>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => start(m)}
                          // 同名ボタンが23個並ぶため、読み上げのボタン一覧で区別できるよう
                          // 隣の自治体名を参照してアクセシブル名に含める(視覚表示は不変。WCAG 2.4.9)。
                          aria-labelledby={`start-${m.code} muni-name-${m.code}`}
                          id={`start-${m.code}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 active:bg-brand-800"
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
                {!filtering && supported.length > SUPPORTED_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAllSupported((v) => !v)}
                    aria-expanded={showAllSupported}
                    aria-controls="supported-list"
                    className="tap-target mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-slate-50"
                  >
                    {showAllSupported
                      ? '表示を減らす'
                      : `すべて表示（残り${supported.length - SUPPORTED_PREVIEW_COUNT}件）`}
                  </button>
                )}
              </div>
            )}

            {unsupported.length > 0 && (
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
                      // 絞り込み中はグループを開いて一致結果をすぐ見せる(閉じたままだと
                      // 「件数だけ出て中身が見えない」状態になる)。絞り込みを消せば既定の閉に戻る。
                      open={filtering}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60"
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
                                    <ExternalLink
                                      href={m.officialUrl}
                                      ariaLabel={`${m.name}の公式サイトを見る`}
                                    >
                                      公式サイトを見る
                                    </ExternalLink>
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
            )}
          </div>
        )}
      </section>

      {/*
        自治体選択の直下に置く。サービスの作り方の説明であって、利用者が最初に取る行動を
        変えるものではないため、一等地は主たる操作(自治体選択)に譲る。
        ただし本作の中核(公式根拠・LLMに判定させない)を示す節なので消さずに残す。
      */}
      <DataProvenance stats={statsState.data ?? undefined} collapsible />
    </div>
  );
}
