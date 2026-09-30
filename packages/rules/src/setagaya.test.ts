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
import { expectedLastVerifiedAt, expectedVersion } from './reaudited.fixture.js';
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

const MUNICIPALITY = '13112';

/** なぜ: 13112固定のプロフィールを組み立てるヘルパー(fixtureは13999のため流用不可)。 */
function profile(overrides: {
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: MUNICIPALITY },
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
  // Step3(2026-07-25): 学校転入・保育の2手続きを追加、同日 人手レビュー承認(ユーザー決裁)。
  // 既存8件(verified, 2026-07-21承認)は不変。ruleVersion は全体で1つ→ 2026-07-25.1 へ更新(公開版もこれに一致)。
  const APPROVED_STEP3_IDS = ['procedure_childcare_application', 'procedure_school_transfer'];

  it('rules.json parses as a RuleSet, scoped to 13112, 10 rules, ruleVersion 2026-07-25.1', () => {
    expect(setagayaRuleSet.municipalityCode).toBe(MUNICIPALITY);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    expect(setagayaRuleSet.ruleVersion).toBe('2026-08-09.1');
    // 2026-08-07 人手レビュー承認(ADR-009)。publishedRuleVersion は除去済みで、
    // ruleVersion がそのまま公開版になる(ADR-007)。
    expect(setagayaRuleSet.publishedRuleVersion).toBeUndefined();
    expect(setagayaRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      setagayaRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 verified(8件は2026-07-21承認・不変、2件はStep3 2026-07-25承認)', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(MUNICIPALITY);
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      // 期限は dueDate(算定式) ではなく dueDescription(公式文言) を静的に保持する
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
      // 2026-07-25時点で13112の全手続きが人手レビュー承認済み(ADR-007の公開単位)
      expect(pv.dataStatus).toBe('verified');
    }
    // 既存8件は 2026-07-21、Step3 追加の2件は 2026-07-25 に人手レビュー承認された版・確認日を保持する
    // (不変の回帰ガード)。再監査で内容を直した手続きだけは、その日の版・確認日へ進む
    // (reaudited.fixture.ts。2026-09-30: 窓口一覧の点検で「10か所」の表記と本庁舎の窓口の移転予定を直した)。
    const approvedStep3 = procedures.filter((p) => APPROVED_STEP3_IDS.includes(p.id));
    expect(approvedStep3.map((p) => p.id).sort()).toEqual(APPROVED_STEP3_IDS);
    for (const pv of procedures) {
      const step3 = APPROVED_STEP3_IDS.includes(pv.id);
      expect(pv.version, pv.id).toBe(
        expectedVersion(MUNICIPALITY, pv.id, step3 ? '2026-07-25.1' : '2026-07-21.1'),
      );
      expect(pv.lastVerifiedAt, pv.id).toBe(
        expectedLastVerifiedAt(
          MUNICIPALITY,
          pv.id,
          step3 ? '2026-07-25T00:00:00Z' : '2026-07-21T11:44:00Z',
        ),
      );
    }
    // Step3 追加の2件は 2026-07-25 に人手レビュー承認され、pending系のcaution文言は除去されている。
    for (const pv of approvedStep3) {
      expect(pv.cautions?.some((c) => c.includes('人手レビュー未了'))).toBe(false);
    }
  });

  it('procedures と rules は同一の10 procedureId を過不足なく覆う', () => {
    const procedures = parseProcedures();
    const procIds = procedures.map((p) => p.id).sort();
    const ruleIds = setagayaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 転入届を扱う10窓口(くみん窓口5+出張所5)だけ。ID は一意、まちづくりセンター等は含めない', () => {
    // 2026-09-30 窓口一覧の点検: 以前は公共施設一覧CSVの窓口系48行(まちづくりセンター28・旧施設・倉庫・
    // 店舗区画・区の出張所ではない施設など。facilityId は全行同じ壊れた値)を載せていた。区の
    // 「受付窓口（10か所）」ページと転入届ページ(「各総合支所くみん窓口、各出張所の受付窓口（10か所）」)
    // に合わせて10窓口に絞った。
    const facilities = parseFacilities();
    expect(facilities).toHaveLength(10);
    for (const f of facilities) expect(f.municipalityCode).toBe(MUNICIPALITY);
    expect(new Set(facilities.map((f) => f.facilityId)).size).toBe(10);
    const cats = facilities.map((f) => f.category);
    expect(cats.filter((c) => c === '総合支所くみん窓口')).toHaveLength(5);
    expect(cats.filter((c) => c === '出張所')).toHaveLength(5);
    expect(
      facilities.some((f) => /まちづくりセンター|（旧）|倉庫|集会所|Factory/.test(f.name)),
    ).toBe(false);
    // 世田谷総合支所くみん窓口は現在の所在地(第2庁舎1階)を示し、西棟への移転予定を添える。
    // この所在地に当たる行が CSV に無いので、区の受付窓口一覧ページを出典にして座標は持たない。
    const setagaya = facilities.find((f) => f.facilityId === '13112-fac-kumin-setagaya');
    expect(setagaya?.address).toContain('世田谷区役所第2庁舎1階');
    expect(setagaya?.name).toContain('西棟1階へ移転予定');
    expect(setagaya?.sourceId).toBe('src-13112-facilities-002');
    expect(setagaya?.lat).toBeUndefined();
    // 残る9窓口は CSV の同じ建物・同じ番地の行(座標あり)。
    const others = facilities.filter((f) => f !== setagaya);
    for (const f of others) {
      expect(f.sourceId).toBe('src-13112-facilities-001');
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
    }
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
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日
    const jusho = outcomeFor(single, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    // 子育て・学校転入・保育・犬タスクは非該当(単身・学齢児なし・保育ニーズなし)
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, id).applicable).toBe('not_applicable');
    }
  });

  it('子育て世帯(未就学0-2+小学生): 単身と比べ 児童手当・子ども医療・学校転入・保育 が増える(Step3で学校転入・保育を追加)', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family).filter((id) => !applicableIds(single).includes(id));
    expect(added.sort()).toEqual(
      [
        'procedure_child_allowance',
        'procedure_child_medical',
        'procedure_school_transfer',
        'procedure_childcare_application',
      ].sort(),
    );
    // 学校転入は elementary、保育は age0_2 で該当(江東・新宿と同一の条件式)。
    expect(outcomeFor(family, 'procedure_school_transfer').applicable).toBe('applicable');
    expect(outcomeFor(family, 'procedure_childcare_application').applicable).toBe('applicable');
    // 児童手当の15日特例は前住所地の転出予定日起算のため moveDate からは算定不可 →
    // 日付を出さず公式文言のみ表示(遅い期限を示して特例月を逃させないための安全側判断、レビュー承認済み)
    const allowance = outcomeFor(family, 'procedure_child_allowance');
    expect(allowance.dueDate).toBeUndefined();
    expect(allowance.dueDescription).toContain('15日以内');
    expect(allowance.priority).toBe('high');
    // 子ども医療は 3か月(暦月)のため offsetDays 化せず dueDescription のみ
    const med = outcomeFor(family, 'procedure_child_medical');
    expect(med.dueDate).toBeUndefined();
    expect(med.dueDescription).toContain('3か月以内');
  });

  it('就学・保育ニーズフラグ単独(年齢帯=adultのみ)でも 学校転入・保育 が該当(∨条件; 江東・新宿と同一)', () => {
    const flagOnly = profile({ flags: { hasSchoolOrChildcareNeeds: true } });
    expect(outcomeFor(flagOnly, 'procedure_school_transfer').applicable).toBe('applicable');
    expect(outcomeFor(flagOnly, 'procedure_childcare_application').applicable).toBe('applicable');
    // 学校転入・保育とも期限は公式に日数記載なし → dueDate は出さず公式文言のみ。
    const school = outcomeFor(flagOnly, 'procedure_school_transfer');
    expect(school.dueDate).toBeUndefined();
    expect(school.dueDescription).toContain('学校指定通知書');
    const childcare = outcomeFor(flagOnly, 'procedure_childcare_application');
    expect(childcare.dueDate).toBeUndefined();
    expect(childcare.dueDescription).toContain('前月10日');
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
    // 転入届とごみ確認、および全員該当のライフライン3件は残る
    expect(applicableIds(off)).toEqual(
      [
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
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
