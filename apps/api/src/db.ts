import type {
  Coverage,
  Facility,
  MunicipalityWithCoverage,
  ProcedureVersion,
  RuleSet,
  Source,
  WasteArea,
  WasteSchedule,
  WasteSortingCategorySummary,
  WasteSortingItem,
} from '@tmn/schemas';
import {
  coverageSchema,
  facilitySchema,
  municipalityWithCoverageSchema,
  procedureVersionSchema,
  ruleSetSchema,
  sourceSchema,
  wasteAreaSchema,
  wasteScheduleSchema,
  wasteSortingCategorySummarySchema,
  wasteSortingItemSchema,
} from '@tmn/schemas';

/**
 * なぜ: D1(SQLite)の行 → ドメインオブジェクトへの変換層。JSON列のparse・0/1のbool化・
 * NULL→undefined を一手に引き受け、返す前に必ず @tmn/schemas で検証する(境界での型保証)。
 * 自治体スコープはSQLのWHERE municipality_code=? でサーバー側強制(原則4)。
 */

import type { VectorizeQueryable } from '@tmn/rag';
import { tokyoDate } from './tokyo-date.js';

export interface Bindings {
  DB: D1Database;
  /**
   * 静的アセット(apps/web/dist)。Worker から index.html を読み出してSPAフォールバックを
   * 自前で返すために使う(未定義URLへ 404 ステータスを付けるため。wrangler.jsonc 参照)。
   * ローカルの単体テストではバインドされないため optional。
   */
  ASSETS?: Fetcher;
  // RAG(T-013)。RAG_ENABLED!=='true' の間は /api/chat が 503 を返すため、以下は未設定でも動く。
  VECTORIZE?: VectorizeQueryable;
  RAG_ENABLED?: string;
  /** wrangler secret。値はログ・レスポンスに出さない。 */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  RAG_MIN_SCORE?: string;
  /** ADR-014: 1回の定期巡回で再取得する承認済みソース件数(既定10。Workers Free の枠内)。 */
  DRIFT_BATCH_SIZE?: string;
  /**
   * 生成(OpenAI)を伴うチャットの全体1日上限(日本時間の暦日ごと)。既定1500。
   * 不正値は既定値に倒す(config.ts parseChatDailyLimit)。
   */
  CHAT_DAILY_LIMIT?: string;
  /**
   * 独自ドメインのオリジン(例 https://sumihajime.com)。設定した環境だけ、旧URL・www の画面を
   * 301 でここへ送る(canonical-host.ts)。ミラーでは設定しない。
   */
  CANONICAL_ORIGIN?: string;
}

type Row = Record<string, unknown>;

/** ---- rag_chunks (T-013) ---- */

export interface RagChunkRow {
  chunkId: string;
  municipalityCode: string;
  sourceId: string;
  procedureId?: string;
  category: string;
  title: string;
  url: string;
  lastVerifiedAt: string;
  /** 同一 source_id 内でのチャンク連番。生成窓を文書順へ戻すために使う(orderByDocumentPosition)。 */
  seq: number;
  text: string;
}

/**
 * なぜ: Vectorizeが返した chunk_id 群の本文を D1 から取得する。municipality_code を SQL 側でも
 * 強制フィルタし、スコープ外のチャンク(万一の混入)を構造的に排除する(§11.3 重大障害の二重防御)。
 */
export async function getRagChunks(
  db: D1Database,
  code: string,
  chunkIds: string[],
): Promise<Map<string, RagChunkRow>> {
  const map = new Map<string, RagChunkRow>();
  const unique = [...new Set(chunkIds)];
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => '?').join(',');
  const res = await db
    .prepare(
      `SELECT chunk_id, municipality_code, source_id, procedure_id, category, title, url, ` +
        `last_verified_at, seq, text FROM rag_chunks ` +
        `WHERE municipality_code = ? AND chunk_id IN (${placeholders})`,
    )
    .bind(code, ...unique)
    .all<Row>();
  for (const row of res.results) {
    map.set(asString(row.chunk_id), {
      chunkId: asString(row.chunk_id),
      municipalityCode: asString(row.municipality_code),
      sourceId: asString(row.source_id),
      procedureId: optString(row.procedure_id),
      category: asString(row.category),
      title: asString(row.title),
      url: asString(row.url),
      lastVerifiedAt: asString(row.last_verified_at),
      seq: Number(row.seq ?? 0),
      text: asString(row.text),
    });
  }
  return map;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}
