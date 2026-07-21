import type { Source } from '@tmn/schemas';
import { formatDateFromDateTime } from '../lib/format';
import { ExternalLink } from './ui';

/**
 * なぜ: FR-008 根拠カード「ページタイトル・自治体・公式URL・最終確認日に1タップで到達」。
 * さらに FR-020 のためライセンスと帰属表示(attributionText)を明記する。CC BY等の
 * ライセンス文字列はデータ側(台帳)の値をそのまま表示し、UIに固有ロジックを持たない。
 */
export function SourceCard({ source }: { source: Source }) {
  const verified = formatDateFromDateTime(source.lastVerifiedAt);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-semibold text-slate-900">{source.sourceTitle}</p>
      <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-slate-700">
        <dt className="text-slate-500">提供元</dt>
        <dd>{source.ownerOrganization}</dd>
        <dt className="text-slate-500">ライセンス</dt>
        <dd>{source.license}</dd>
        <dt className="text-slate-500">帰属表示</dt>
        <dd>{source.attributionText}</dd>
        {verified && (
          <>
            <dt className="text-slate-500">最終確認日</dt>
            <dd>{verified}</dd>
          </>
        )}
      </dl>
      <p className="mt-2">
        <ExternalLink href={source.sourceUrl}>公式ページを開く</ExternalLink>
      </p>
    </div>
  );
}
