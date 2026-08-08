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
  /**
   * 折りたたんで置くか。
   *
   * なぜ既定で開かないのか(2026-08-09 実測): トップの一等地に置いていたとき、主たる操作である
   * 自治体選択に届くまでモバイル375pxで1.5画面分のスクロールを要していた。この節の内容は
   * サービスの作り方の説明であり、利用者が最初に取る行動を変えるものではない。
   * ただし本作の中核(公式根拠・LLMに判定させない)を示す節でもあるため、消さずに
   * 見出しだけ残してたたむ。開けば全文が読める。
   */
  collapsible?: boolean;
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

export function DataProvenance({ stats, collapsible = false }: DataProvenanceProps) {
  const chips = buildStatChips(stats);

  const body = (
    <>
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
    </>
  );

  if (collapsible) {
    return (
      <details className="group rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        {/*
          summary に見出しを入れる。見出し要素を summary の中に置くのは、
          たたんだ状態でも見出しの一覧(スクリーンリーダーの見出しジャンプ)から
          この節へ到達できるようにするため。details/summary が開閉状態を
          自前のARIAなしで伝えるので、aria-expanded は付けない。
        */}
        <summary className="tap-target -mx-1 flex cursor-pointer list-none items-center gap-2 rounded px-1 py-0.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 11-1.4-1.4L11.58 10 7.3 5.7a1 1 0 010-1.4z"
              clipRule="evenodd"
            />
          </svg>
          <h2 className="text-sm font-bold text-slate-900">オープンデータとAIの使い方</h2>
          <span className="ml-auto text-xs text-slate-500 group-open:hidden">開く</span>
        </summary>
        <div className="mt-1 pl-6">{body}</div>
      </details>
    );
  }

  return (
    <section
      aria-labelledby="provenance-heading"
      className="rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <h2 id="provenance-heading" className="text-sm font-bold text-slate-900">
        オープンデータとAIの使い方
      </h2>
      {body}
    </section>
  );
}