function optString(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function optNumber(v: unknown): number | undefined {
  return v == null ? undefined : Number(v);
}
function parseJson<T>(v: unknown): T {
  return JSON.parse(asString(v)) as T;
}
function optJson<T>(v: unknown): T | undefined {
  return v == null ? undefined : (JSON.parse(String(v)) as T);
}

/** ---- municipalities (+ coverage) ---- */

export async function getMunicipalitiesWithCoverage(
  db: D1Database,
): Promise<MunicipalityWithCoverage[]> {
  const [munis, cov] = await Promise.all([
    db
      .prepare('SELECT code, name, supported, note, official_url FROM municipalities ORDER BY code')
      .all<Row>(),
    db
      .prepare('SELECT municipality_code, category, status, last_verified_at FROM coverage')
      .all<Row>(),
  ]);

  const coverageByMunicipality = new Map<string, Coverage[]>();
  for (const row of cov.results) {
    const c = coverageSchema.parse({
      municipalityCode: asString(row.municipality_code),
      category: asString(row.category),
      status: asString(row.status),
      lastVerifiedAt: asString(row.last_verified_at),
    });
    const list = coverageByMunicipality.get(c.municipalityCode) ?? [];
    list.push(c);
    coverageByMunicipality.set(c.municipalityCode, list);
  }

  return munis.results.map((row) => {
    const code = asString(row.code);
    return municipalityWithCoverageSchema.parse({
      code,
      name: asString(row.name),
      supported: Number(row.supported) === 1,
      note: optString(row.note),
      officialUrl: optString(row.official_url),
      coverage: coverageByMunicipality.get(code) ?? [],
    });
  });
}

export interface MunicipalityRow {
  code: string;
  name: string;
  supported: boolean;
  officialUrl?: string;
}

export async function getMunicipality(
  db: D1Database,
  code: string,
): Promise<MunicipalityRow | null> {
  const row = await db
    .prepare('SELECT code, name, supported, official_url FROM municipalities WHERE code = ?')
    .bind(code)
    .first<Row>();
  if (!row) return null;
  return {
    code: asString(row.code),
    name: asString(row.name),
    supported: Number(row.supported) === 1,
    officialUrl: optString(row.official_url),
  };
}

/**
 * なぜ: 選択自治体**以外**の自治体名だけを列挙する(名前のみ・全件)。
 * 用途は /api/chat の構造化データ経路の越境ガード限定で、他自治体のデータは一切読まない
 * (返すのは台帳の名称だけ)。原則4「選択自治体と異なる自治体の情報を混ぜない」を守るための
 * 判定材料であり、回答内容には現れない。
 */
export async function getOtherMunicipalityNames(db: D1Database, code: string): Promise<string[]> {
  const res = await db
    .prepare('SELECT name FROM municipalities WHERE code != ?')
    .bind(code)
    .all<Row>();
  return res.results.map((row) => asString(row.name)).filter((n) => n.length > 0);
}

/** ---- rule_sets ---- */

export async function getRuleSet(db: D1Database, code: string): Promise<RuleSet | null> {
  const row = await db
    .prepare(
      'SELECT municipality_code, rule_version, rules FROM rule_sets WHERE municipality_code = ?',
    )
    .bind(code)
    .first<Row>();
  if (!row) return null;
  return ruleSetSchema.parse({
    municipalityCode: asString(row.municipality_code),
    ruleVersion: asString(row.rule_version),
    rules: parseJson(row.rules),
  });
}

/**
 * なぜ: 区をまたぐ期限差分(GET /api/ward-differences)は全対応自治体のルールを必要とする。
 * 自治体スコープ(原則4)は「1区のチェックリストに他区を混ぜない」ための制約であり、
 * 利用者が明示的に選んで見る比較ページのためにここで全区を読むことは、その専用経路に限る。
 * この関数はチェックリスト・手続き詳細・RAGの経路からは呼ばない。
 */
export async function getAllRuleSets(db: D1Database): Promise<RuleSet[]> {
  const res = await db
    .prepare(
      'SELECT municipality_code, rule_version, rules FROM rule_sets ORDER BY municipality_code',
    )
    .all<Row>();
  return res.results.map((row) =>
    ruleSetSchema.parse({
      municipalityCode: asString(row.municipality_code),
      ruleVersion: asString(row.rule_version),
      rules: parseJson(row.rules),
    }),
  );
}

/** ---- procedure_versions ---- */

function rowToProcedureVersion(row: Row): ProcedureVersion {
  return procedureVersionSchema.parse({
    id: asString(row.procedure_id),
    version: asString(row.version),
    municipalityCode: asString(row.municipality_code),
    canonicalType: asString(row.canonical_type),
    title: asString(row.title),
    shortDescription: asString(row.short_description),
    applicabilityReason: asString(row.applicability_reason),
    priority: asString(row.priority),
    dueDate: optString(row.due_date),
    dueDescription: optString(row.due_description),
    requiredDocuments: parseJson(row.required_documents),
    channels: parseJson(row.channels),
    locations: optJson(row.locations),
    onlineUrl: optString(row.online_url),
    contact: optString(row.contact),
    sourceIds: parseJson(row.source_ids),
    lastVerifiedAt: asString(row.last_verified_at),
    dataStatus: asString(row.data_status),
    cautions: optJson(row.cautions),
  });
}

export async function getProcedureVersions(
  db: D1Database,
  code: string,
): Promise<Map<string, ProcedureVersion>> {
  const res = await db
    .prepare('SELECT * FROM procedure_versions WHERE municipality_code = ?')
    .bind(code)
    .all<Row>();
  const map = new Map<string, ProcedureVersion>();
  for (const row of res.results) {
    const pv = rowToProcedureVersion(row);
    map.set(pv.id, pv);
  }
  return map;
}

/**
 * なぜ: 比較ページ用に「特定の手続きIDの現行版を、全自治体ぶん」まとめて読む。
 * procedures.current_version と結合し、旧版が混ざらないようにする(公開中の版だけを比較する)。
 * 用途は GET /api/ward-differences 限定(自治体スコープの通常経路では使わない)。
 */
export async function getProcedureVersionsForIds(
  db: D1Database,
  procedureIds: readonly string[],
): Promise<ProcedureVersion[]> {
  const unique = [...new Set(procedureIds)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  const res = await db
    .prepare(
      'SELECT pv.* FROM procedure_versions pv ' +
        'JOIN procedures p ON p.procedure_id = pv.procedure_id ' +
        'AND p.municipality_code = pv.municipality_code AND p.current_version = pv.version ' +
        `WHERE pv.procedure_id IN (${placeholders}) ` +
        'ORDER BY pv.municipality_code, pv.procedure_id',
    )
    .bind(...unique)
    .all<Row>();
  return res.results.map(rowToProcedureVersion);
}

export async function getProcedureVersion(
  db: D1Database,
  code: string,
  procedureId: string,
): Promise<ProcedureVersion | null> {
  const row = await db
    .prepare('SELECT * FROM procedure_versions WHERE municipality_code = ? AND procedure_id = ?')
    .bind(code, procedureId)
    .first<Row>();
  return row ? rowToProcedureVersion(row) : null;
}

/** ---- sources ---- */

function rowToSource(row: Row): Source {
  return sourceSchema.parse({
    sourceId: asString(row.source_id),
    sourceTitle: asString(row.source_title),
    ownerOrganization: asString(row.owner_organization),
    municipalityCode: optString(row.municipality_code),
    category: asString(row.category),
    sourceUrl: asString(row.source_url),
    sourceType: asString(row.source_type),
    license: asString(row.license),
    attributionText: asString(row.attribution_text),
    fetchMethod: asString(row.fetch_method),
    updateFrequency: asString(row.update_frequency),
    lastFetchedAt: optString(row.last_fetched_at),
    lastVerifiedAt: optString(row.last_verified_at),
    sourceLastModifiedAt: optString(row.source_last_modified_at),
    contentHash: optString(row.content_hash),
    snapshotPageUpdatedOn: optString(row.snapshot_page_updated_on),
    reviewStatus: asString(row.review_status),
    reviewer: optString(row.reviewer),
    effectiveFrom: optString(row.effective_from),
    effectiveTo: optString(row.effective_to),
    notes: optString(row.notes),
  });
}

/**
 * なぜ: GET /api/sources(Wave3)のデータソース台帳の公開ビュー。承認済み(review_status=
 * 'approved')の行のみを返す。seed は承認済みソースしか挿入しないが(publish/load.ts)、
 * 公開エンドポイントとして SQL 側でも review_status を明示フィルタし二重に担保する
 * (原則2・原則9: 未承認/未整備を公開しない)。municipality_code, source_id 昇順で安定化。
 * 返す形状は rowToSource(全列)のままとし、境界(index.ts)で公開ビュー列に射影する。
 */
export async function getApprovedSources(db: D1Database): Promise<Source[]> {
  const res = await db
    .prepare(
      "SELECT * FROM sources WHERE review_status = 'approved' " +
        'ORDER BY municipality_code, source_id',
    )
    .all<Row>();
  return res.results.map(rowToSource);
}

/**
 * なぜ: GET /api/stats(トップの実測サマリー)。台帳全文(332件)を返さずに集計値だけを
 * 取るための専用クエリ。承認済み(review_status='approved')に限るのは /api/sources と同じ基準
 * (未承認データを対外的な件数に数えない)。最終確認日は datetime 文字列の先頭10桁を日付として
 * 使う(台帳の lastVerifiedAt は ISO datetime)。
 */
export async function getServiceStats(db: D1Database): Promise<{
  supportedMunicipalities: number;
  totalMunicipalities: number;
  approvedSources: number;
  lastVerifiedDate?: string;
  driftFlaggedSources: number;
  driftLastCheckedAt?: string;
}> {
  const [muni, src, drift] = await Promise.all([
    db
      .prepare(
        'SELECT COUNT(*) AS total, SUM(CASE WHEN supported = 1 THEN 1 ELSE 0 END) AS supported ' +
          'FROM municipalities',
      )
      .first<Row>(),
    db
      .prepare(
        'SELECT COUNT(*) AS total, MAX(last_verified_at) AS latest FROM sources ' +
          "WHERE review_status = 'approved'",
      )
      .first<Row>(),
    getDriftSummary(db),
  ]);

  const latest = optString(src?.latest)?.slice(0, 10);
  return {
    supportedMunicipalities: Number(muni?.supported ?? 0),
    totalMunicipalities: Number(muni?.total ?? 0),
    approvedSources: Number(src?.total ?? 0),
    ...(latest && /^\d{4}-\d{2}-\d{2}$/.test(latest) ? { lastVerifiedDate: latest } : {}),
    driftFlaggedSources: drift.flaggedSources,
    ...(drift.lastCheckedAt ? { driftLastCheckedAt: drift.lastCheckedAt } : {}),
  };
}

export async function getSourcesByIds(db: D1Database, ids: string[]): Promise<Map<string, Source>> {
  const map = new Map<string, Source>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => '?').join(',');
  const res = await db
    .prepare(`SELECT * FROM sources WHERE source_id IN (${placeholders})`)
    .bind(...unique)
    .all<Row>();
  for (const row of res.results) {
    const s = rowToSource(row);
    map.set(s.sourceId, s);
  }
  return map;
}

/** ---- source_drift(ADR-014 定期巡回) ---- */

/**
 * 検知が**効力を持つ**条件(SQL 断片)。
 * 検知時に控えた verified_at_seen より sources.last_verified_at が新しくなっていれば、
 * 人が再監査して再publish した後なので効力を失う(復帰は人手のみ・機械は行を消さない)。
 * どちらかが NULL のときは比較できないため、安全側(効力あり)に倒す。
 */
const ACTIVE_DRIFT_CONDITION =
  "d.status IN ('changed', 'unreachable') AND " +
  '(s.last_verified_at IS NULL OR d.verified_at_seen IS NULL OR s.last_verified_at <= d.verified_at_seen)';

export interface DriftMark {
  status: 'changed' | 'unreachable';
  /** 検知日(日本時間の YYYY-MM-DD)。根拠カードに出す。 */
  detectedOn: string;
}

/**
 * source_drift.detected_at(UTC の ISO 時刻。drift.ts が記録)→ 利用者に見せる検知日。
 *
 * なぜ slice(0, 10) ではないか: それは UTC の日付で、日本時間の 0:00〜8:59 に検知したものが
 * 前日の日付で根拠カードに出る(毎時巡回のうち9回ぶん)。利用者の暦(Asia/Tokyo)で表示する。
 * 記録は UTC のまま残す(時刻の比較・並べ替えはUTCのほうが扱いやすい)。
 */
export function detectedOnTokyo(detectedAt: string | undefined): string | null {
  if (!detectedAt) return null;
  const at = new Date(detectedAt);
  if (Number.isNaN(at.getTime())) return null;
  return tokyoDate(at);
}

/**
 * チャットの全体1日上限(migrations/0006_chat_usage.sql)の計数を1つ進め、加算後の件数を返す。
 * 1文の UPSERT … RETURNING なので、同時要求でも取りこぼし・二重計上がない(D1 は文単位で直列)。
 * 失敗は呼び出し側へ投げる(呼び出し側がチャットだけを閉じる側に倒す)。
 */
export async function incrementChatUsage(db: D1Database, day: string): Promise<number> {
  const row = await db
    .prepare(
      'INSERT INTO chat_usage (day, count) VALUES (?, 1) ' +
        'ON CONFLICT(day) DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(day)
    .first<Row>();
  const count = Number(row?.count);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('chat_usage returned no count');
  }
  return count;
}

/**
 * なぜ: チェックリスト・手続き詳細・比較ページの読み出し時に、根拠ソースが巡回で
 * changed/unreachable になっていれば dataStatus を stale(再確認中)へ落とす(ADR-014 §2)。
 * 公開データ(procedure_versions)は書き換えず、読み出し側で重ねる。
 * 返すのは効力のあるマークのみ(ACTIVE_DRIFT_CONDITION)。
 */
export async function getActiveDriftMarks(
  db: D1Database,
  sourceIds: string[],
): Promise<Map<string, DriftMark>> {
  const map = new Map<string, DriftMark>();
  const unique = [...new Set(sourceIds)];
  if (unique.length === 0) return map;
  // なぜ分割するか: D1(SQLite)は1文あたりのバインド変数が100件まで。比較ページは全区の根拠を
  // まとめて引くため上限を超える(実測で 500 になった)。100件未満ずつ IN 句を分けて集める。
  const CHUNK = 90;
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const res = await db
      .prepare(
        'SELECT d.source_id, d.status, d.detected_at FROM source_drift d ' +
          'JOIN sources s ON s.source_id = d.source_id ' +
          `WHERE d.source_id IN (${placeholders}) AND ${ACTIVE_DRIFT_CONDITION}`,
      )
      .bind(...chunk)
      .all<Row>();
    rows.push(...res.results);
  }
  for (const row of rows) {
    const status = asString(row.status);
    if (status !== 'changed' && status !== 'unreachable') continue;
    // 検知日が無い(遷移記録の欠落)行・読めない行はカードに日付を出せないため、検知日を巡回日の
    // 代わりに推測しない=マークとして扱わない。detected_at は遷移時に必ず入るので通常は起きない。
    const detectedOn = detectedOnTokyo(optString(row.detected_at));
    if (!detectedOn) continue;
    map.set(asString(row.source_id), { status, detectedOn });
  }
  return map;
}

