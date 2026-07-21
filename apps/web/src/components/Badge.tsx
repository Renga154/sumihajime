import type { ReactNode } from 'react';
import type { DataStatus, Priority } from '@tmn/schemas';
import { dataStatusLabel, priorityLabel } from '../lib/format';

/**
 * なぜ: §15.3「色だけで状態を表現しない」。全バッジはテキストラベルを必ず含み、
 * 色はあくまで補助とする。tone はTailwindの配色クラスへマップする。
 */

type Tone = 'red' | 'orange' | 'blue' | 'gray' | 'green' | 'amber';

const toneClass: Record<Tone, string> = {
  red: 'bg-red-100 text-red-900 ring-red-300',
  orange: 'bg-orange-100 text-orange-900 ring-orange-300',
  amber: 'bg-amber-100 text-amber-900 ring-amber-300',
  blue: 'bg-blue-100 text-blue-900 ring-blue-300',
  gray: 'bg-slate-100 text-slate-800 ring-slate-300',
  green: 'bg-green-100 text-green-900 ring-green-300',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

const priorityTone: Record<Priority, Tone> = {
  urgent: 'red',
  high: 'orange',
  normal: 'blue',
  optional: 'gray',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={priorityTone[priority]}>
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
  return <Badge tone="amber">要確認</Badge>;
}
