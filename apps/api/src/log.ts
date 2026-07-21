/**
 * なぜ: 計画§13「構造化ログはallowlist方式(requestId / municipalityCode / イベント名 /
 * レイテンシms のみ)。プロフィール内容(moveDate・ageBands・flags等)をログに出さない」。
 * denylistではなく allowlist にすることで、ログにPIIが漏れる経路を構造的に塞ぐ。
 * この型に無いフィールドはそもそもログ関数へ渡せない(住所・世帯・フラグ値は型で拒否)。
 */
export interface LogEvent {
  requestId: string;
  event: string;
  /** 選択自治体コード(PIIではない。スコープ健全性の観測に必要)。 */
  municipalityCode?: string;
  latencyMs?: number;
  /** HTTPステータス(非PII)。 */
  status?: number;
  /** 件数(生成タスク数・引用数など。非PII)。 */
  count?: number;
  /** RAG保留フラグ(§13。質問本文・回答本文は残さず、保留したか否かのみ記録)。 */
  abstained?: boolean;
}

const ALLOWED_KEYS: (keyof LogEvent)[] = [
  'requestId',
  'event',
  'municipalityCode',
  'latencyMs',
  'status',
  'count',
  'abstained',
];

/**
 * なぜ: 渡されたオブジェクトから allowlist キーだけを抽出して出力する二重の防御。
 * 呼び出し側が誤って余剰キーを混ぜても、ここで確実に落とす。
 */
export function logEvent(fields: LogEvent): void {
  const safe: Record<string, unknown> = { ts: new Date().toISOString() };
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (value !== undefined) safe[key] = value;
  }
  // 単一行JSONで出力(集約基盤で機械可読)。
  console.log(JSON.stringify(safe));
}