/**
 * なぜ: /api/health の自己判定(A-1-4)で「公開データが空になっていないか」を見るための件数。
 * publish は DELETE→INSERT なので、途中で失敗すると手続きが0件のまま Worker は200を返し続ける。
 */
export async function countPublishedProcedures(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM procedures').first<Row>();
  return Number(row?.n ?? 0);
}

export interface DriftSummary {
  /** 効力のある changed/unreachable の件数(= 再確認中にしているソース数)。 */
  flaggedSources: number;
  /** 更新日表記もヘッダも無く到達性しか見られないソース数(隠さず数に出す=原則9)。 */
  unverifiableSources: number;
  /** これまでに一度でも巡回したソース数。 */
  checkedSources: number;
  /** 最終巡回時刻(ISO datetime)。未巡回なら null。 */
  lastCheckedAt: string | null;
}

/**
 * なぜ: /api/health と /api/stats に巡回の要約を載せ、外形監視と対応状況ページが同じ数を見る
 * (ADR-014 §3: 通知は外部サービスに頼らず health の値を見張る)。
 */
export async function getDriftSummary(db: D1Database): Promise<DriftSummary> {
  const [flagged, agg] = await Promise.all([
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM source_drift d JOIN sources s ON s.source_id = d.source_id ' +
          `WHERE ${ACTIVE_DRIFT_CONDITION}`,
      )
      .first<Row>(),
    db
      .prepare(
        'SELECT COUNT(*) AS checked, ' +
          "SUM(CASE WHEN status = 'unverifiable' THEN 1 ELSE 0 END) AS unverifiable, " +
          'MAX(last_checked_at) AS latest FROM source_drift',
      )
      .first<Row>(),
  ]);
  return {
    flaggedSources: Number(flagged?.n ?? 0),
    unverifiableSources: Number(agg?.unverifiable ?? 0),
    checkedSources: Number(agg?.checked ?? 0),
    lastCheckedAt: optString(agg?.latest) ?? null,
  };
}

