import type { PublishData } from './load.js';

/**
 * なぜ: 承認済み PublishData を D1 シードSQL(完全な文1つ=配列1要素)に変換する。
 * CLIはこれをファイルに連結して `wrangler d1 execute --local --file` に渡し、
 * pool-workers統合テストは同じ文配列を env.DB.batch で流す(CLIとテストで同一SQLを実行)。
 * スキーマ(テーブル)の作成は migrations 側の責務。ここは冪等な DELETE→INSERT のみ。
 */

/**
 * なぜ: D1 の `--file` 実行はバインド変数を使えないので、値は文字列リテラルとして埋め込む。
 * SQLite の文字列リテラルは `'` を `''` にするだけでよく、`\` は特別扱いしない(MySQL と違う)。
 * そのうえで、SQL ファイルを壊したり読み手を欺いたりし得る値は黙って埋め込まずに例外にする:
 * - NUL を含む C0 制御文字と DEL(改行・タブ・CR は説明文の正当な一部なので許す)
 * - 孤立サロゲート(UTF-8 で書き出すと U+FFFD に化けて、別の値として保存される)
 * - NaN / Infinity(String() すると SQL では列名や構文エラーとして解釈される)
 * 現データ(公開シード・RAG チャンク)には該当が無いことを確認済み(2026-10-02)。
 */
export class SqlLiteralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlLiteralError';
  }
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function sqlString(v: string): string {
  if (typeof v !== 'string') throw new SqlLiteralError(`expected a string, got ${typeof v}`);
  const ctrl = FORBIDDEN_CONTROL.exec(v);
  if (ctrl) {
    const code = ctrl[0].charCodeAt(0).toString(16).padStart(4, '0');
    throw new SqlLiteralError(`control character U+${code} in SQL string literal`);
  }
  if (LONE_SURROGATE.test(v)) {
    throw new SqlLiteralError('lone surrogate in SQL string literal');
  }
  return `'${v.replace(/'/g, "''")}'`;
}

export function sqlNullableString(v: string | undefined | null): string {
  return v === undefined || v === null ? 'NULL' : sqlString(v);
}

export function sqlNumber(v: number | undefined | null): string {
  if (v === undefined || v === null) return 'NULL';
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SqlLiteralError(`non-finite number in SQL: ${String(v)}`);
  }
  return String(v);
}

/** JSON.stringify は制御文字を \uXXXX に直すので、JSON 列は制御文字の検査に掛からない。 */
export function sqlJson(v: unknown): string {
  return sqlString(JSON.stringify(v));
}

const str = sqlString;
const nstr = sqlNullableString;
const num = sqlNumber;
const json = sqlJson;

/** 公開対象テーブル(DELETE順=INSERT順)。冪等な再publishのため先に全消去。 */
const TABLES = [
  'waste_sorting_items',
  'waste_datasets',
  'waste_schedules',
  'waste_areas',
  'facilities',
  'rule_sets',
  'procedure_versions',
  'procedures',
  'sources',
  'coverage',
  'municipalities',
] as const;

