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

export interface Bindings {
  DB: D1Database;
  // RAG(T-013)。RAG_ENABLED!=='true' の間は /api/chat が 503 を返すため、以下は未設定でも動く。
  VECTORIZE?: VectorizeQueryable;
  RAG_ENABLED?: string;
  /** wrangler secret。値はログ・レスポンスに出さない。 */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  RAG_MIN_SCORE?: string;
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
 * なぜ: 全角/半角・大小文字の表記ゆれを吸収した「素朴な」正規化(D1/SQLiteにICU正規化が
 * ないため、名称/よみをアプリ側で正規化して部分一致する)。全角英数字→半角化+小文字化の
 * みを行う(全角カナ→半角カナ等の変換までは扱わない。「素朴に正規化」の範囲)。
 */
export function normalizeForWasteSortingSearch(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase();
}

export interface WasteSortingSearchResult {
  items: WasteSortingItem[];
  total: number;
}

/**
 * name/reading への部分一致検索(大小文字・全半角を素朴に正規化)。最大 limit 件を返しつつ、
 * 絞り込み後の総件数(total)も返す。1自治体あたり最大千件強(実データ)のため、
 * D1側では自治体スコープのみ絞り込み、一致判定はアプリ側で行う(原則4はSQLで強制)。
 */
export async function searchWasteSortingItems(
  db: D1Database,
  code: string,
  query: string,
  limit = 30,
): Promise<WasteSortingSearchResult> {
  const res = await db
    .prepare('SELECT * FROM waste_sorting_items WHERE municipality_code = ? ORDER BY item_id')
    .bind(code)
    .all<Row>();
  const needle = normalizeForWasteSortingSearch(query);
  const matched = res.results.map(rowToWasteSortingItem).filter((item) => {
    const name = normalizeForWasteSortingSearch(item.name);
    const reading = item.reading ? normalizeForWasteSortingSearch(item.reading) : '';
    return name.includes(needle) || (reading.length > 0 && reading.includes(needle));
  });
  return { items: matched.slice(0, limit), total: matched.length };
}
