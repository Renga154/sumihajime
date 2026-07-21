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
import { dummyRuleSet } from '@tmn/test-fixtures';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: T-005 世田谷区(13112)縦切りデータの来歴・型・決定論をCIで機械検証する。
 * (a) rules/procedures/facilities/waste が全て @tmn/schemas でparse成功
 * (b) ペルソナ別評価で該当タスクの増減を明示アサート
 * (c) 全ルールのsourceIdsがregistry.csvに実在
 * (d) 自治体越境(13112プロフィール×ダミー13999ルール)がエラー
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const rulesRaw = readJson('packages/rules/data/13112/rules.json');
const proceduresRaw = readJson('data/normalized/13112/procedures.json') as { procedures: unknown };
const facilitiesRaw = readJson('data/normalized/13112/facilities.json') as { facilities: unknown };
const wasteRaw = readJson('data/normalized/13112/waste.json') as {
  wasteAreas: unknown;
  wasteSchedules: unknown;
};

const setagayaRuleSet: RuleSet = ruleSetSchema.parse(rulesRaw);

/** なぜ: zodをrulesの直接依存に加えず、要素スキーマで1件ずつparseして配列を検証する。 */
const parseProcedures = () =>
  (proceduresRaw.procedures as unknown[]).map((x) => procedureVersionSchema.parse(x));
const parseFacilities = () =>
  (facilitiesRaw.facilities as unknown[]).map((x) => facilitySchema.parse(x));
const parseAreas = () => (wasteRaw.wasteAreas as unknown[]).map((x) => wasteAreaSchema.parse(x));
const parseSchedules = () =>
  (wasteRaw.wasteSchedules as unknown[]).map((x) => wasteScheduleSchema.parse(x));

const MUNICIPALITY = '13112';