export function buildSeedStatements(data: PublishData): string[] {
  const out: string[] = [];

  for (const t of TABLES) {
    out.push(`DELETE FROM ${t}`);
  }

  for (const m of data.municipalities) {
    out.push(
      `INSERT INTO municipalities (code, name, supported, note, official_url) VALUES (` +
        `${str(m.code)}, ${str(m.name)}, ${m.supported ? 1 : 0}, ${nstr(m.note)}, ${nstr(m.officialUrl)})`,
    );
  }

  for (const c of data.coverage) {
    out.push(
      `INSERT INTO coverage (municipality_code, category, status, last_verified_at) VALUES (` +
        `${str(c.municipalityCode)}, ${str(c.category)}, ${str(c.status)}, ${str(c.lastVerifiedAt)})`,
    );
  }

  for (const s of data.approvedSources) {
    out.push(
      `INSERT INTO sources (source_id, source_title, owner_organization, municipality_code, ` +
        `category, source_url, source_type, license, attribution_text, fetch_method, ` +
        `update_frequency, last_fetched_at, last_verified_at, source_last_modified_at, ` +
        `content_hash, review_status, reviewer, effective_from, effective_to, notes, ` +
        `snapshot_page_updated_on) VALUES (` +
        `${str(s.sourceId)}, ${str(s.sourceTitle)}, ${str(s.ownerOrganization)}, ` +
        `${nstr(s.municipalityCode)}, ${str(s.category)}, ${str(s.sourceUrl)}, ${str(s.sourceType)}, ` +
        `${str(s.license)}, ${str(s.attributionText)}, ${str(s.fetchMethod)}, ${str(s.updateFrequency)}, ` +
        `${nstr(s.lastFetchedAt)}, ${nstr(s.lastVerifiedAt)}, ${nstr(s.sourceLastModifiedAt)}, ` +
        `${nstr(s.contentHash)}, ${str(s.reviewStatus)}, ${nstr(s.reviewer)}, ${nstr(s.effectiveFrom)}, ` +
        `${nstr(s.effectiveTo)}, ${nstr(s.notes)}, ${nstr(s.snapshotPageUpdatedOn)})`,
    );
  }

  for (const p of data.procedures) {
    out.push(
      `INSERT INTO procedures (procedure_id, municipality_code, canonical_type, current_version) VALUES (` +
        `${str(p.id)}, ${str(p.municipalityCode)}, ${str(p.canonicalType)}, ${str(p.version)})`,
    );
    out.push(
      `INSERT INTO procedure_versions (procedure_id, version, municipality_code, canonical_type, ` +
        `title, short_description, applicability_reason, priority, due_date, due_description, ` +
        `required_documents, channels, locations, online_url, contact, source_ids, ` +
        `last_verified_at, data_status, cautions) VALUES (` +
        `${str(p.id)}, ${str(p.version)}, ${str(p.municipalityCode)}, ${str(p.canonicalType)}, ` +
        `${str(p.title)}, ${str(p.shortDescription)}, ${str(p.applicabilityReason)}, ${str(p.priority)}, ` +
        `${nstr(p.dueDate)}, ${nstr(p.dueDescription)}, ${json(p.requiredDocuments)}, ${json(p.channels)}, ` +
        `${p.locations ? json(p.locations) : 'NULL'}, ${nstr(p.onlineUrl)}, ${nstr(p.contact)}, ` +
        `${json(p.sourceIds)}, ${str(p.lastVerifiedAt)}, ${str(p.dataStatus)}, ` +
        `${p.cautions ? json(p.cautions) : 'NULL'})`,
    );
  }

  for (const rs of data.ruleSets) {
    out.push(
      `INSERT INTO rule_sets (municipality_code, rule_version, rules) VALUES (` +
        `${str(rs.municipalityCode)}, ${str(rs.ruleVersion)}, ${json(rs.rules)})`,
    );
  }

  for (const f of data.facilities) {
    out.push(
      `INSERT INTO facilities (facility_id, municipality_code, name, category, address, lat, lng, hours, source_id) VALUES (` +
        `${str(f.facilityId)}, ${str(f.municipalityCode)}, ${str(f.name)}, ${str(f.category)}, ` +
        `${str(f.address)}, ${num(f.lat)}, ${num(f.lng)}, ${nstr(f.hours)}, ${str(f.sourceId)})`,
    );
  }

  for (const a of data.wasteAreas) {
    out.push(
      `INSERT INTO waste_areas (area_id, municipality_code, area_label) VALUES (` +
        `${str(a.areaId)}, ${str(a.municipalityCode)}, ${str(a.areaLabel)})`,
    );
  }

  // area_id → municipalityCode(スケジュールはschemaにmunicipalityCodeを持たないため補完)。
  const areaMunicipality = new Map(data.wasteAreas.map((a) => [a.areaId, a.municipalityCode]));
  for (const s of data.wasteSchedules) {
    const municipalityCode = areaMunicipality.get(s.areaId);
    if (municipalityCode === undefined) {
      throw new Error(`waste schedule references unknown area_id "${s.areaId}"`);
    }
    out.push(
      `INSERT INTO waste_schedules (area_id, municipality_code, waste_type, weekday, week_of_month, ` +
        `source_id, effective_from, effective_to) VALUES (` +
        `${str(s.areaId)}, ${str(municipalityCode)}, ${str(s.wasteType)}, ${str(s.weekday)}, ` +
        `${s.weekOfMonth ? json(s.weekOfMonth) : 'NULL'}, ${str(s.sourceId)}, ` +
        `${str(s.effectiveFrom)}, ${nstr(s.effectiveTo)})`,
    );
  }

  for (const d of data.wasteDatasets) {
    out.push(
      `INSERT INTO waste_datasets (municipality_code, source_id, caution, granularity_note, ` +
        `effective_from, effective_to) VALUES (` +
        `${str(d.municipalityCode)}, ${str(d.sourceId)}, ${str(d.caution)}, ${nstr(d.granularityNote)}, ` +
        `${nstr(d.effectiveFrom)}, ${nstr(d.effectiveTo)})`,
    );
  }

  for (const i of data.wasteSortingItems) {
    out.push(
      `INSERT INTO waste_sorting_items (municipality_code, item_id, name, reading, category, notes, ` +
        `fee_note, source_id) VALUES (` +
        `${str(i.municipalityCode)}, ${str(i.itemId)}, ${str(i.name)}, ${nstr(i.reading)}, ` +
        `${str(i.category)}, ${nstr(i.notes)}, ${nstr(i.feeNote)}, ${str(i.sourceId)})`,
    );
  }

  return out;
}