/** ---- facilities ---- */

export async function getFacilities(
  db: D1Database,
  code: string,
  category?: string,
): Promise<Facility[]> {
  const res = category
    ? await db
        .prepare(
          'SELECT * FROM facilities WHERE municipality_code = ? AND category = ? ORDER BY facility_id',
        )
        .bind(code, category)
        .all<Row>()
    : await db
        .prepare('SELECT * FROM facilities WHERE municipality_code = ? ORDER BY facility_id')
        .bind(code)
        .all<Row>();
  return res.results.map((row) =>
    facilitySchema.parse({
      facilityId: asString(row.facility_id),
      municipalityCode: asString(row.municipality_code),
      name: asString(row.name),
      category: asString(row.category),
      address: asString(row.address),
      lat: optNumber(row.lat) ?? null,
      lng: optNumber(row.lng) ?? null,
      hours: optString(row.hours),
      sourceId: asString(row.source_id),
    }),
  );
}

/** ---- waste ---- */

export interface WasteDatasetRow {
  municipalityCode: string;
  sourceId: string;
  caution: string;
  granularityNote?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export async function getWasteDataset(
  db: D1Database,
  code: string,
): Promise<WasteDatasetRow | null> {
  const row = await db
    .prepare(
      'SELECT municipality_code, source_id, caution, granularity_note, effective_from, effective_to FROM waste_datasets WHERE municipality_code = ?',
    )
    .bind(code)
    .first<Row>();
  if (!row) return null;
  return {
    municipalityCode: asString(row.municipality_code),
    sourceId: asString(row.source_id),
    caution: asString(row.caution),
    granularityNote: optString(row.granularity_note),
    effectiveFrom: optString(row.effective_from),
    effectiveTo: optString(row.effective_to),
  };
}

export async function getWasteAreas(db: D1Database, code: string): Promise<WasteArea[]> {
  const res = await db
    .prepare(
      'SELECT area_id, municipality_code, area_label FROM waste_areas WHERE municipality_code = ? ORDER BY area_id',
    )
    .bind(code)
    .all<Row>();
  return res.results.map((row) =>
    wasteAreaSchema.parse({
      areaId: asString(row.area_id),
      municipalityCode: asString(row.municipality_code),
      areaLabel: asString(row.area_label),
    }),
  );
}

export async function getWasteSchedules(
  db: D1Database,
  code: string,
  areaId: string,
): Promise<WasteSchedule[]> {
  const res = await db
    .prepare(
      'SELECT area_id, waste_type, weekday, week_of_month, source_id, effective_from, effective_to FROM waste_schedules WHERE municipality_code = ? AND area_id = ? ORDER BY id',
    )
    .bind(code, areaId)
    .all<Row>();
  return res.results.map((row) =>
    wasteScheduleSchema.parse({
      areaId: asString(row.area_id),
      wasteType: asString(row.waste_type),
      weekday: asString(row.weekday),
      weekOfMonth: optJson(row.week_of_month),
      sourceId: asString(row.source_id),
      effectiveFrom: asString(row.effective_from),
      effectiveTo: optString(row.effective_to),
    }),
  );
}

/** ---- waste_sorting_items(Wave1-B) ---- */

function rowToWasteSortingItem(row: Row): WasteSortingItem {
  return wasteSortingItemSchema.parse({
    itemId: asString(row.item_id),
    municipalityCode: asString(row.municipality_code),
    name: asString(row.name),
    reading: optString(row.reading),
    category: asString(row.category),
    notes: optString(row.notes),
    feeNote: optString(row.fee_note),
    sourceId: asString(row.source_id),
  });
}

/**
 * なぜ: /api/waste-sorting の 404(未整備)判定用。municipality_code に1件でも
 * 行があれば「この自治体はごみ分別データを持つ」とみなす(waste_datasets のような
 * 専用メタテーブルは設けず、行の有無自体を可用性の真実源とする)。
 */
export async function hasWasteSortingData(db: D1Database, code: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM waste_sorting_items WHERE municipality_code = ? LIMIT 1')
    .bind(code)
    .first<Row>();
  return row !== null;
}

/** q未指定時: カテゴリ別件数サマリー(分別区分ごとの件数を降順ではなくcategory名昇順で返す)。 */
export async function getWasteSortingCategorySummary(
  db: D1Database,
  code: string,
): Promise<WasteSortingCategorySummary[]> {
  const res = await db
    .prepare(
      'SELECT category, COUNT(*) AS count FROM waste_sorting_items WHERE municipality_code = ? ' +
        'GROUP BY category ORDER BY category',
    )
    .bind(code)
    .all<Row>();
  return res.results.map((row) =>
    wasteSortingCategorySummarySchema.parse({
      category: asString(row.category),
      count: Number(row.count),
    }),
  );
}

/**
 * なぜ: 品目名の表記ゆれを吸収する正規化(D1/SQLiteにICU正規化がないため、名称/よみを
 * アプリ側で正規化してから部分一致する)。検索語と品目名の両方に同じ関数を通すので、
 * 目的は「どの表記で入力しても同じ鍵になる」ことだけであり、弁別に効く文字は落とさない。
 *
 * 各段階の理由:
 *  1. NFKC — 全角英数(ＤＶＤ)・半角カナ(ｶｻ / ﾍﾟｯﾄﾎﾞﾄﾙ)・全角スペースをまとめて標準形へ畳む。
 *     自前の文字コード加減算より取りこぼしが少ない(半角濁点の合成もNFKCが処理する)。
 *  2. カタカナ→ひらがな — 日本語話者は同じ品目を「カサ」とも「かさ」とも打つ。どちらかへ
 *     寄せないと片方の表記が必ず0件になる(実測: 世田谷区で「ぺっとぼとる」が0件だった)。
 *     ひらがな側へ寄せるのは、よみ(reading)列がひらがなで登録されており、そちらに揃うため。
 *  3. 長音符と空白の除去 — 「ペット ボトル」「スプレーかん」のような区切り・長音のゆれを
 *     吸収する。長音符は品目名の弁別に寄与しないため、落としても別品目とは衝突しない。
 *
 * 漢字↔かな(傘↔かさ)はこの正規化では埋まらない。よみ(reading)列を持つ自治体でのみ一致する
 * (未整備の自治体はデータ側の課題であり、ここで推測して補うことはしない)。
 */
export function normalizeForWasteSortingSearch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\u30fc\s]/g, '')
    .toLowerCase();
}

