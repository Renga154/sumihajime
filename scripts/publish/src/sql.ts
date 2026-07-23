import type { PublishData } from './load.js';

/**
 * なぜ: 承認済み PublishData を D1 シードSQL(完全な文1つ=配列1要素)に変換する。
 * CLIはこれをファイルに連結して `wrangler d1 execute --local --file` に渡し、
 * pool-workers統合テストは同じ文配列を env.DB.batch で流す(CLIとテストで同一SQLを実行)。
 * スキーマ(テーブル)の作成は migrations 側の責務。ここは冪等な DELETE→INSERT のみ。
 */

function str(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function nstr(v: string | undefined | null): string {
  return v === undefined || v === null ? 'NULL' : str(v);
}

function num(v: number | undefined | null): string {
  return v === undefined || v === null ? 'NULL' : String(v);
}

function json(v: unknown): string {
  return str(JSON.stringify(v));
}

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
        `content_hash, review_status, reviewer, effective_from, effective_to, notes) VALUES (` +
        `${str(s.sourceId)}, ${str(s.sourceTitle)}, ${str(s.ownerOrganization)}, ` +
        `${nstr(s.municipalityCode)}, ${str(s.category)}, ${str(s.sourceUrl)}, ${str(s.sourceType)}, ` +
        `${str(s.license)}, ${str(s.attributionText)}, ${str(s.fetchMethod)}, ${str(s.updateFrequency)}, ` +
        `${nstr(s.lastFetchedAt)}, ${nstr(s.lastVerifiedAt)}, ${nstr(s.sourceLastModifiedAt)}, ` +
        `${nstr(s.contentHash)}, ${str(s.reviewStatus)}, ${nstr(s.reviewer)}, ${nstr(s.effectiveFrom)}, ` +
        `${nstr(s.effectiveTo)}, ${nstr(s.notes)})`,
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
