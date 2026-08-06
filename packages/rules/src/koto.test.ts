import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import {
  ruleSetSchema,
  procedureVersionSchema,
  facilitySchema,
  wasteAreaSchema,
  wasteScheduleSchema,
} from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: T-015 江東区(13108)縦切りデータ(子育てペルソナ対応)の来歴・型・決定論をCIで機械検証する。
 * (a) rules/procedures/facilities/waste が全て @tmn/schemas でparse成功
 * (b) ペルソナ別評価で該当タスクの増減を明示アサート(子育て世帯で児童手当・子ども医療・学校転入・保育が増える)
 * (c) 自治体差分: 同一プロフィールで 13112 と 13108 の結果が異なることの実証(デモの根拠)
 * (d) 越境(13108プロフィール×13112ルール)がエラー
 * (e) 全ルールのsourceIdsがregistry.csvに実在
 * (f) 「他区の値を混入させない」ことの回帰ガード(子ども医療費の『3か月』を持ち込まない 等)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const kotoRulesRaw = readJson('packages/rules/data/13108/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const proceduresRaw = readJson('data/normalized/13108/procedures.json') as { procedures: unknown };
const facilitiesRaw = readJson('data/normalized/13108/facilities.json') as { facilities: unknown };
const wasteRaw = readJson('data/normalized/13108/waste.json') as {
  wasteAreas: unknown;
  wasteSchedules: unknown;
};

const kotoRuleSet: RuleSet = ruleSetSchema.parse(kotoRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);

const parseProcedures = () =>
  (proceduresRaw.procedures as unknown[]).map((x) => procedureVersionSchema.parse(x));

/**
 * なぜ: 2026-08-06 追加の「自治体以外(ライフライン等)の手続き」4件(ADR-009)。全対応区で
 * municipalityCode 以外まったく同一の内容であり、区固有データの回帰ガードである本ファイルの
 * 対象外とする(4件そのものの検証は non-municipal.test.ts が全区横断で行う)。
 * ペルソナ評価には影響するため、常に該当する3件(水道・郵便・電気ガス)は期待値へ加える。
 * 運転免許は needsVehicleGuidance フラグ依存のため既定プロフィールでは非該当。
 */
const NON_MUNICIPAL_IDS = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
  'procedure_driver_license_change',
];
const NON_MUNICIPAL_ALWAYS_APPLICABLE = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
];

const parseMunicipalProcedures = () =>
  parseProcedures().filter((p) => !NON_MUNICIPAL_IDS.includes(p.id));
const parseFacilities = () =>
  (facilitiesRaw.facilities as unknown[]).map((x) => facilitySchema.parse(x));
const parseAreas = () => (wasteRaw.wasteAreas as unknown[]).map((x) => wasteAreaSchema.parse(x));
const parseSchedules = () =>
  (wasteRaw.wasteSchedules as unknown[]).map((x) => wasteScheduleSchema.parse(x));

const KOTO = '13108';

/**
 * なぜ: 江東(13108)固定のプロフィールを組み立てるヘルパー。町名は収集日CSVの area_label('青海')を採用。
 * destinationのmunicipalityCodeを差し替えられるようにし、自治体差分テストで13112版も作る。
 */
function profile(overrides: {
  municipalityCode?: string;
  town?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: {
      municipalityCode: overrides.municipalityCode ?? KOTO,
      town: overrides.town ?? '青海',
    },
    moveDate: '2026-08-01',
    originType: overrides.originType ?? 'outside_tokyo',
    household: {
      memberCount: overrides.memberCount ?? 1,
      ageBands: overrides.ageBands ?? ['adult'],
    },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: true,
      needsNationalPension: true,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
      isPregnantMember: false,
      ...overrides.flags,
    },
  };
}

function applicableIds(p: Profile, rs: RuleSet): string[] {
  return evaluate(p, rs)
    .outcomes.filter((o) => o.applicable === 'applicable')
    .map((o) => o.procedureId)
    .sort();
}

function outcomeFor(p: Profile, rs: RuleSet, procedureId: string) {
  const o = evaluate(p, rs).outcomes.find((x) => x.procedureId === procedureId);
  if (!o) throw new Error(`no outcome for ${procedureId}`);
  return o;
}

