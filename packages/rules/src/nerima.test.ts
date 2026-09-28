import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import { ruleSetSchema, procedureVersionSchema, facilitySchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: Batch6-A 練馬区(13120)縦切りデータの来歴・型・決定論・自治体差分をCIで機械検証する。
 * 練馬は2026-08-07に人手レビュー承認(ユーザー決裁「2区とも承認」)済みで、ごみ関連データを
 * 一切持たない誠実縮退を含むため、既存区と異なる次の点を固定する:
 * (a) 全手続きが dataStatus=verified(2026-08-07承認)で、公開ゲート(ADR-007)の対象。
 *     自治体以外(ライフライン等)の手続き4件(ADR-009)を含め14件
 * (b) waste.json(収集曜日)と waste-sorting.json(品目別分別辞書)の**両方**を作らない回帰ガード。
 *     都カタログ(organization:t131202)に収集・分別のCSVが1件も存在せず、公式サイトも
 *     町丁目別HTML表+PDFカレンダー+50音順HTMLのみのため、推測でデータを作らない(承認後も恒久的な誠実縮退)
 * (c) 施設は転入届窓口の区民事務所6件。GIF準拠CSV由来のため緯度経度あり(既存区で座標を持つのは江東・新宿等)
 * (d) 自治体差分: マイナンバー継続利用=90日(世田谷/新宿の14日と相違)/児童手当=15日特例/
 *     **子ども医療費助成は公式ページに期限の記載が一切ないため日数を出さない**
 *     (千代田/世田谷/新宿の3か月・杉並の15日・品川/大田の6か月・板橋の14日をいずれも混入させない)/
 *     学校の交付書類名は『入学通知書』(杉並/板橋の『転入学通知書』・世田谷の『学校指定通知書』を持ち込まない)
 * (e) ペルソナ別評価・越境・sourceIds実在・決定論(既存区テストと同型)。ライフライン4件そのものの
 *     検証は non-municipal.test.ts が全区横断で行うため、本ファイルの区固有アサーションは
 *     区の手続き10件を対象にする(NON_MUNICIPAL_IDS で除外)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const nerimaRulesRaw = readJson('packages/rules/data/13120/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const shinjukuRulesRaw = readJson('packages/rules/data/13104/rules.json');
const itabashiRulesRaw = readJson('packages/rules/data/13119/rules.json');
const proceduresRaw = readJson('data/normalized/13120/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13120/facilities.json') as {
  facilities: unknown[];
};

const nerimaRuleSet: RuleSet = ruleSetSchema.parse(nerimaRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);
const shinjukuRuleSet: RuleSet = ruleSetSchema.parse(shinjukuRulesRaw);
const itabashiRuleSet: RuleSet = ruleSetSchema.parse(itabashiRulesRaw);

const parseProcedures = () => proceduresRaw.procedures.map((x) => procedureVersionSchema.parse(x));
const parseFacilities = () => facilitiesRaw.facilities.map((x) => facilitySchema.parse(x));

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

const NERIMA = '13120';

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: {
      municipalityCode: overrides.municipalityCode ?? NERIMA,
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

describe('Nerima (13120) — schema validation & approved status (CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13120, 14 rules, ruleVersion 2026-08-07.1', () => {
    expect(nerimaRuleSet.municipalityCode).toBe(NERIMA);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    expect(nerimaRuleSet.ruleVersion).toBe('2026-08-09.1');
    // ADR-007: 承認後は publishedRuleVersion を持たず、ruleVersion がそのまま公開版になる。
    expect(nerimaRuleSet.publishedRuleVersion).toBeUndefined();
    expect(nerimaRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      nerimaRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 verified(2026-08-07人手レビュー承認)', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(NERIMA);
      // 2026-08-07 人手レビュー承認(ユーザー決裁「2区とも承認」)によりverified(ADR-007の公開単位)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-08-07T00:00:00Z');
      // 期限は dueDate(算定式)ではなく dueDescription(公式文言)を静的に保持。
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
      // 承認によりpending系のcaution文言は除去されている。
      expect(pv.cautions?.some((c) => c.includes('人手レビュー未了'))).toBe(false);
    }
  });

  it('procedures と rules は同一の14 procedureId を過不足なく覆う', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = nerimaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 転入届窓口の区民事務所6件がparse; GIF準拠CSV由来で緯度経度あり', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(6);
    for (const f of facilities) {
      expect(f.municipalityCode).toBe(NERIMA);
      expect(f.sourceId).toBe('src-13120-facilities-001');
      expect(f.category).toBe('区民事務所');
      // 自治体標準オープンデータセット(GIF準拠)CSVの実値のみを採用しているため座標を持つ。
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
    }
    const names = facilities.map((f) => f.name);
    for (const n of ['練馬', '早宮', '光が丘', '石神井', '大泉', '関']) {
      expect(names.some((name) => name.includes(n))).toBe(true);
    }
    // publish の非窓口フィルタ(倉庫/集会所)で誤除外されない名称であること。
    expect(names.some((n) => /倉庫|集会所/.test(n))).toBe(false);
  });

  it('waste.json も waste-sorting.json も作らない — 練馬区に機械判読可能なごみデータが皆無であることの回帰ガード', () => {
    // なぜ: 都カタログ(organization:t131202)の package_search で「収集」「分別」とも count:0。
    // 公式サイトも町丁目別HTML表+PDFカレンダー+アプリ+50音順HTMLのみで構造化データが存在しない。
    // 推測で曜日・分別区分を作らないため、両ファイルとも存在しないことを固定する。
    expect(existsSync(resolve(repoRoot, 'data/normalized/13120/waste.json'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'data/normalized/13120/waste-sorting.json'))).toBe(false);
    // 代わりに procedure_waste_check が練馬区公式『地域別収集曜日一覧』へ誘導する。
    const wasteProc = parseProcedures().find((p) => p.id === 'procedure_waste_check');
    expect(wasteProc?.onlineUrl).toContain('city.nerima.tokyo.jp');
    expect(wasteProc?.dueDescription).toContain('地域別収集曜日一覧');
    expect(wasteProc?.cautions?.some((c) => c.includes('分別辞書'))).toBe(true);
  });
});

