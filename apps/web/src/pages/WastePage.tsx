import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { WasteSchedule } from '@tmn/schemas';
import { ApiError, getMunicipalities, getWaste } from '../api/client';
import { useAppState } from '../state/AppState';
import { useAsync } from '../lib/useAsync';
import { weekOfMonthLabel, weekdayLabel } from '../lib/format';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { WasteSortingSearch } from '../components/WasteSortingSearch';
import { useDocumentTitle } from '../lib/navigation';

/**
 * ごみページ(§7.4 / FR-014・FR-015 / C-9)。地区(町丁目範囲)を選択式で選ぶと曜日を表示する。
 * caution(祝日・年末年始等の注意)は地区選択の有無にかかわらず常に表示する(C-9)。
 * 分別は公式ページへの導線リンクにとどめる(FR-014)。
 */
export function WastePage() {
  useDocumentTitle('ごみ・資源の収集日');
  const { municipalityCode } = useAppState();

  const base = useAsync(async () => {
    if (!municipalityCode) return null;
    const munis = await getMunicipalities();
    const muni = munis.find((m) => m.code === municipalityCode) ?? null;
    // なぜ: 収集曜日データを持たない対応自治体がある(例: 杉並区=第三者SaaSのJSウィジェット依存で
    // 機械取得不可、千代田区=PDFのみ)。この場合 API は 404(waste_data_unavailable)を返す、または
    // dataset はあっても地区が0件になる。いずれもエラー表示ではなく「未対応+公式導線」の空状態へ
    // フォールバックする(汎用実装。他自治体でも同じ挙動)。真のエラー(通信断等)は従来どおり投げる。
    try {
      const waste = await getWaste(municipalityCode);
      if (waste.areas.length === 0) return { muni, waste: null };
      return { muni, waste };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'waste_data_unavailable') {
        return { muni, waste: null };
      }
      throw e;
    }
  }, [municipalityCode]);

  const [areaId, setAreaId] = useState('');

  const detail = useAsync(async () => {
    if (!municipalityCode || !areaId) return null;
    return getWaste(municipalityCode, areaId);
  }, [municipalityCode, areaId]);

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
      <header>
        <h1 className="text-2xl font-bold text-slate-900">ごみ・資源の収集日</h1>
        <p className="text-sm text-slate-600">
          お住まいの地区（町丁目の範囲）を選ぶと、資源・ごみの収集曜日の目安を表示します。
        </p>
      </header>

      {base.loading && <Loading label="地区一覧を読み込み中です…" />}
      {base.error != null && <ErrorMessage error={base.error} onRetry={base.reload} />}

      {base.data && base.data.waste === null && (
        <WasteScheduleUnavailable
          municipalityName={base.data.muni?.name ?? municipalityCode}
          officialUrl={base.data.muni?.officialUrl}
        />
      )}

      {base.data && base.data.waste && (
        <>
          {/* C-9: cautionは常に表示。 */}
          <div
            role="note"
            className="flex gap-2.5 rounded-lg border border-amber-300 border-l-4 border-l-amber-500 bg-amber-50 p-3.5 text-sm text-amber-950"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 7a1 1 0 112 0 1 1 0 01-2 0zm2 3a1 1 0 10-2 0v4a1 1 0 102 0v-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-semibold">収集日についての注意</p>
              <p className="mt-1">{base.data.waste.caution}</p>
            </div>
          </div>

          {base.data.muni?.officialUrl && (
            <p className="text-sm">
              <span className="text-slate-600">ごみの分別ルールは公式ページでご確認ください：</span>
              <br />
              <ExternalLink href={base.data.muni.officialUrl}>
                {base.data.muni.name}の公式サイト
              </ExternalLink>
            </p>
          )}

          <Card>
            <label htmlFor="area" className="block font-semibold text-slate-900">
              地区を選ぶ
            </label>
            {base.data.waste.granularityNote && (
              <p className="text-xs text-slate-500">{base.data.waste.granularityNote}</p>
            )}
            <select
              id="area"
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">地区を選択してください</option>
              {base.data.waste.areas.map((a) => (
                <option key={a.areaId} value={a.areaId}>
                  {a.areaLabel}
                </option>
              ))}
            </select>
          </Card>

          {detail.loading && <Loading label="収集日を読み込み中です…" />}
          {detail.error != null && <ErrorMessage error={detail.error} onRetry={detail.reload} />}

          {detail.data && detail.data.schedules && (
            <section aria-labelledby="schedule-heading">
              <h2
                id="schedule-heading"
                className="flex items-center gap-2 text-lg font-bold text-slate-900"
              >
                <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                収集曜日
              </h2>
              <ScheduleTable schedules={detail.data.schedules} />
              <p className="mt-2 text-xs text-slate-500">
                上記は通年の曜日パターンの目安です。祝日・年末年始などの例外日は含みません（必ず公式カレンダー等でご確認ください）。
              </p>
            </section>
          )}
        </>
      )}

      {/* FR-014 補強: 品目名から分別区分を調べる検索。収集曜日データの有無にかかわらず常に表示
          (分別辞書は収集曜日とは別データ。未整備なら本コンポーネント側で公式導線へ縮退する)。 */}
      {base.data && (
        <WasteSortingSearch
          municipalityCode={municipalityCode}
          municipalityName={base.data.muni?.name ?? municipalityCode}
          officialUrl={base.data.muni?.officialUrl}
        />
      )}
    </div>
  );
}

