import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

/**
 * なぜ: 読み込み中・エラー・空状態の表示を全ページで統一する小さな部品群。エラーは
 * ApiError.message(次の行動が分かる文面)をそのまま出し、officialUrl があれば
 * 公式サイトへの導線(FR-021)を添える。
 */

export function Loading({ label = '読み込み中です…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-10">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 animate-spin text-brand-600"
        fill="none"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="3"
          className="opacity-25"
        />
        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-sm text-slate-600">{label}</span>
    </div>
  );
}

/** スケルトン行(スクリーンリーダーには読み上げさせない装飾)。 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-md ${className}`} />;
}

/** カード型スケルトン(リスト読み込み時のプレースホルダ)。 */
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-3 h-5 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : '予期しないエラーが発生しました。時間をおいて再度お試しください。';
  const officialUrl = error instanceof ApiError ? error.officialUrl : undefined;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.515 2.625H3.72c-1.344 0-2.187-1.458-1.515-2.625L8.485 2.495zM10 6a1 1 0 011 1v3a1 1 0 11-2 0V7a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <p className="font-semibold">エラーが発生しました</p>
        <p className="mt-1">{message}</p>
        {officialUrl && (
          <p className="mt-2">
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-red-900 underline"
            >
              公式サイトを開く（別タブ）
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

/** 空状態: 何もないことと「次の行動」を伝える。 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="mx-auto h-9 w-9 text-slate-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-6 4h6"
        />
      </svg>
      <p className="mt-3 font-semibold text-slate-800">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  // DADS流のフラットさ: 既定は影を落とさず1pxの罫線で面を区切る。操作可能カードのみ
  // ホバーで控えめな影(DADS Elevation-1相当)と罫線の濃さで反応を示す。
  const base = 'rounded-lg border border-slate-200 bg-white p-4 transition-shadow duration-150';
  const hover = interactive ? 'hover:border-slate-300 hover:shadow-sm' : '';
  return <div className={`${base} ${hover} ${className}`}>{children}</div>;
}

/** 外部公式リンク(別タブ・rel付き)。 */
/**
 * 外部リンク。同じ文言のリンクが多数並ぶ画面(自治体一覧の「公式サイトを見る」39個、窓口一覧の
 * 「地図で見る」施設数ぶん)では、読み上げのリンク一覧で区別できるよう ariaLabel に対象名を
 * 含める(視覚表示は変えない。WCAG 2.4.9)。sr-only テキストではなく aria-label を使うのは、
 * 本文中に同じ語(区名・施設名)を二重に出さないため。
 *
 * tap-target: このリンクは1行に1つだけ置かれることが多く、高さが文字サイズのまま(20px)だと
 * 指では狙いにくい。文字サイズは変えず高さだけ24pxを確保する(WCAG 2.2 SC 2.5.8)。
 */
export function ExternalLink({
  href,
  children,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel ? `${ariaLabel}（別タブで開きます）` : undefined}
      className="tap-target inline-flex items-center gap-1 font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-800 hover:decoration-brand-500"
    >
      {children}
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
      </svg>
      <span className="sr-only">（別タブで開きます）</span>
    </a>
  );
}
