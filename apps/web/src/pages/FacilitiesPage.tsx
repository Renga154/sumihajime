import { Link } from 'react-router-dom';
import type { Facility } from '@tmn/schemas';
import { getFacilities } from '../api/client';
import { useAppState } from '../state/AppState';
import { useAsync } from '../lib/useAsync';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { FacilityMap } from '../components/FacilityMap';
import { useDocumentTitle } from '../lib/navigation';

/**
 * 窓口一覧(§7.4 / FR-012・FR-013 / ADR-005)。カテゴリ別に一覧表示し、座標を持つ施設は
 * 地理院タイルの地図(FacilityMap)にも表示する。距離計算・最寄り表示・現在地取得はしない。
 * 住所は公式ソース由来の文字列をそのまま表示し(「要確認」等もそのまま出す)。
 * 地図はプログレッシブエンハンス: 読込に失敗しても一覧は無傷。座標が無い施設は地図に出さず、
 * 一覧に「地図未対応(座標データなし)」の注記を添えて掲載を続ける(捏造しない)。
 */

/** 地図の「一覧へ飛ばす」リンクの着地点id(FacilityMap と共有する)。 */
const FACILITY_LIST_ID = 'facility-list';

/** 座標を持たない施設か(地図に出せない=注記の対象)。 */
function hasNoCoordinates(f: Facility): boolean {
  return typeof f.lat !== 'number' || typeof f.lng !== 'number';
}
export function FacilitiesPage() {
  useDocumentTitle('窓口一覧');
  const { municipalityCode } = useAppState();
  const state = useAsync(async () => {
    if (!municipalityCode) return null;
    return getFacilities(municipalityCode);
  }, [municipalityCode]);

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

  const groups = groupByCategory(state.data ?? []);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">窓口一覧</h1>
        <p className="text-sm text-slate-600">
          手続きの窓口をカテゴリ別に掲載しています。開庁時間や取扱い業務は変わることがあるため、お出かけ前に公式ページでご確認ください。
        </p>
      </header>

      {state.loading && <Loading page label="窓口一覧を読み込み中です…" />}
      {state.error != null && <ErrorMessage error={state.error} onRetry={state.reload} />}

      {state.data && state.data.length > 0 && (
        <FacilityMap facilities={state.data} skipTargetId={FACILITY_LIST_ID} />
      )}

      {state.data && groups.length === 0 && (
        <Card>
          <p className="text-slate-700">窓口の情報がまだ整備されていません。</p>
        </Card>
      )}

      {/*
        地図の「地図を飛ばして窓口の一覧へ」の着地点。tabIndex=-1 でスクリプト/リンクからの
        フォーカス移動だけを受け付ける(タブ順は増やさない)。
      */}
      <div id={FACILITY_LIST_ID} tabIndex={-1} className="space-y-4">
        {groups.map(([category, list]) => (
          <section key={category} aria-labelledby={`fac-${category}`}>
            <h2
              id={`fac-${category}`}
              className="flex items-center gap-2 text-lg font-bold text-slate-900"
            >
              <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
              {category}
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                {list.length}件
              </span>
            </h2>
            <ul className="mt-2.5 space-y-2">
              {list.map((f) => (
                <li key={f.facilityId}>
                  <Card interactive>
                    {/* 窓口名は見出し要素にする(カテゴリ見出し h2 の下位=h3)。
                      スクリーンリーダーの見出しジャンプで窓口を辿れるようにするため。 */}
                    <h3 className="font-semibold text-slate-900">{f.name}</h3>
                    <p className="text-sm text-slate-700">{f.address}</p>
                    {f.hours && <p className="text-sm text-slate-600">開庁時間：{f.hours}</p>}
                    {hasNoCoordinates(f) && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5 text-slate-400"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 2a6 6 0 00-6 6c0 4.314 5.163 9.443 5.383 9.66a.87.87 0 001.234 0C10.837 17.443 16 12.314 16 8a6 6 0 00-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        地図未対応（座標データなし）
                      </p>
                    )}
                    {f.address && !f.address.includes('要確認') && (
                      <p className="mt-1 text-sm">
                        <ExternalLink
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}`}
                          ariaLabel={`${f.name}を地図で見る`}
                        >
                          地図で見る
                        </ExternalLink>
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function groupByCategory(facilities: Facility[]): [string, Facility[]][] {
  const map = new Map<string, Facility[]>();
  for (const f of facilities) {
    const list = map.get(f.category) ?? [];
    list.push(f);
    map.set(f.category, list);
  }
  return [...map.entries()];
}
