import type { GeneratedTask } from '@tmn/schemas';
import { formatDate } from './format';

/**
 * なぜ: チェックリストの期限タスクを iCalendar(.ics)へ変換する純関数(RFC 5545)。
 * サーバーへは一切送らずクライアントで生成・ダウンロードするため(§13 プライバシー維持:
 * 収集する個人情報を増やさない)、ここは副作用のない文字列生成だけを担い、Blob/DOM操作は
 * 呼び出し側(ChecklistPage)に置く。テスト容易性のため dtstamp は注入可能にする。
 *
 * 生成規則:
 *  - dueDate を持つタスクのみを終日イベント(VALUE=DATE)として出力する(期限なしは除外)。
 *  - UID は `<municipalityCode>-<procedureId>@tokyo-move-navi`。再生成しても安定(dtstampに依存しない)。
 *  - SUMMARY=タスク名、DESCRIPTION=1行理由+公式URL+最終確認日。いずれも TEXT値としてエスケープする。
 */

const PRODID = '-//tokyo-move-navi//checklist//JA';
const UID_DOMAIN = 'tokyo-move-navi';

/**
 * RFC 5545 §3.3.11 TEXT値のエスケープ。バックスラッシュ→セミコロン→カンマ→改行の順で処理する
 * (バックスラッシュを最初に置換しないと、後続で挿入した `\` を二重エスケープしてしまうため)。
 * コロンは TEXT 値ではエスケープ不要(URL の https:// をそのまま保持する)。
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 コンテンツ行の折返し。1行75オクテットを超える場合、CRLF+空白1つで継続する。
 * マルチバイト(日本語)を壊さないよう UTF-8 バイト数で数え、必ず文字(コードポイント)境界で折る。
 * 継続行は先頭空白1オクテットを含めて75になるよう、中身を74オクテットに制限する。
 */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  // 先頭行は75オクテットまで。継続行は先頭空白分を引いて74オクテットまで。
  let limit = 75;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      segments.push(current);
      current = ch;
      currentBytes = chBytes;
      limit = 74;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  segments.push(current);
  return segments.join('\r\n ');
}

/** YYYY-MM-DD(先頭10桁)→ YYYYMMDD(DATE値)。 */
function toIcsDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

/** 終日イベントの DTEND(排他的)= 開始日の翌日。UTC正午基準でTZ差の丸め誤差を避ける。 */
function nextIcsDate(iso: string): string {
  const base = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  const next = new Date(base + 86_400_000);
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Date → RFC5545 UTC DATE-TIME(YYYYMMDDTHHMMSSZ)。 */
function toIcsDateTimeUtc(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export interface BuildIcsOptions {
  /** DTSTAMP に用いる生成時刻。テストで固定値を注入するために公開する。既定は現在時刻。 */
  dtstamp?: Date;
}

/** dueDate を持つ(=ICSへ書き出せる)タスクだけを返す。UIの注記や無効化判定に使う。 */
export function datedTasks(tasks: readonly GeneratedTask[]): GeneratedTask[] {
  return tasks.filter((t): t is GeneratedTask => Boolean(t.dueDate));
}

/**
 * チェックリストを iCalendar 文字列へ変換する。dueDate を持つタスクが無い場合は空の
 * VCALENDAR(イベント0件)を返す(呼び出し側でボタンを無効化する想定)。
 */
export function buildChecklistIcs(
  tasks: readonly GeneratedTask[],
  municipalityCode: string,
  options: BuildIcsOptions = {},
): string {
  const dtstamp = toIcsDateTimeUtc(options.dtstamp ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const t of datedTasks(tasks)) {
    const src = t.sources[0];
    const descParts = [t.applicabilityReason];
    if (src) {
      descParts.push(`公式: ${src.url}`);
      descParts.push(`最終確認日: ${formatDate(src.lastVerifiedAt.slice(0, 10))}`);
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${municipalityCode}-${t.procedureId}@${UID_DOMAIN}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(t.dueDate as string)}`,
      `DTEND;VALUE=DATE:${nextIcsDate(t.dueDate as string)}`,
      `SUMMARY:${escapeIcsText(t.title)}`,
      `DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // RFC5545 は行末 CRLF。折返しは各行へ適用してから CRLF で連結する。
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