/**
 * なぜ: 収集曜日データを整備していない対応自治体(例: 杉並区=第三者SaaSのJSウィジェット依存で
 * 機械取得不可、千代田区=PDFのみ)向けの空状態。原則3/9(推測しない・未対応を対応済みに見せない)に
 * 従い、曜日を推測表示せず「未対応である旨」と公式サイトへの導線のみを提示する汎用フォールバック。
 */
function WasteScheduleUnavailable({
  municipalityName,
  officialUrl,
}: {
  municipalityName: string;
  officialUrl?: string;
}) {
  return (
    <Card>
      <div className="flex gap-2.5">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 7a1 1 0 112 0 1 1 0 01-2 0zm2 3a1 1 0 10-2 0v4a1 1 0 102 0v-4z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <h2 className="font-semibold text-slate-900">
            この自治体の収集曜日はまだデータ対応していません
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            {municipalityName}
            の資源・ごみの収集曜日は、本アプリではまだデータとして提供していません。お住まいの地域の収集曜日は、公式サイトの収集曜日検索・地域別カレンダー等でご確認ください。
          </p>
          {officialUrl && (
            <p className="mt-3 text-sm">
              <ExternalLink href={officialUrl}>
                {municipalityName}の公式サイトで確認する
              </ExternalLink>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function ScheduleTable({ schedules }: { schedules: WasteSchedule[] }) {
  // wasteType ごとにまとめて表示する。
  const byType = new Map<string, WasteSchedule[]>();
  for (const s of schedules) {
    const list = byType.get(s.wasteType) ?? [];
    list.push(s);
    byType.set(s.wasteType, list);
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {/* DADSのテーブル作法: ヘッダ帯+濃い罫線。 */}
          <tr className="border-b border-slate-300 bg-slate-50 text-left">
            <th scope="col" className="px-2 py-2 font-semibold">
              種類
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              収集日
            </th>
          </tr>
        </thead>
        <tbody>
          {[...byType.entries()].map(([type, list]) => (
            <tr key={type} className="border-b border-slate-200 align-top">
              <th scope="row" className="px-2 py-2 text-left font-semibold text-slate-900">
                {type}
              </th>
              <td className="px-2 py-2">
                <ul className="space-y-0.5">
                  {list.map((s, i) => (
                    <li key={i}>
                      {weekdayLabel[s.weekday]}
                      {s.weekOfMonth && s.weekOfMonth.length > 0 && (
                        <span className="text-slate-500">
                          （{weekOfMonthLabel(s.weekOfMonth)}）
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