/** なぜ: 13112固定のプロフィールを組み立てるヘルパー(fixtureは13999のため流用不可)。 */
function profile(overrides: {
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: MUNICIPALITY, town: '世田谷4丁目' },
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

/** なぜ: applicable=applicable のprocedureIdの集合を取り出し、期待値と厳密比較する。 */
function applicableIds(p: Profile): string[] {
  return evaluate(p, setagayaRuleSet)
    .outcomes.filter((o) => o.applicable === 'applicable')
    .map((o) => o.procedureId)
    .sort();
}

function outcomeFor(p: Profile, procedureId: string) {
  const o = evaluate(p, setagayaRuleSet).outcomes.find((x) => x.procedureId === procedureId);
  if (!o) throw new Error(`no outcome for ${procedureId}`);
  return o;
}

describe('Setagaya (13112) — schema validation (来歴・型検証; CI gate)', () => {
  it('rules.json parses as a RuleSet and is scoped to 13112', () => {
    expect(setagayaRuleSet.municipalityCode).toBe(MUNICIPALITY);
    expect(setagayaRuleSet.ruleVersion).toBe('2026-07-21.1');
    expect(setagayaRuleSet.rules.length).toBe(8);
  });

  it('procedures.json — all 8 ProcedureVersions parse; every one is partial + has sourceIds + lastVerifiedAt', () => {
    const procedures = parseProcedures();
    expect(procedures.length).toBe(8);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(MUNICIPALITY);
      expect(pv.dataStatus).toBe('partial'); // pending human review
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-07-21T11:44:00Z');
      // 期限は dueDate(算定式) ではなく dueDescription(公式文言) を静的に保持する
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it('procedures and rules cover exactly the same 8 procedureIds', () => {
    const procedures = parseProcedures();
    const procIds = procedures.map((p) => p.id).sort();
    const ruleIds = setagayaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — all facilities parse; window facilities present (本庁舎/総合支所/出張所/まちづくりセンター)', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBeGreaterThan(0);
    for (const f of facilities) expect(f.municipalityCode).toBe(MUNICIPALITY);
    const cats = new Set(facilities.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    expect(cats.has('総合支所')).toBe(true);
    expect(cats.has('出張所')).toBe(true);
    expect(cats.has('まちづくりセンター')).toBe(true);
  });

  it('waste.json — all areas and schedules parse; area labels are the district picker options', () => {
    const areas = parseAreas();
    const schedules = parseSchedules();
    expect(areas.length).toBe(118);
    expect(schedules.length).toBe(590); // 118地区 × (資源1+可燃2+不燃1+ペット1)
    // 全収集レコードに年度有効期間(C-9: 例外日は展開せず注意書きで誘導)
    for (const s of schedules) {
      expect(s.effectiveFrom).toBe('2026-04-01');
      expect(s.effectiveTo).toBe('2027-03-31');
      expect(s.sourceId).toBe('src-13112-waste_schedule-001');
    }
    // 町丁目マスタ = area_label 一覧がそのまま地区選択肢(別ファイル不要)
    const labels = areas.map((a) => a.areaLabel);
    expect(labels).toContain('赤堤1・3〜5丁目');
    expect(new Set(labels).size).toBe(labels.length); // ラベル重複なし
  });
});

describe('Setagaya (13112) — persona evaluations (該当タスクの増減を証明)', () => {
  it('単身・都外・マイナンバーカードあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子ども・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日
    const jusho = outcomeFor(single, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    // 子育て・犬タスクは非該当
    expect(outcomeFor(single, 'procedure_child_allowance').applicable).toBe('not_applicable');
    expect(outcomeFor(single, 'procedure_dog_registration_transfer').applicable).toBe(
      'not_applicable',
    );
  });

  it('子育て世帯: 単身と比べ 児童手当・子ども医療 が増える(決定論的増加)', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family).filter((id) => !applicableIds(single).includes(id));
    expect(added.sort()).toEqual(['procedure_child_allowance', 'procedure_child_medical'].sort());
    // 児童手当は 15日特例 → moveDate+15日
    expect(outcomeFor(family, 'procedure_child_allowance').dueDate).toBe('2026-08-16');
    expect(outcomeFor(family, 'procedure_child_allowance').priority).toBe('high');
    // 子ども医療は 3か月(暦月)のため offsetDays 化せず dueDescription のみ
    const med = outcomeFor(family, 'procedure_child_medical');
    expect(med.dueDate).toBeUndefined();
    expect(med.dueDescription).toContain('3か月以内');
  });

  it('犬あり・マイクロチップ不明: 犬の届出は needs_confirmation(C-10, 推測しない)', () => {
    const dogUnknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dog = outcomeFor(dogUnknown, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('needs_confirmation');
    expect(dog.applicabilityReason).toContain('マイクロチップ');
  });

  it('犬あり・マイクロチップ装着済み: 区窓口の届出は非該当(環境省DBで手続き=区不要)', () => {
    const dogChipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(outcomeFor(dogChipped, 'procedure_dog_registration_transfer').applicable).toBe(
      'not_applicable',
    );
  });

  it('犬あり・マイクロチップ未装着: 区窓口の届出が該当', () => {
    const dogNoChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    expect(outcomeFor(dogNoChip, 'procedure_dog_registration_transfer').applicable).toBe(
      'applicable',
    );
  });

  it('フラグOFFの負例: 国保フラグOFFで国保タスクが消える、マイナンバーOFFでマイナンバータスクが消える', () => {
    const off = profile({
      flags: {
        hasMyNumberCard: false,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
      },
    });
    expect(outcomeFor(off, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    expect(outcomeFor(off, 'procedure_mynumber_continued_use').applicable).toBe('not_applicable');
    expect(outcomeFor(off, 'procedure_national_pension_address').applicable).toBe('not_applicable');
    // 転入届とごみ確認は全員該当のまま
    expect(applicableIds(off)).toEqual(
      ['procedure_resident_registration', 'procedure_waste_check'].sort(),
    );
  });
});

describe('Setagaya (13112) — provenance integrity & scope safety', () => {
  it('全ルールのsourceIdsが registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of setagayaRuleSet.rules) {
      for (const sid of rule.sourceIds) {
        expect(
          registeredIds.has(sid),
          `rule ${rule.procedureId} references missing source ${sid}`,
        ).toBe(true);
      }
    }
    // 手続き側のsourceIdsも実在確認
    const procedures = parseProcedures();
    for (const pv of procedures) {
      for (const sid of pv.sourceIds) {
        expect(registeredIds.has(sid), `procedure ${pv.id} references missing source ${sid}`).toBe(
          true,
        );
      }
    }
  });

  it('自治体越境: 13112プロフィール × ダミー13999ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({});
    expect(() => evaluate(p, dummyRuleSet)).toThrow(MunicipalityScopeMismatchError);
  });

  it('決定論: 同一入力で同一結果 + スナップショット(回帰ガード)', () => {
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const first = evaluate(family, setagayaRuleSet);
    const second = evaluate(family, setagayaRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