export interface WasteSortingSearchResult {
  items: WasteSortingItem[];
  total: number;
}

/**
 * 一致の近さ(小さいほど近い)。完全一致 → 前方一致 → 部分一致 の順に並べるためだけに使う。
 *
 * なぜ必要か: 正規化は長音符を落とすため(normalizeForWasteSortingSearch の段階3)、
 * 「ノート」は needle 「のと」になり「ペットのトイレ砂」にも部分一致する。一致集合を狭めると
 * 「すぷれ缶」→「スプレー缶」のような意図した表記ゆれ吸収まで壊れるので、集合はそのままに
 * 並び順だけを正す。探している品目が先頭に来れば、後続の部分一致は「他の候補」として読める。
 */
function matchRank(normalizedField: string, needle: string): number {
  if (normalizedField === needle) return 0;
  if (normalizedField.startsWith(needle)) return 1;
  return 2;
}

/**
 * name/reading への部分一致検索(大小文字・全半角を素朴に正規化)。最大 limit 件を返しつつ、
 * 絞り込み後の総件数(total)も返す。1自治体あたり最大千件強(実データ)のため、
 * D1側では自治体スコープのみ絞り込み、一致判定はアプリ側で行う(原則4はSQLで強制)。
 *
 * 並び順は「一致の近さ → item_id」。item_id を最後の鍵に残すのは、同順位の並びを
 * 決定論的に保つため(同じ検索語なら常に同じ順序で返る)。
 */
