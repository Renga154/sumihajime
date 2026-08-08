import type { ServiceStats } from '@tmn/schemas';
import { formatDate } from '../lib/format';

/**
 * トップの「このサービスのつくり」(独立点検の指摘: トップに「オープンデータ」「AI」の語が
 * 一度も出ず、本作の中核であるデータ活用が3分審査の視界に入らない)。
 *
 * 守る条件:
 *  - 数値は必ず GET /api/stats(D1の実データ)由来にし、画面に定数を書かない。区・ソースが
 *    増減すれば表示も自動で追随する。
 *  - 数値が取れないときは数値を出さない(推測しない=CLAUDE.md原則3)。文章だけを出す。
 *  - 対応自治体数は必ず母数と併記する(「23区対応」だけを見せて全都対応と誤解させない=原則9)。
 *  - 分量はトップの既存トーンを崩さない範囲に収める(要約3点+チップのみ)。
 */

interface DataProvenanceProps {
  /** GET /api/stats の結果。未取得・失敗時は undefined(そのとき数値は一切出さない)。 */
  stats?: ServiceStats;
}

interface Chip {
  label: string;
  value: string;
}

/** 表示するチップを実データから組み立てる(純関数。数値が無ければ空配列)。 */
export function buildStatChips(stats: ServiceStats | undefined): Chip[] {
  if (!stats) return [];
  const chips: Chip[] = [
    {
      label: '対応自治体',
      value: `${stats.supportedMunicipalities} / ${stats.totalMunicipalities}`,
    },
    { label: '承認済みの公式ソース', value: `${stats.approvedSources}件` },
  ];
  if (stats.lastVerifiedDate) {
    chips.push({ label: '最終確認', value: formatDate(stats.lastVerifiedDate) });
  }
  return chips;
}

export function DataProvenance({ stats }: DataProvenanceProps) {
  const chips = buildStatChips(stats);

  return (
    <section
      aria-labelledby="provenance-heading"
      className="rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <h2 id="provenance-heading" className="text-sm font-bold text-slate-900">
        オープンデータとAIの使い方
      </h2>

      {chips.length > 0 && (
        <dl className="mt-2.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <div
              key={c.label}
              className="inline-flex items-baseline gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1 ring-1 ring-inset ring-brand-100"
            >
              <dt className="text-xs text-slate-600">{c.label}</dt>
              <dd className="text-sm font-bold text-brand-700">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ul className="mt-2.5 space-y-1 text-sm text-slate-700">
        <li>
          各区が公開する公式ページとオープンデータ（CSV・API）を機械判読で取り込み、人手で承認した
          ものだけを掲載しています。
        </li>
        <li>
          どのタスクを表示するかはルールで判定し、AIには任せていません。AIチャットは、選んだ区の
          公式資料に基づく出典つきの回答だけを返し、根拠が見つからないときは答えを作らずに公式
          ページへご案内します。
        </li>
      </ul>
    </section>
  );
}
