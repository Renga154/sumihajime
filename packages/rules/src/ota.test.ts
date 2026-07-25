import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import { ruleSetSchema, procedureVersionSchema, facilitySchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: Step5-B 大田区(13111)縦切りデータ(pending)の来歴・型・決定論・自治体差分をCIで機械検証する。
 * (a) rules/procedures/facilities が @tmn/schemas でparse成功。手続きは全件 partial(人手レビュー未了)。
 * (b) ペルソナ別評価で該当タスクの増減を明示アサート(子育て世帯で児童手当・子ども医療・学校転入・保育が増える)。
 * (c) 自治体差分: 子ども医療の申請期限は「6か月」(江東/世田谷/新宿/杉並と相違)、マイナンバー継続は「90日」文言。
 * (d) 越境(13111プロフィール×13112ルール)がエラー。
 * (e) 全ルール・全手続き・施設の sourceIds が registry.csv に実在。
 * (f) 収集曜日は誠実縮退: 大田は waste.json を作らない(1年度遅れのXLSXを公開しない)。
 * (g) 「他区の値を混入させない」回帰ガード(子ども医療の期限文言に他区の日数を持ち込まない 等)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const otaRulesRaw = readJson('packages/rules/data/13111/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const proceduresRaw = readJson('data/normalized/13111/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13111/facilities.json') as {
  facilities: unknown[];
};

const otaRuleSet: RuleSet = ruleSetSchema.parse(otaRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);

const parseProcedures = () => proceduresRaw.procedures.map((x) => procedureVersionSchema.parse(x));
const parseFacilities = () => facilitiesRaw.facilities.map((x) => facilitySchema.parse(x));

const OTA = '13111';

/** 大田(13111)固定のプロフィールを組み立てる。town は収集曜日データ非依存(蒲田を使用)。 */
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
      municipalityCode: overrides.municipalityCode ?? OTA,
      town: overrides.town ?? '蒲田',
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

describe('Ota (13111) — schema validation (来歴・型検証; CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13111, 10 rules, ruleVersion 2026-07-26.1', () => {
    expect(otaRuleSet.municipalityCode).toBe(OTA);
    expect(otaRuleSet.ruleVersion).toBe('2026-07-26.1');
    expect(otaRuleSet.rules.length).toBe(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 partial(人手レビュー未了)+ sourceIds + lastVerifiedAt', () => {
    const procedures = parseProcedures();
    expect(procedures.length).toBe(10);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(OTA);
      // 2026-07-26 時点で pending。承認まで partial(ADR-007 で公開対象=verified のみ)。
      expect(pv.dataStatus).toBe('partial');
      expect(pv.version).toBe('2026-07-26.1');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-07-26T00:00:00Z');
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it('procedures and rules cover exactly the same 10 procedureIds', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = otaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 26 窓口/庁舎施設が parse; 本庁舎/地域庁舎/特別出張所/その他庁舎 present。全件に緯度経度', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(26);
    for (const f of facilities) {
      expect(f.municipalityCode).toBe(OTA);
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
    }
    const cats = new Set(facilities.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    expect(cats.has('地域庁舎')).toBe(true);
    expect(cats.has('特別出張所')).toBe(true);
    expect(cats.has('その他庁舎')).toBe(true);
    // publish の窓口フィルタ(倉庫/集会所)に触れる名称が混入していないこと。
    expect(facilities.some((f) => /倉庫|集会所/.test(f.name))).toBe(false);
  });

  it('収集曜日は誠実縮退: 大田は waste.json を作らない(1年度遅れのXLSXを公開しない)', () => {
    expect(existsSync(resolve(repoRoot, 'data/normalized/13111/waste.json'))).toBe(false);
    // 分別辞書も未整備(CSVが都カタログに存在しない)。
    expect(existsSync(resolve(repoRoot, 'data/normalized/13111/waste-sorting.json'))).toBe(false);
  });
});

describe('Ota (13111) — persona evaluations (子育てペルソナで該当が増える)', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, otaRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日。
    const jusho = outcomeFor(single, otaRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, otaRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('子育て世帯(4人・未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える(決定論的増加)', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, otaRuleSet).filter(
      (id) => !applicableIds(single, otaRuleSet).includes(id),
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

  it('国保フラグOFFで国保タスクが消える(負例)。ON時は moveDate+14日', () => {
    const off = profile({ flags: { hasMyNumberCard: false, needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, otaRuleSet, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, otaRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
  });

  it('犬あり・マイクロチップ不明: 犬の届出は needs_confirmation(C-10, 推測しない)。装着済み=非該当/未装着=該当', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dog = outcomeFor(unknown, otaRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('needs_confirmation');
    expect(dog.applicabilityReason).toContain('マイクロチップ');
    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(outcomeFor(chipped, otaRuleSet, 'procedure_dog_registration_transfer').applicable).toBe(
      'not_applicable',
    );
    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    expect(outcomeFor(noChip, otaRuleSet, 'procedure_dog_registration_transfer').applicable).toBe(
      'applicable',
    );
  });
});

describe('Ota (13111) — 自治体差分の実証(デモの根拠)', () => {
  it('子ども医療の申請期限は「6か月」(大田固有)。「3か月」「15日」を混入させない', () => {
    const family = profile({
      memberCount: 3,
      ageBands: ['elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const med = outcomeFor(family, otaRuleSet, 'procedure_child_medical');
    expect(med.dueDate).toBeUndefined(); // 月単位のため日付算定しない
    expect(med.dueDescription).toContain('6か月');
    expect(med.dueDescription).not.toContain('3か月'); // 世田谷/新宿の値を持ち込まない
    expect(med.dueDescription).not.toContain('15日'); // 杉並の値を持ち込まない
    // 児童手当は15日特例(起算不可のため日付を出さず文言のみ)。
    const allowance = outcomeFor(family, otaRuleSet, 'procedure_child_allowance');
    expect(allowance.dueDate).toBeUndefined();
    expect(allowance.dueDescription).toContain('15日');
  });

  it('マイナンバー継続利用の期限は「90日」文言(dueDate無し)/世田谷は14日算定(差分維持)', () => {
    const withCard = { flags: { hasMyNumberCard: true } };
    const ota = outcomeFor(
      profile({ municipalityCode: OTA, town: '蒲田', ...withCard }),
      otaRuleSet,
      'procedure_mynumber_continued_use',
    );
    expect(ota.dueDate).toBeUndefined();
    expect(ota.dueDescription).toContain('90日');
    const seta = outcomeFor(
      profile({ municipalityCode: '13112', town: '世田谷4丁目', ...withCard }),
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    expect(seta.dueDate).toBe('2026-08-15');
  });

  it('保育の申込締切は「前月7日」文言(大田固有)', () => {
    const family = profile({
      memberCount: 3,
      ageBands: ['age0_2', 'adult'],
      flags: { hasSchoolOrChildcareNeeds: true },
    });
    const childcare = outcomeFor(family, otaRuleSet, 'procedure_childcare_application');
    expect(childcare.applicable).toBe('applicable');
    expect(childcare.dueDescription).toContain('前月7日');
  });
});

describe('Ota (13111) — provenance integrity & scope safety', () => {
  it('全ルール・全手続き・全施設の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of otaRuleSet.rules) {
      for (const sid of rule.sourceIds) {
        expect(registeredIds.has(sid), `rule ${rule.procedureId} → missing ${sid}`).toBe(true);
      }
    }
    for (const pv of parseProcedures()) {
      for (const sid of pv.sourceIds) {
        expect(registeredIds.has(sid), `procedure ${pv.id} → missing ${sid}`).toBe(true);
      }
    }
    for (const f of parseFacilities()) {
      expect(registeredIds.has(f.sourceId)).toBe(true);
    }
  });

  it('越境: 13111プロフィール × 13112ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: OTA });
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
    const first = evaluate(family, otaRuleSet);
    const second = evaluate(family, otaRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