describe('Nerima (13120) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, nerimaRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    const jusho = outcomeFor(single, nerimaRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, nerimaRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('国保: フラグONで moveDate+14日、OFFで非該当', () => {
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, nerimaRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
    const off = profile({ flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, nerimaRuleSet, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
  });

  it('子育て世帯(未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, nerimaRuleSet).filter(
      (id) => !applicableIds(single, nerimaRuleSet).includes(id),
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

  it('就学・保育ニーズフラグ単独(adultのみ)でも 学校転入・保育 が該当(∨条件)', () => {
    const flagOnly = profile({ flags: { hasSchoolOrChildcareNeeds: true } });
    expect(outcomeFor(flagOnly, nerimaRuleSet, 'procedure_school_transfer').applicable).toBe(
      'applicable',
    );
    expect(outcomeFor(flagOnly, nerimaRuleSet, 'procedure_childcare_application').applicable).toBe(
      'applicable',
    );
  });

  it('犬あり・マイクロチップ不明: needs_confirmation(C-10, 推測しない)/ 装着済み=非該当 / 未装着=該当かつ期限なし', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, nerimaRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, nerimaRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, nerimaRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 練馬は転入の届出の日数期限の記載が無いため dueDate は出さない(板橋の30日を持ち込まない)。
    expect(dog.dueDate).toBeUndefined();
    expect(dog.dueDescription).not.toContain('30日以内に変更');
  });
});

