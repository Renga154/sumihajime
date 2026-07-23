import type { ReactNode } from 'react';
import type { DataStatus, Priority } from '@tmn/schemas';
import { dataStatusLabel, priorityLabel } from '../lib/format';

/**
 * なぜ: §15.3「色だけで状態を表現しない」。全バッジはテキストラベルを必ず含み、
 * 色はあくまで補助とする。優先度バッジは色+アイコン+テキストの三重で状態を伝える。
 * tone はブランド/セマンティックの配色クラスへマップする(いずれも文字色900系で AA を満たす)。
 */

type Tone = 'red' | 'orange' | 'blue' | 'gray' | 'green' | 'amber' | 'brand';

const toneClass: Record<Tone, string> = {
  red: 'bg-red-100 text-red-900 ring-red-200',
  orange: 'bg-orange-100 text-orange-900 ring-orange-200',
  amber: 'bg-amber-100 text-amber-900 ring-amber-200',
  blue: 'bg-blue-100 text-blue-900 ring-blue-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  gray: 'bg-slate-100 text-slate-800 ring-slate-200',
  green: 'bg-green-100 text-green-900 ring-green-200',
};

export function Badge({
  tone = 'gray',
  icon,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${toneClass[tone]}`}
    >
      {icon && (
        <span aria-hidden="true" className="-ml-0.5 inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

const iconCls = 'h-3.5 w-3.5';

const priorityIcon: Record<Priority, ReactNode> = {
  // 至急: 警告の三角。
  urgent: (
    <svg viewBox="0 0 20 20" className={iconCls} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l5.28 9.146c.673 1.166-.17 2.625-1.515 2.625H4.72c-1.344 0-2.187-1.459-1.515-2.625l5.28-9.146zM10 7a1 1 0 00-1 1v2a1 1 0 102 0V8a1 1 0 00-1-1zm0 6a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  ),
  // 重要: 上向きの二重シェブロン。
  high: (
    <svg
      viewBox="0 0 20 20"
      className={iconCls}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 11l4-4 4 4M6 15l4-4 4 4" />
    </svg>
  ),
  // 通常: チェック。
  normal: (
    <svg viewBox="0 0 20 20" className={iconCls} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  ),
  // 任意: 円(点線的な控えめさ)。
  optional: (
    <svg viewBox="0 0 20 20" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="10" cy="10" r="6" strokeDasharray="2.5 2.5" />
    </svg>
  ),
};

const priorityTone: Record<Priority, Tone> = {
  urgent: 'red',
  high: 'orange',
  normal: 'brand',
  optional: 'gray',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={priorityTone[priority]} icon={priorityIcon[priority]}>
      <span className="sr-only">優先度：</span>
      {priorityLabel[priority]}
    </Badge>
  );
}

const dataStatusTone: Record<DataStatus, Tone> = {
  verified: 'green',
  partial: 'amber',
  stale: 'orange',
  unavailable: 'gray',
};

export function DataStatusBadge({ status }: { status: DataStatus }) {
  return (
    <Badge tone={dataStatusTone[status]}>
      <span className="sr-only">データの状態：</span>
      {dataStatusLabel[status]}
    </Badge>
  );
}

/** 「要確認」バッジ(needs_confirmation)。 */
export function NeedsConfirmationBadge() {
  return (
    <Badge
      tone="amber"
      icon={
        <svg viewBox="0 0 20 20" className={iconCls} fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 7a1 1 0 112 0 1 1 0 01-2 0zm2 3a1 1 0 10-2 0v4a1 1 0 102 0v-4z"
            clipRule="evenodd"
          />
        </svg>
      }
    >
      要確認
    </Badge>
  );
}