describe('Koto (13108) — schema validation (来歴・型検証; CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13108, 10 rules', () => {
    expect(kotoRuleSet.municipalityCode).toBe(KOTO);
    expect(kotoRuleSet.ruleVersion).toBe('2026-08-06.1');
    // ADR-007 §5: 追加分は staging のため、公開される rule_set の版は据え置く。
    expect(kotoRuleSet.publishedRuleVersion).toBe('2026-07-22.1');
    expect(kotoRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      kotoRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; every one is verified (human-reviewed) + has sourceIds + lastVerifiedAt', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(KOTO);
      // 2026-07-22 人手レビュー承認済み(台帳の全13108ソースがapproved)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-07-22T00:00:00Z');
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it('procedures and rules cover exactly the same 10 procedureIds', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = kotoRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 9 window facilities parse; 本庁舎/出張所/特別出張所 present (R-4フィルタ結果)', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(9);
    for (const f of facilities) expect(f.municipalityCode).toBe(KOTO);
    const cats = new Set(facilities.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    expect(cats.has('出張所')).toBe(true);
    expect(cats.has('特別出張所')).toBe(true);
    // 倉庫・集会所・区民館等の非窓口施設が混入していないこと(窓口系抽出の回帰ガード)。
    expect(facilities.some((f) => /倉庫|集会所|区民館|防災センター/.test(f.name))).toBe(false);
  });

  it('waste.json — 58 areas / 290 schedules parse; 燃やさないごみは（隔週）でweekOfMonth未付与(推測禁止)', () => {
    const areas = parseAreas();
    const schedules = parseSchedules();
    expect(areas.length).toBe(58);
    expect(schedules.length).toBe(290); // 58地区 × (資源1+プラ1+燃やす2+燃やさない1)
    for (const s of schedules) {
      expect(s.effectiveFrom).toBe('2024-11-30'); // 出典CSV resource last_modified(R-1)
      expect(s.effectiveTo).toBeUndefined(); // 年度追従未確認のため上限は設定しない
      expect(s.sourceId).toBe('src-13108-waste_schedule-001');
    }
    // 隔週(燃やさないごみ)は「第何週か」が出典に無いため weekOfMonth を付けない。
    const biweekly = schedules.filter((s) => s.wasteType.includes('（隔週）'));
    expect(biweekly.length).toBe(58); // 1地区につき1件
    for (const s of biweekly) expect(s.weekOfMonth).toBeUndefined();
    // 週次(資源/プラ/燃やす)には（隔週）マーカーが無い。
    const weekly = schedules.filter((s) => !s.wasteType.includes('（隔週）'));
    expect(weekly.length).toBe(290 - 58);
    // area_label がそのまま地区選択肢。重複なし。
    const labels = areas.map((a) => a.areaLabel);
    expect(labels).toContain('青海');
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('Koto (13108) — persona evaluations (子育てペルソナで該当が増える)', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, kotoRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日
    const jusho = outcomeFor(single, kotoRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    // 子育て・学校・保育・犬タスクは非該当
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, kotoRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('子育て世帯(4人・未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える(決定論的増加)', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, kotoRuleSet).filter(
      (id) => !applicableIds(single, kotoRuleSet).includes(id),
    );
    expect(added.sort()).toEqual(
      [
        'procedure_child_allowance',
        'procedure_child_medical',
        'procedure_school_transfer',
        'procedure_childcare_application',
      ].sort(),
    );
  });

  it('学校転入ルール: hasSchoolOrChildcareNeeds=true でも(年齢帯に依らず)該当する', () => {
    const needsSchool = profile({
      memberCount: 2,
      ageBands: ['adult'],
      flags: { hasSchoolOrChildcareNeeds: true },
    });
    expect(outcomeFor(needsSchool, kotoRuleSet, 'procedure_school_transfer').applicable).toBe(
      'applicable',
    );
    expect(outcomeFor(needsSchool, kotoRuleSet, 'procedure_childcare_application').applicable).toBe(
      'applicable',
    );
  });

  it('自治体差分(マイナンバー期限): 江東は継続利用の期限が「90日」文言で dueDate を出さない(世田谷=14日算定との差)', () => {
    const withCard = profile({ flags: { hasMyNumberCard: true } });
    const koto = outcomeFor(withCard, kotoRuleSet, 'procedure_mynumber_continued_use');
    expect(koto.dueDate).toBeUndefined();
    expect(koto.dueDescription).toContain('90日');
    // 世田谷側は同一手続きが moveDate+14日 の dueDate を算出する(差分の裏取り)。
    const setagayaProfile = profile({
      municipalityCode: '13112',
      town: '世田谷4丁目',
      flags: { hasMyNumberCard: true },
    });
    const seta = outcomeFor(setagayaProfile, setagayaRuleSet, 'procedure_mynumber_continued_use');
    expect(seta.dueDate).toBe('2026-08-15');
  });

  it('他区の値を混入させない: 子ども医療費の dueDescription に「3か月」を持ち込まない(世田谷の値の非混入)', () => {
    const family = profile({
      memberCount: 3,
      ageBands: ['elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const med = outcomeFor(family, kotoRuleSet, 'procedure_child_medical');
    expect(med.dueDate).toBeUndefined();
    expect(med.dueDescription).not.toContain('3か月');
    // 15日特例(児童手当)は起算不可のため日付を出さず文言のみ。
    const allowance = outcomeFor(family, kotoRuleSet, 'procedure_child_allowance');
    expect(allowance.dueDate).toBeUndefined();
    expect(allowance.dueDescription).toContain('15日');
  });

  it('犬あり・マイクロチップ不明: 犬の届出は needs_confirmation(C-10, 推測しない)', () => {
    const dogUnknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dog = outcomeFor(dogUnknown, kotoRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('needs_confirmation');
    expect(dog.applicabilityReason).toContain('マイクロチップ');
  });

  it('犬あり・装着済み=区窓口不要(非該当) / 未装着=該当', () => {
    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(outcomeFor(chipped, kotoRuleSet, 'procedure_dog_registration_transfer').applicable).toBe(
      'not_applicable',
    );
    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    expect(outcomeFor(noChip, kotoRuleSet, 'procedure_dog_registration_transfer').applicable).toBe(
      'applicable',
    );
  });

  it('国保フラグOFFで国保タスクが消える(負例)', () => {
    const off = profile({
      flags: { hasMyNumberCard: false, needsNationalHealthInsurance: false },
    });
    expect(outcomeFor(off, kotoRuleSet, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    // 国保は moveDate+14日(該当時)
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, kotoRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
  });
});

describe('Koto (13108) — 自治体差分の実証(デモの根拠)', () => {
  it('同一プロフィール(子育て・小学生あり)で 13108 も 13112 も学校転入・保育が該当する(Step3で世田谷にも整備→差分解消)', () => {
    // なぜ: Step3(2026-07-25)以前は「江東のみ学校転入・保育あり/世田谷は未整備」という差分だった。
    // Step3で世田谷にも同一条件式の2手続きを追加したため、同一の子育てプロフィールでは両区とも該当し、
    // 該当集合も一致する。この「変化点」を回帰ガードとして固定する(残る自治体差分は下のtestで維持)。
    const koto = profile({
      municipalityCode: KOTO,
      town: '青海',
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const setagaya = profile({
      municipalityCode: '13112',
      town: '世田谷4丁目',
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const kotoIds = applicableIds(koto, kotoRuleSet);
    const setagayaIds = applicableIds(setagaya, setagayaRuleSet);

    for (const ids of [kotoIds, setagayaIds]) {
      expect(ids).toContain('procedure_school_transfer');
      expect(ids).toContain('procedure_childcare_application');
    }
    // 学校転入・保育の有無ではもはや区別できない(該当集合が一致)。
    expect(setagayaIds).toEqual(kotoIds);
  });

  it('残る自治体差分: マイナンバー継続利用の期限は江東=90日文言(dueDate無し)/世田谷=14日算定(維持)', () => {
    // なぜ: 学校・保育の差分は解消したが、自治体差分デモの核(マイナンバー期限14日/90日)は維持する。
    const withCard = { flags: { hasMyNumberCard: true } };
    const koto = outcomeFor(
      profile({ municipalityCode: KOTO, town: '青海', ...withCard }),
      kotoRuleSet,
      'procedure_mynumber_continued_use',
    );
    const setagaya = outcomeFor(
      profile({ municipalityCode: '13112', town: '世田谷4丁目', ...withCard }),
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    expect(koto.dueDate).toBeUndefined();
    expect(koto.dueDescription).toContain('90日');
    expect(setagaya.dueDate).toBe('2026-08-15');
  });
});

describe('Koto (13108) — provenance integrity & scope safety', () => {
  it('全ルール・全手続きの sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of kotoRuleSet.rules) {
      for (const sid of rule.sourceIds) {
        expect(registeredIds.has(sid), `rule ${rule.procedureId} → missing source ${sid}`).toBe(
          true,
        );
      }
    }
    for (const pv of parseProcedures()) {
      for (const sid of pv.sourceIds) {
        expect(registeredIds.has(sid), `procedure ${pv.id} → missing source ${sid}`).toBe(true);
      }
    }
    // 施設・ごみの sourceId も台帳に実在する。
    for (const f of parseFacilities()) {
      expect(registeredIds.has(f.sourceId)).toBe(true);
    }
    for (const s of parseSchedules()) {
      expect(registeredIds.has(s.sourceId)).toBe(true);
    }
  });

  it('越境: 13108プロフィール × 13112ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: KOTO });
    expect(() => evaluate(p, setagayaRuleSet)).toThrow(MunicipalityScopeMismatchError);
  });

  it('決定論: 同一入力で同一結果 + スナップショット(回帰ガード)', () => {
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: {
        hasMyNumberCard: true,
        needsNationalPension: false,
        hasDog: true,
        dogHasMicrochip: 'unknown',
      },
    });
    const first = evaluate(family, kotoRuleSet);
    const second = evaluate(family, kotoRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