describe('Nerima (13120) — 自治体差分の実証(他区の値を混入させない)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const setagayaWithCard = profile({
    municipalityCode: '13112',
    flags: { hasMyNumberCard: true },
  });

  it('マイナンバー継続利用: 練馬=90日文言(dueDate無し) / 世田谷=14日算定', () => {
    const nerima = outcomeFor(withCard, nerimaRuleSet, 'procedure_mynumber_continued_use');
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    // 練馬は『転入届出日から90日以内』の文言のみ(90日は転入届日起算のため moveDate から算定しない)。
    expect(nerima.dueDate).toBeUndefined();
    expect(nerima.dueDescription).toContain('90日');
    expect(nerima.dueDescription).toContain('転出予定日から30日以内');
    // 世田谷は moveDate+14日を算定。区が一様でないこと。
    expect(setagaya.dueDate).toBe('2026-08-15');
    expect(nerima.dueDate).not.toBe(setagaya.dueDate);
  });

  const family = (code: string, rs: RuleSet, procedureId: string) =>
    outcomeFor(
      profile({
        municipalityCode: code,
        memberCount: 3,
        ageBands: ['elementary', 'adult'],
        flags: { hasMyNumberCard: true, needsNationalPension: false },
      }),
      rs,
      procedureId,
    );

  it('子ども医療費助成: 練馬は公式に期限の記載が無いため日数を出さない(3か月/15日/6か月/14日をいずれも混入させない)', () => {
    const nerima = family('13120', nerimaRuleSet, 'procedure_child_medical');
    expect(nerima.dueDate).toBeUndefined();
    expect(nerima.dueDescription).toContain('記載がない');
    for (const other of ['3か月', '3ヶ月', '15日', '6か月', '6カ月', '14日以内']) {
      expect(nerima.dueDescription).not.toContain(other);
    }
    // 対比: 世田谷は3か月を明示する(区ごとに異なることの実証)。
    const setagaya = family('13112', setagayaRuleSet, 'procedure_child_medical');
    expect(setagaya.dueDescription).toContain('3か月');
  });

  it('児童手当: 練馬=15日特例の文言(起算日が転出予定日のため dueDate は算定しない)', () => {
    const nerima = family('13120', nerimaRuleSet, 'procedure_child_allowance');
    expect(nerima.dueDescription).toContain('15日以内');
    expect(nerima.dueDate).toBeUndefined();
  });

  it('学校転入: 練馬の交付書類名は『入学通知書』(杉並/板橋の『転入学通知書』・世田谷の『学校指定通知書』を混入させない)', () => {
    const school = family('13120', nerimaRuleSet, 'procedure_school_transfer');
    expect(school.dueDescription).toContain('入学通知書');
    expect(school.dueDescription).not.toContain('転入学通知書');
    expect(school.dueDescription).not.toContain('学校指定通知書');
    // 練馬固有: 前校の『在学証明書』『教科用図書給与証明書』(板橋の『教科書給与証明書』とは表記が異なる)。
    expect(school.dueDescription).toContain('教科用図書給与証明書');
  });
});

describe('Nerima (13120) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of nerimaRuleSet.rules) {
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
    for (const f of parseFacilities()) expect(registeredIds.has(f.sourceId)).toBe(true);
  });

  it('区の手続きの sourceId は 13120 名前空間(他区のソースを参照しない)。ライフライン4件は共通ソース(src-13000-/src-00000-)を参照する', () => {
    const ids = [
      ...nerimaRuleSet.rules
        .filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId))
        .flatMap((r) => r.sourceIds),
      ...parseMunicipalProcedures().flatMap((p) => p.sourceIds),
      ...parseFacilities().map((f) => f.sourceId),
    ];
    for (const sid of ids) expect(sid.startsWith('src-13120-')).toBe(true);
    // ライフライン4件は区固有ソースを増やさず、既存7区と共通の承認済みソースのみを参照する。
    const nonMunicipalIds = parseProcedures()
      .filter((p) => NON_MUNICIPAL_IDS.includes(p.id))
      .flatMap((p) => p.sourceIds);
    for (const sid of nonMunicipalIds) expect(sid.startsWith('src-131')).toBe(false);
  });

  it('越境: 13120プロフィール × 13112/13104/13119ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: NERIMA });
    expect(() => evaluate(p, setagayaRuleSet)).toThrow(MunicipalityScopeMismatchError);
    expect(() => evaluate(p, shinjukuRuleSet)).toThrow(MunicipalityScopeMismatchError);
    expect(() => evaluate(p, itabashiRuleSet)).toThrow(MunicipalityScopeMismatchError);
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
    const first = evaluate(family, nerimaRuleSet);
    const second = evaluate(family, nerimaRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
