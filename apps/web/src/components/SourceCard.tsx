import type { Source } from '@tmn/schemas';
import { formatDateFromDateTime } from '../lib/format';
import { ExternalLink } from './ui';

/**
 * なぜ: FR-008 根拠カード「ページタイトル・自治体・公式URL・最終確認日に1タップで到達」。
 * さらに FR-020 のためライセンスと帰属表示(attributionText)を明記する。CC BY等の
 * ライセンス文字列はデータ側(台帳)の値をそのまま表示し、UIに固有ロジックを持たない。
 *
 * デザイン意図: このカードは「公式根拠」の証票。左のブランドボーダーと公式マーク(インラインSVG)、
 * 目立たせた最終確認日で、行政情報としての信頼感を一目で伝える。
 */

/** 公式性を示す証票マーク(インラインSVG・外部依存なし)。 */
function OfficialSeal() {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm ring-4 ring-brand-100"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path
          d="M6.5 12.5l3.2 3.2 7-7.4"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function SourceCard({ source }: { source: Source }) {
  const verified = formatDateFromDateTime(source.lastVerifiedAt);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 border-l-4 border-l-brand-600 bg-gradient-to-br from-brand-50/70 to-white">
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <OfficialSeal />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-brand-700">
              公式根拠
            </p>
            <p className="mt-0.5 font-semibold leading-snug text-slate-900">{source.sourceTitle}</p>
          </div>
        </div>

        {verified && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-brand-100">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-4 w-4 shrink-0 text-brand-600"
              fill="currentColor"
            >
              <path d="M9 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2V2a1 1 0 112 0v1h2V2zM5 7v7h10V7H5z" />
            </svg>
            <span className="text-xs text-slate-500">最終確認日</span>
            <span className="text-sm font-bold text-slate-900">{verified}</span>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-sm text-slate-700">
          <dt className="text-slate-500">提供元</dt>
          <dd className="font-medium">{source.ownerOrganization}</dd>
          <dt className="text-slate-500">ライセンス</dt>
          <dd>{source.license}</dd>
          <dt className="text-slate-500">帰属表示</dt>
          <dd>{source.attributionText}</dd>
        </dl>

        <p className="mt-3">
          <ExternalLink href={source.sourceUrl}>公式ページを開く</ExternalLink>
        </p>
      </div>
    </div>
  );
}
