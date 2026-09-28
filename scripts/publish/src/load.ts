import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
import { extractPageUpdatedOn, pickCurrentSnapshot } from '@tmn/drift';
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
  /**
   * ADR-007 第4項: ソースが未 approved のため seed(公開)から除外した非手続きデータ
   * (施設・ごみデータセット・分別辞書)の (自治体, sourceId)。pending 自治体を supported に
   * 含めても publish が「除外扱い」でゲートを通過することを CLI で明示報告するために保持。
   */
  excludedNonProcedureSources: { municipalityCode: string; sourceId: string }[];
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

/**
 * ADR-014: 承認時スナップショット(data/sources/<code>/snapshots/ の現行版。再監査で版付き
 * `<source_id>.<YYYYMMDD>.html` が増えていればその最新)からページ自身の「更新日」を機械的に
 * 抽出する。定期巡回はこの値を基準に比較する。
 * 人手記入の source_last_modified_at を使わないのは、本文表記と食い違う行(千代田・江戸川)が
 * あり初回から誤検知するため。HTML 以外・スナップショット不在・表記無しは undefined
 * (推測で埋めない)。
 */
function snapshotPageUpdatedOn(
  repoRoot: string,
  municipalityCode: string | undefined,
  sourceId: string,
  sourceType: string,
): string | undefined {
  if (sourceType !== 'html') return undefined;
  const dir = resolve(repoRoot, `data/sources/${municipalityCode ?? ''}/snapshots`);
  if (!existsSync(dir)) return undefined;
  const file = pickCurrentSnapshot(readdirSync(dir), sourceId, 'html');
  if (!file) return undefined;
  return extractPageUpdatedOn(readFileSync(resolve(dir, file), 'utf-8')) ?? undefined;
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
      snapshotPageUpdatedOn: snapshotPageUpdatedOn(
        repoRoot,
        opt(r.municipality_code),
        r.source_id ?? '',
        r.source_type ?? '',
      ),
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
    // ADR-009: 自治体以外(ライフライン等)の手続き。水道・郵便転居・電気ガス・運転免許をまとめた
    // 1カテゴリとして、区の手続きとは別枠で対応状況を開示する(承認までは unavailable)。
    'non_municipal',
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
 * なぜ: publish は「supportedな全自治体」を対象に走らせるのが本来の運用(T-015)。一方、
 * 軽量なCI/統合テストのシード(d1-harness の buildSeed)は「1自治体だけの最小フィクスチャ」で
 * 十分なことが多い。両者を1関数で満たすため、loadPublishData/buildSeed は対象自治体コードを
 * 引数化し、最小フィクスチャ用に世田谷のみの DEFAULT_PUBLISH_CODES を用意する。
 * ただし loadPublishData 自体には既定値を持たせない(下記)。CLI(publish.ts)は
 * MUNICIPALITIES.supported な全コードを明示的に渡す。
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
  // なぜ: 収集曜日データを持たない対応自治体がある。杉並区(13115)は第三者SaaSのJSウィジェット
  // 依存で機械取得不可、千代田区(13101)は公式PDFのみで機械判読可能データが無い。いずれも推測で
  // 曜日を作らず waste.json を作らない=誠実縮退。ごみ分別辞書(waste-sorting)が未整備自治体で空配列を
  // 返すのと同様に、waste.json 不在は欠落として扱いエラーにせず dataset=null を返す。呼び出し側は
  // waste の公開物・ゲート参照を生成せず、WastePage 側の空状態フォールバックへ委ねる。
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
 * @param municipalityCodes 公開対象の自治体コード。呼び出し側に明示させる(引数必須)。
 *   なぜ既定値を持たせないか: 「全自治体を検証したい」呼び出しが引数を省略すると、
 *   最小フィクスチャ(DEFAULT_PUBLISH_CODES=世田谷のみ)へ静かに縮退し、他の自治体の
 *   公開データ不整合を検知できなくなる(scripts/ingest/src/validate.ts が実際にこの
 *   バグを踏んでいた)。CLI(publish.ts)は MUNICIPALITIES.supported な全コードを渡す。
 *   軽量な単体テストは DEFAULT_PUBLISH_CODES を明示的に渡す。
 */
export function loadPublishData(
  repoRoot: string,
  municipalityCodes: readonly string[],
): PublishData {
  const sources = loadSources(repoRoot);
  const approvedSources = sources.filter((s) => s.reviewStatus === 'approved');
  const approvedSourceIds = new Set(approvedSources.map((s) => s.sourceId));

  // なぜ: municipalities.ts の静的 supported は「MVP整備対象」という product意図を表す。
  // ただし API/DB で実際に supported として公開するのは「承認済みソースを1件以上持つ
  // 自治体」だけとする(municipalities.ts のコメント『レビュー承認後に有効』の実装)。
  // 承認前の自治体は静的に supported=true でも公開ビュー(seed→D1→API)では
  // supported=false になる。これにより未レビューの自治体が「対応済み」に見えること
  // (CLAUDE.md原則9)を構造的に防ぐ。
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
  const excludedNonProcedureSources: { municipalityCode: string; sourceId: string }[] = [];

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

    // ADR-007 第4項: 施設・ごみ等の非手続きデータは「ソースが approved である限り公開する」。
    // その対偶として、ソースが未 approved(pending/candidate)なものは公開(seed/参照)しない=staging。
    // これにより、全ソースが pending の新規自治体(例: 杉並区13115)を supported に含めても、
    // publish は「杉並の全項目が除外(staging)扱い」でゲートを通過する(ADR-007の新挙動)。既存の
    // 承認済み自治体(世田谷/江東/新宿)は全ソースが approved のため出力は不変(後方互換)。
    const publishedFacs = facs.filter((f) => approvedSourceIds.has(f.sourceId));
    const wasteApproved = waste.dataset !== null && approvedSourceIds.has(waste.dataset.sourceId);
    const publishedSorting = sortingItems.filter((i) => approvedSourceIds.has(i.sourceId));
    for (const sid of new Set(
      [
        ...facs.map((f) => f.sourceId),
        ...(waste.dataset ? [waste.dataset.sourceId] : []),
        ...sortingItems.map((i) => i.sourceId),
      ].filter((sid) => !approvedSourceIds.has(sid)),
    )) {
      excludedNonProcedureSources.push({ municipalityCode: code, sourceId: sid });
    }

    procedures.push(...procs);
    // なぜ: 公開ルールが0件(全手続き pending 等)の自治体は rule_set を seed しない
    // (空の rule_set 行を作らず「承認まで自治体は空=D1に載らない」を素直に表現する)。
    if (publishedRules.length > 0) {
      ruleSets.push(ruleSet);
    }
    facilities.push(...publishedFacs);
    if (wasteApproved && waste.dataset) {
      wasteAreas.push(...waste.areas);
      wasteSchedules.push(...waste.schedules);
      wasteDatasets.push(waste.dataset);
    }
    wasteSortingItems.push(...publishedSorting);

    for (const p of procs) {
      references.push({ owner: `procedure_version ${p.id}@${p.version}`, sourceIds: p.sourceIds });
    }
    for (const rule of publishedRules) {
      references.push({
        owner: `rule ${ruleSet.municipalityCode}/${rule.procedureId}`,
        sourceIds: rule.sourceIds,
      });
    }
    // 施設・ごみも公開物なので参照ソースをゲート対象に含める(公開対象=approvedソースのみ。distinctで冗長回避)。
    const facilitySourceIds = [...new Set(publishedFacs.map((f) => f.sourceId))];
    if (facilitySourceIds.length > 0) {
      references.push({ owner: `facilities (${code})`, sourceIds: facilitySourceIds });
    }
    if (wasteApproved && waste.dataset) {
      references.push({ owner: `waste dataset (${code})`, sourceIds: [waste.dataset.sourceId] });
    }
    // なぜ: ごみ分別辞書は未整備・未承認の自治体もあるため、その場合は参照0件
    // (=ゲート対象なし)で自然にスキップされる。
    const sortingSourceIds = [...new Set(publishedSorting.map((i) => i.sourceId))];
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
    excludedNonProcedureSources,
  };
}
