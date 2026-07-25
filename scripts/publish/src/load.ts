import { existsSync, readFileSync } from 'node:fs';
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
  WasteSortingItem,
} from '@tmn/schemas';
import {
  coverageSchema,
  facilitySchema,
  procedureVersionSchema,
  ruleSetSchema,
  sourceSchema,
  wasteAreaSchema,
  wasteScheduleSchema,
  wasteSortingItemSchema,
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
  /** ごみ分別辞書(Wave1-B)。当該自治体のCSVが存在しない自治体は単に空(不足はエラーにしない)。 */
  wasteSortingItems: WasteSortingItem[];
  /** 公開物が参照する sourceId(ゲート入力)。ADR-007: 公開対象(verified)のみを載せる。 */
  references: SourceRef[];
  /**
   * ADR-007: 公開単位=verified手続きのみ。dataStatus!=='verified'(partial/stale)のため
   * seed(公開)から除外し staging に留めた手続き。publish CLI が除外件数を報告するために保持。
   */
  excludedProcedures: ProcedureVersion[];
  /**
   * ADR-007: 対応する手続きが未公開(非verified)のため seed から間引いたルール参照。
   * rules.json ファイルは不変で、間引きはメモリ上のみ。
   */
  excludedRuleRefs: { municipalityCode: string; procedureId: string }[];
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

/**
 * なぜ: publish は「supportedな全自治体」を対象に走らせ、承認ゲートが未承認ソース参照を
 * 拒否するのが本来の運用(T-015)。一方、CI/統合テストのシード(d1-harness の buildSeed)は
 * 「承認済みで公開可能な自治体集合」だけを載せたい。両者を1関数で満たすため、
 * loadPublishData/buildSeed は対象自治体コードを引数化し、デフォルトは公開可能な世田谷のみ
 * (DEFAULT_PUBLISH_CODES)とする。CLI(publish.ts)は MUNICIPALITIES.supported を渡し、
 * 江東区(pending)を含めることでゲートを実際に発火させる。
 */
export const DEFAULT_PUBLISH_CODES = ['13112'] as const;

/** 正規化手続きJSON → ProcedureVersion[](自治体コード指定)。 */
export function loadProceduresFor(repoRoot: string, code: string): ProcedureVersion[] {
  const raw = readJson(repoRoot, `data/normalized/${code}/procedures.json`) as {
    procedures: unknown[];
  };
  return raw.procedures.map((p) => procedureVersionSchema.parse(p));
}

/** ルールJSON → RuleSet(自治体コード指定)。 */
export function loadRuleSetFor(repoRoot: string, code: string): RuleSet {
  const raw = readJson(repoRoot, `packages/rules/data/${code}/rules.json`);
  return ruleSetSchema.parse(raw);
}

/**
 * 施設JSON → Facility[](自治体コード指定)。
 * なぜ: 出典CSVのExcel汚損により facilityId が壊れる自治体(世田谷)があるため、
 * data/ は書き換えず publish時に municipalityCode + 連番で一意な facility_id を
 * 決定論的に採番する(D1のPK制約を満たしUIでキー化可能にする。捏造ではなく機械的置換)。
 * 既に正規のIDを持つ自治体(江東)でも同じ規則で再採番するため一貫する。
 */
export function loadFacilitiesFor(repoRoot: string, code: string): Facility[] {
  const raw = readJson(repoRoot, `data/normalized/${code}/facilities.json`) as {
    municipalityCode: string;
    facilities: unknown[];
  };
  const parsedAll = raw.facilities.map((f) => facilitySchema.parse(f));
  // なぜ: 出典データに「倉庫」「集会所」を含む非窓口施設(防災資材倉庫・区民集会所等)が
  // 混入しており、手続き窓口一覧には不適切なため除外する。
  // 「マイナンバーカード特設窓口」等、正規の窓口名は「倉庫」「集会所」を含まないため誤除外しない。
  const filtered = parsedAll.filter((f) => !/倉庫|集会所/.test(f.name));
  const excludedCount = parsedAll.length - filtered.length;
  console.log(`[publish] excluded ${excludedCount} non-counter facilities (倉庫/集会所).`);
  return filtered.map((parsed, i) => ({
    ...parsed,
    facilityId: `${parsed.municipalityCode}-fac-${String(i + 1).padStart(3, '0')}`,
  }));
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

export function loadWasteFor(
  repoRoot: string,
  code: string,
): {
  areas: WasteArea[];
  schedules: WasteSchedule[];
  dataset: WasteDataset | null;
} {
  // なぜ: 収集曜日が公式PDFのみで機械判読可能なデータが提供されない自治体(Step4-B 千代田=13101)は
  // waste.json を作らない(推測で曜日を作らない=誠実縮退)。ごみ分別辞書(waste-sorting)が別途
  // 未整備自治体で空配列を返すのと同様に、waste.json 不在は欠落として扱いエラーにしない。dataset=null を
  // 返し、呼び出し側は waste の公開物・ゲート参照を生成しない(=収集曜日カテゴリは非公開・非対応表示)。
  const rel = `data/normalized/${code}/waste.json`;
  if (!existsSync(resolve(repoRoot, rel))) {
    return { areas: [], schedules: [], dataset: null };
  }
  const raw = readJson(repoRoot, rel) as WasteJson;
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

interface WasteSortingJson {
  municipalityCode: string;
  sourceId: string;
  items: unknown[];
}

/**
 * ごみ分別辞書JSON(data/normalized/<code>/waste-sorting.json) → WasteSortingItem[]。
 * なぜ: Wave1-B時点では世田谷/江東/新宿の3区のみ整備済み。他自治体はファイル自体が
 * 存在しないため、存在しない場合は空配列を返す(欠落をエラーにしない。CLAUDE.md原則9
 * 「未対応自治体・カテゴリを対応済みに見せない」は coverage.csv/DBの有無で表現する)。
 */
export function loadWasteSortingFor(repoRoot: string, code: string): WasteSortingItem[] {
  const rel = `data/normalized/${code}/waste-sorting.json`;
  const path = resolve(repoRoot, rel);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as WasteSortingJson;
  return raw.items.map((i) => wasteSortingItemSchema.parse(i));
}

/**
 * すべての公開データを読み込み・スキーマ検証し、ゲート入力(references)まで組み立てる。
 * SQL生成やゲート判定はここでは行わない(呼び出し側が assertPublishGate → buildSeedStatements)。
 *
 * @param municipalityCodes 公開対象の自治体コード。省略時は公開可能な世田谷のみ
 *   (DEFAULT_PUBLISH_CODES)。CLIは MUNICIPALITIES.supported を渡し、江東(pending)を
 *   含めることで承認ゲートを発火させる(T-015)。
 */
export function loadPublishData(
  repoRoot: string,
  municipalityCodes: readonly string[] = DEFAULT_PUBLISH_CODES,
): PublishData {
  const sources = loadSources(repoRoot);
  const approvedSources = sources.filter((s) => s.reviewStatus === 'approved');
  const approvedSourceIds = new Set(approvedSources.map((s) => s.sourceId));

  // なぜ: municipalities.ts の静的 supported は「MVP整備対象」という product意図を表す
  // (T-015で江東=13108をtrueに)。ただし API/DB で実際に supported として公開するのは
  // 「承認済みソースを1件以上持つ自治体」だけとする(municipalities.ts のコメント
  // 『レビュー承認後に有効』の実装)。江東は全ソースが pending/candidate のため、静的に
  // supported=true でも公開ビュー(seed→D1→API)では supported=false になる。これにより
  // 未レビューの自治体が「対応済み」に見えること(CLAUDE.md原則9)を構造的に防ぐ。
  const approvedMunicipalityCodes = new Set(
    approvedSources
      .map((s) => s.municipalityCode)
      .filter((code): code is string => code !== undefined),
  );
  const municipalities = MUNICIPALITIES.map((m) => ({
    ...m,
    supported: m.supported && approvedMunicipalityCodes.has(m.code),
  }));

  const procedures: ProcedureVersion[] = [];
  const ruleSets: RuleSet[] = [];
  const facilities: Facility[] = [];
  const wasteAreas: WasteArea[] = [];
  const wasteSchedules: WasteSchedule[] = [];
  const wasteDatasets: WasteDataset[] = [];
  const wasteSortingItems: WasteSortingItem[] = [];
  const references: SourceRef[] = [];
  const excludedProcedures: ProcedureVersion[] = [];
  const excludedRuleRefs: { municipalityCode: string; procedureId: string }[] = [];

  for (const code of municipalityCodes) {
    const allProcs = loadProceduresFor(repoRoot, code);
    const fullRuleSet = loadRuleSetFor(repoRoot, code);
    const facs = loadFacilitiesFor(repoRoot, code);
    const waste = loadWasteFor(repoRoot, code);
    const sortingItems = loadWasteSortingFor(repoRoot, code);

    // ADR-007: 公開単位 = dataStatus==='verified' の手続きのみ。partial/stale(人手レビュー
    // 未了の staging データ)は seed(公開)から除外し、対応するルールも RuleSet から間引く。
    // rules.json / procedures.json のファイル自体は不変(除外はメモリ上のみ)。これにより
    // 公開済み自治体へ pending 手続きを追加しても既定シードは緑を保ち、かつ未承認データは
    // D1 に載らない(原則2/9)。ゲートは「公開対象(verified)が非approvedソースを参照したら
    // 全停止」の不変条件を維持する(下の references は公開対象のみで構成)。
    const procs = allProcs.filter((p) => p.dataStatus === 'verified');
    const stagedProcs = allProcs.filter((p) => p.dataStatus !== 'verified');
    const publishedIds = new Set(procs.map((p) => p.id));
    const publishedRules = fullRuleSet.rules.filter((r) => publishedIds.has(r.procedureId));
    // ADR-007: 公開される rule_set の版は「公開済み成果物の版」を表す publishedRuleVersion を
    // 優先する(staging を含むファイルでは ruleVersion が前進していても、公開内容=verified部分
    // 集合は不変のため版を進めない=誠実な版付け)。未指定なら ruleVersion をそのまま用いる。
    const ruleSet: RuleSet = {
      ...fullRuleSet,
      ruleVersion: fullRuleSet.publishedRuleVersion ?? fullRuleSet.ruleVersion,
      rules: publishedRules,
    };

    excludedProcedures.push(...stagedProcs);
    for (const rule of fullRuleSet.rules) {
      if (!publishedIds.has(rule.procedureId)) {
        excludedRuleRefs.push({ municipalityCode: code, procedureId: rule.procedureId });
      }
    }

    procedures.push(...procs);
    ruleSets.push(ruleSet);
    facilities.push(...facs);
    wasteAreas.push(...waste.areas);
    wasteSchedules.push(...waste.schedules);
    // waste.dataset は waste.json 不在(誠実縮退の自治体)では null。その場合は公開物に載せない。
    if (waste.dataset) wasteDatasets.push(waste.dataset);
    wasteSortingItems.push(...sortingItems);

    for (const p of procs) {
      references.push({ owner: `procedure_version ${p.id}@${p.version}`, sourceIds: p.sourceIds });
    }
    for (const rule of ruleSet.rules) {
      references.push({
        owner: `rule ${ruleSet.municipalityCode}/${rule.procedureId}`,
        sourceIds: rule.sourceIds,
      });
    }
    // 施設・ごみも公開物なので参照ソースをゲート対象に含める(distinctで冗長を避ける)。
    const facilitySourceIds = [...new Set(facs.map((f) => f.sourceId))];
    references.push({ owner: `facilities (${code})`, sourceIds: facilitySourceIds });
    // waste.json 不在(誠実縮退)の自治体は収集曜日の公開物が無いためゲート参照も生成しない。
    if (waste.dataset) {
      references.push({ owner: `waste dataset (${code})`, sourceIds: [waste.dataset.sourceId] });
    }
    // なぜ: ごみ分別辞書はファイル未整備の自治体もあるため、その場合は参照0件
    // (=ゲート対象なし)で自然にスキップされる。
    const sortingSourceIds = [...new Set(sortingItems.map((i) => i.sourceId))];
    if (sortingSourceIds.length > 0) {
      references.push({ owner: `waste sorting (${code})`, sourceIds: sortingSourceIds });
    }
  }

  return {
    municipalities,
    coverage: loadCoverage(repoRoot),
    approvedSources,
    approvedSourceIds,
    procedures,
    ruleSets,
    facilities,
    wasteAreas,
    wasteSchedules,
    wasteDatasets,
    wasteSortingItems,
    references,
    excludedProcedures,
    excludedRuleRefs,
  };
}
