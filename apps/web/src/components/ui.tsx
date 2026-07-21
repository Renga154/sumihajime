import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

/**
 * なぜ: 読み込み中・エラー表示を全ページで統一する小さな部品群。エラーは
 * ApiError.message(次の行動が分かる文面)をそのまま出し、officialUrl があれば
 * 公式サイトへの導線(FR-021)を添える。
 */

export function Loading({ label = '読み込み中です…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="py-8 text-center text-slate-600">
      {label}
    </p>
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
      className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"
    >
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
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** 外部公式リンク(別タブ・rel付き)。 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
    >
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only">（別タブで開きます）</span>
    </a>
  );
}
