import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  Coverage,
  Facility,
  Municipality,
  ProcedureVersion,
  RuleSet,
  Source,
  WasteArea,
  WasteSchedule,
} from '@tmn/schemas';
import {
  coverageSchema,
  facilitySchema,
  procedureVersionSchema,
  ruleSetSchema,
  sourceSchema,
  wasteAreaSchema,
  wasteScheduleSchema,
} from '@tmn/schemas';
import { parseCsvRecords } from './csv.js';
import { MUNICIPALITIES } from './municipalities.js';
import type { SourceRef } from './gate.js';

/** なぜ: ごみデータセットの自治体単位メタ(C-9のcautionを応答に必ず含めるため)。 */
export interface WasteDataset {
  municipalityCode: string;
  sourceId: string;
  caution: string;
  granularityNote?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface PublishData {
  municipalities: Municipality[];
  coverage: Coverage[];
  /** review_status=approved のソースのみ(公開対象)。 */
  approvedSources: Source[];
  /** approved の source_id 集合(ゲート判定用。全台帳から算出)。 */
  approvedSourceIds: Set<string>;
  procedures: ProcedureVersion[];
  ruleSets: RuleSet[];
  facilities: Facility[];
  wasteAreas: WasteArea[];
  wasteSchedules: WasteSchedule[];
  wasteDatasets: WasteDataset[];
  /** 公開物が参照する sourceId(ゲート入力)。 */
  references: SourceRef[];
}

function readText(repoRoot: string, rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf-8');
}

function readJson(repoRoot: string, rel: string): unknown {
  return JSON.parse(readText(repoRoot, rel));
}

/** なぜ: 空欄はundefinedに(optionalフィールドはCSVで空文字になる)。 */
function opt(v: string | undefined): string | undefined {
  return v !== undefined && v.trim().length > 0 ? v : undefined;
}

/**
 * なぜ: 台帳の監査タイムスタンプは日付粒度("2026-07-21")だが sourceSchema は
 * iso.datetime() を要求する。schemaを緩めず、日付を UTC 深夜0時の datetime へ
 * 決定論的に正規化する(publish時変換。data/やregistryは書き換えない)。
 */
function toDateTime(v: string | undefined): string | undefined {
  const s = opt(v);
  if (s === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
}

/** registry.csv → Source[](全件。approvedフィルタは呼び出し側)。 */
export function loadSources(repoRoot: string): Source[] {
  const records = parseCsvRecords(
    readText(repoRoot, 'docs/data-sources/registry.csv'),
    'registry.csv',
  );
  return records.map((r) =>
    sourceSchema.parse({
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      ownerOrganization: r.owner_organization,
      municipalityCode: opt(r.municipality_code),
      category: r.category,
      sourceUrl: r.source_url,
      sourceType: r.source_type,
      license: r.license,
      attributionText: r.attribution_text,
      fetchMethod: r.fetch_method,
      updateFrequency: r.update_frequency,
      lastFetchedAt: toDateTime(r.last_fetched_at),
      lastVerifiedAt: toDateTime(r.last_verified_at),
      sourceLastModifiedAt: toDateTime(r.source_last_modified_at),
      contentHash: opt(r.content_hash),
      reviewStatus: r.review_status,
      reviewer: opt(r.reviewer),
      effectiveFrom: opt(r.effective_from),
      effectiveTo: opt(r.effective_to),
      notes: opt(r.notes),
    }),
  );
}

/** coverage.csv → Coverage[](自治体×カテゴリの縦持ちに展開)。 */
export function loadCoverage(repoRoot: string): Coverage[] {
  const records = parseCsvRecords(
    readText(repoRoot, 'docs/data-sources/coverage.csv'),
    'coverage.csv',
  );
  const CATEGORY_COLUMNS = [
    'resident_registration',
    'my_number',
    'national_health_insurance',
    'national_pension',
    'child_benefits',
    'school_childcare',
    'dog_registration',
    'facilities',
    'waste_schedule',
    'waste_sorting',
    'rag',
  ] as const;
  const rows: Coverage[] = [];
  for (const rec of records) {
    const lastVerifiedAt = toDateTime(rec.last_verified_at) ?? `${rec.last_verified_at}T00:00:00Z`;
    for (const category of CATEGORY_COLUMNS) {
      const status = rec[category];
      if (!status) continue;
      rows.push(
        coverageSchema.parse({
          municipalityCode: rec.municipality_code,
          category,
          status,
          lastVerifiedAt,
        }),
      );
    }
  }
  return rows;
}

/** 世田谷(13112)の正規化手続きJSON → ProcedureVersion[]。 */
export function loadProcedures(repoRoot: string): ProcedureVersion[] {
  const raw = readJson(repoRoot, 'data/normalized/13112/procedures.json') as {
    procedures: unknown[];
  };
  return raw.procedures.map((p) => procedureVersionSchema.parse(p));
}

/** ルールJSON → RuleSet[]。 */
export function loadRuleSets(repoRoot: string): RuleSet[] {
  const raw = readJson(repoRoot, 'packages/rules/data/13112/rules.json');
  return [ruleSetSchema.parse(raw)];
}

/**
 * 施設JSON → Facility[]。
 * なぜ: 出典CSVのExcel汚損により facilityId が全行同一の壊れた値("...E+11")に潰れている
 * (data/normalized/13112/facilities.json の dataQualityNotes 参照)。data/ は書き換えない方針の
 * ため、publish時に municipalityCode + 連番で一意な facility_id を決定論的に採番する
 * (D1のPK制約を満たしUIでキー化可能にする。捏造ではなく壊れたIDの機械的置換)。
 */
export function loadFacilities(repoRoot: string): Facility[] {
  const raw = readJson(repoRoot, 'data/normalized/13112/facilities.json') as {
    municipalityCode: string;
    facilities: unknown[];
  };
  return raw.facilities.map((f, i) => {
    const parsed = facilitySchema.parse(f);
    return {
      ...parsed,
      facilityId: `${parsed.municipalityCode}-fac-${String(i + 1).padStart(3, '0')}`,
    };
  });
}

interface WasteJson {
  municipalityCode: string;
  sourceId: string;
  caution: string;
  granularityNote?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  wasteAreas: unknown[];
  wasteSchedules: unknown[];
}

export function loadWaste(repoRoot: string): {
  areas: WasteArea[];
  schedules: WasteSchedule[];
  dataset: WasteDataset;
} {
  const raw = readJson(repoRoot, 'data/normalized/13112/waste.json') as WasteJson;
  return {
    areas: raw.wasteAreas.map((a) => wasteAreaSchema.parse(a)),
    schedules: raw.wasteSchedules.map((s) => wasteScheduleSchema.parse(s)),
    dataset: {
      municipalityCode: raw.municipalityCode,
      sourceId: raw.sourceId,
      caution: raw.caution,
      granularityNote: raw.granularityNote,
      effectiveFrom: raw.effectiveFrom,
      effectiveTo: raw.effectiveTo,
    },
  };
}

/**
 * すべての公開データを読み込み・スキーマ検証し、ゲート入力(references)まで組み立てる。
 * SQL生成やゲート判定はここでは行わない(呼び出し側が assertPublishGate → buildSeedStatements)。
 */
export function loadPublishData(repoRoot: string): PublishData {
  const sources = loadSources(repoRoot);
  const approvedSources = sources.filter((s) => s.reviewStatus === 'approved');
  const approvedSourceIds = new Set(approvedSources.map((s) => s.sourceId));

  const procedures = loadProcedures(repoRoot);
  const ruleSets = loadRuleSets(repoRoot);
  const facilities = loadFacilities(repoRoot);
  const waste = loadWaste(repoRoot);
  const coverage = loadCoverage(repoRoot);

  const references: SourceRef[] = [];
  for (const p of procedures) {
    references.push({ owner: `procedure_version ${p.id}@${p.version}`, sourceIds: p.sourceIds });
  }
  for (const rs of ruleSets) {
    for (const rule of rs.rules) {
      references.push({
        owner: `rule ${rs.municipalityCode}/${rule.procedureId}`,
        sourceIds: rule.sourceIds,
      });
    }
  }
  // 施設・ごみも公開物なので参照ソースをゲート対象に含める(distinctで冗長を避ける)。
  const facilitySourceIds = [...new Set(facilities.map((f) => f.sourceId))];
  references.push({ owner: 'facilities (13112)', sourceIds: facilitySourceIds });
  references.push({ owner: 'waste dataset (13112)', sourceIds: [waste.dataset.sourceId] });

  return {
    municipalities: MUNICIPALITIES,
    coverage,
    approvedSources,
    approvedSourceIds,
    procedures,
    ruleSets,
    facilities,
    wasteAreas: waste.areas,
    wasteSchedules: waste.schedules,
    wasteDatasets: [waste.dataset],
    references,
  };
}
