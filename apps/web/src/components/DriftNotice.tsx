import type { DriftKind } from '@tmn/schemas';
import { formatMonthDay } from '../lib/format';

/**
 * 根拠カードの「機械巡回が揺らぎを検知した」1行(ADR-014)。
 *
 * なぜ公式リンクの直下に1行だけなのか: 検知は「自治体が更新したと宣言した/ページに届かない」
 * という事実であり、内容が変わったかどうかは人が再監査するまで分からない(原則3)。
 * 断定せず、利用者が取るべき次の行動(公式ページで最新を確認する)だけを短く示す。
 * リンク自体は消さない(原則8: 障害時も公式リンクは使える)。
 */
export function driftNoticeText(kind: DriftKind, detectedOn: string): string {
  const day = formatMonthDay(detectedOn);
  return kind === 'unreachable'
    ? `公式ページに接続できない状態を検知（${day}）。リンク先が移動した可能性があります。`
    : `公式ページの更新を検知（${day}）。内容を再確認中です。最新の情報は公式ページでご確認ください。`;
}

export function DriftNotice({
  kind,
  detectedOn,
  className = '',
}: {
  kind: DriftKind | undefined;
  detectedOn: string | undefined;
  className?: string;
}) {
  if (!kind || !detectedOn) return null;
  return (
    <p
      role="note"
      className={`rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs leading-relaxed text-orange-900 ${className}`}
    >
      {driftNoticeText(kind, detectedOn)}
    </p>
  );
}
