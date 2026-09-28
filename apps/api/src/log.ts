/**
 * なぜ: 計画§13「構造化ログはallowlist方式(requestId / municipalityCode / イベント名 /
 * レイテンシms のみ)。プロフィール内容(moveDate・ageBands・flags等)をログに出さない」。
 * denylistではなく allowlist にすることで、ログにPIIが漏れる経路を構造的に塞ぐ。
 * この型に無いフィールドはそもそもログ関数へ渡せない(住所・世帯・フラグ値は型で拒否)。
 */
/**
 * ログのイベント名。なぜ string ではなく列挙か: 監視・集計はイベント名で数える。誤字や言い換えで
 * 新しい名前が黙って増えると、アラート条件から漏れる。追加するときはここへ足す(型が強制する)。
 * error.* は fail() が機械可読コードから組み立てる(code は固定の識別子で、利用者入力は入らない)。
 */
export type LogEventName =
  | 'municipalities.list'
  | 'checklist.generated'
  | 'procedure.detail'
  | 'facilities.list'
  | 'stats.summary'
  | 'sources.list'
  | 'ward-differences.list'
  | 'waste.areas'
  | 'waste.schedules'
  | 'waste_sorting.summary'
  | 'waste_sorting.search'
  | 'chat.rate_limited'
  /** 全体の1日上限(CHAT_DAILY_LIMIT)に達して断った。 */
  | 'chat.daily_limited'
  /** 1日上限の計数(D1)自体に失敗した。チャットは閉じる側に倒す。 */
  | 'chat.usage_counter_failed'
  | 'chat.abstained'
  /** 生成回答に公式でも引用でもないURLが含まれたため保留へ差し替えた(質問経由のURL注入対策)。 */
  | 'chat.rejected_untrusted_url'
  | 'chat.answered'
  | 'chat.answered.verified_documents'
  | 'chat.unavailable'
  | 'chat.timeout'
  | 'chat.error'
  | 'drift.run'
  | `error.${string}`;

export interface LogEvent {
  requestId: string;
  event: LogEventName;
  /** 選択自治体コード(PIIではない。スコープ健全性の観測に必要)。 */
  municipalityCode?: string;
  latencyMs?: number;
  /** HTTPステータス(非PII)。 */
  status?: number;
  /** 件数(生成タスク数・引用数など。非PII)。 */
  count?: number;
  /** RAG保留フラグ(§13。質問本文・回答本文は残さず、保留したか否かのみ記録)。 */
  abstained?: boolean;
  /** ADR-014 定期巡回: 今回巡回したソースID(台帳の公開IDであり PII ではない。URL・本文は出さない)。 */
  driftSourceIds?: string[];
  /** ADR-014 定期巡回: 今回 changed/unreachable と判定した件数。 */
  driftFlagged?: number;
}

const ALLOWED_KEYS: (keyof LogEvent)[] = [
  'requestId',
  'event',
  'municipalityCode',
  'latencyMs',
  'status',
  'count',
  'abstained',
  'driftSourceIds',
  'driftFlagged',
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