export async function searchWasteSortingItems(
  db: D1Database,
  code: string,
  query: string,
  limit = 30,
): Promise<WasteSortingSearchResult> {
  const needle = normalizeForWasteSortingSearch(query);
  // なぜ空判定が要るか: 正規化は長音符・空白を落とすため、長音符だけ・全角スペースだけの
  // 入力は非空のまま needle が空文字になる。空文字は String#includes が常に true を返すので、
  // そのまま部分一致に渡すと全品目が「一致」として返り、UIは「1125件見つかりました」と
  // 一致していない件数を提示してしまう(CLAUDE.md原則3「根拠がない場合は推測しない」に反する)。
  // 検索語として意味を成さない入力は、0件と正直に返す。
  if (needle.length === 0) {
    return { items: [], total: 0 };
  }

  const res = await db
    .prepare('SELECT * FROM waste_sorting_items WHERE municipality_code = ? ORDER BY item_id')
    .bind(code)
    .all<Row>();
  const matched: { item: WasteSortingItem; rank: number }[] = [];
  for (const row of res.results) {
    const item = rowToWasteSortingItem(row);
    const name = normalizeForWasteSortingSearch(item.name);
    const reading = item.reading ? normalizeForWasteSortingSearch(item.reading) : '';
    const hitsName = name.includes(needle);
    const hitsReading = reading.length > 0 && reading.includes(needle);
    if (!hitsName && !hitsReading) continue;
    const rank = Math.min(
      hitsName ? matchRank(name, needle) : Number.MAX_SAFE_INTEGER,
      hitsReading ? matchRank(reading, needle) : Number.MAX_SAFE_INTEGER,
    );
    matched.push({ item, rank });
  }
  // Array#sort は安定なので、同順位は SQL の ORDER BY item_id の順序がそのまま残る。
  matched.sort((a, b) => a.rank - b.rank);
  return { items: matched.slice(0, limit).map((m) => m.item), total: matched.length };
}
