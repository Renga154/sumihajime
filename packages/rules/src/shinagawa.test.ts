import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import {
  ruleSetSchema,
  procedureVersionSchema,
  facilitySchema,
  wasteSortingItemSchema,
} from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';
import { expectedLastVerifiedAt } from './reaudited.fixture.js';

/**
 * なぜ: Step5-A 品川区(13109)縦切りデータの来歴・型・決定論・自治体差分をCIで機械検証する。
 * 品川は2026-07-26に人手レビュー承認(ユーザー決裁「2区とも承認」)済みで、収集曜日を
 * 「鮮度未確認のため作らない」誠実縮退を含むため、既存区と異なる次の点を固定する:
 * (a) 全手続きが dataStatus=verified(2026-07-26承認)で、公開ゲート(ADR-007)の対象
 * (b) waste.json(収集曜日)を作らない(=ファイルが存在しない)ことの回帰ガード。収集日CSVが
 *     2017年更新のままで現行年度(令和8年度)と確認できないため古いデータを公開しない(承認後も恒久的な誠実縮退)
 * (c) waste-sorting.json(分別辞書)は整備済み(415品目)で、品川固有の「注意点」列が notes に統合されている
 * (d) 施設は窓口系7件(本庁舎3階戸籍住民課1+住民異動を扱う地域センター6)。GIF非準拠CSVのため座標なし
 * (e) 自治体差分: マイナンバー継続利用=90日(世田谷/新宿の14日と相違)/子ども医療=6カ月遡及
 *     (千代田/世田谷/新宿の3か月・杉並の15日と相違=品川固有)/学校の交付書類名は非設定(他区名称を持ち込まない)
 * (f) ペルソナ別評価・越境・sourceIds実在・決定論(既存区テストと同型)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const shinagawaRulesRaw = readJson('packages/rules/data/13109/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const shinjukuRulesRaw = readJson('packages/rules/data/13104/rules.json');
const proceduresRaw = readJson('data/normalized/13109/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13109/facilities.json') as {
  facilities: unknown[];
};
const wasteSortingRaw = readJson('data/normalized/13109/waste-sorting.json') as {
  items: unknown[];
};

const shinagawaRuleSet: RuleSet = ruleSetSchema.parse(shinagawaRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);
const shinjukuRuleSet: RuleSet = ruleSetSchema.parse(shinjukuRulesRaw);

const parseProcedures = () => proceduresRaw.procedures.map((x) => procedureVersionSchema.parse(x));

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

const parseFacilities = () => facilitiesRaw.facilities.map((x) => facilitySchema.parse(x));
const parseSorting = () => wasteSortingRaw.items.map((x) => wasteSortingItemSchema.parse(x));

const SHINAGAWA = '13109';

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: {
      municipalityCode: overrides.municipalityCode ?? SHINAGAWA,
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

describe('Shinagawa (13109) — schema validation & approved status (CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13109, 10 rules, ruleVersion 2026-07-26.1', () => {
    expect(shinagawaRuleSet.municipalityCode).toBe(SHINAGAWA);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    expect(shinagawaRuleSet.ruleVersion).toBe('2026-08-09.1');
    // 2026-08-07 人手レビュー承認(ADR-009)。publishedRuleVersion は除去済みで、
    // ruleVersion がそのまま公開版になる(ADR-007)。
    expect(shinagawaRuleSet.publishedRuleVersion).toBeUndefined();
    expect(shinagawaRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      shinagawaRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 verified(2026-07-26人手レビュー承認)', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(SHINAGAWA);
      // 2026-07-26 人手レビュー承認(ユーザー決裁「2区とも承認」)によりverified(ADR-007の公開単位)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe(
        expectedLastVerifiedAt('13109', pv.id, '2026-07-26T00:00:00Z'),
      );
      // 期限は dueDate(算定式)ではなく dueDescription(公式文言)を静的に保持。
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
      // 承認によりpending系のcaution文言は除去されている。
      expect(pv.cautions?.some((c) => c.includes('人手レビュー未了'))).toBe(false);
    }
  });

  it('procedures と rules は同一の10 procedureId を過不足なく覆う', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = shinagawaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口系7件(本庁舎1+地域センター6)parse; GIF非準拠CSVのため座標なし', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(7);
    for (const f of facilities) {
      expect(f.municipalityCode).toBe(SHINAGAWA);
      // 出典公共施設CSVはGIF非準拠(名称/所在地/カテゴリの3列のみ)で緯度経度なし=捏造回避で座標未設定。
      expect(f.sourceId).toBe('src-13109-facilities-001');
      expect(f.lat).toBeUndefined();
      expect(f.lng).toBeUndefined();
    }
    const honcho = facilities.filter((f) => f.category === '本庁舎');
    const centers = facilities.filter((f) => f.category === '地域センター');
    expect(honcho).toHaveLength(1);
    // 転入届(住民異動)を受け付ける地域センターは6か所(荏原第一・品川第一・大崎第一・大井第一・荏原第四・八潮)。
    expect(centers).toHaveLength(6);
    const names = facilities.map((f) => f.name);
    expect(names.some((n) => n.includes('戸籍住民課'))).toBe(true);
    expect(names.some((n) => n.includes('八潮地域センター'))).toBe(true);
    // 出典CSVの『区民集会所』併記名は採用せず窓口機能名(地域センター)のみ=publishの非窓口フィルタで誤除外されない。
    expect(names.some((n) => n.includes('集会所'))).toBe(false);
  });

  it('waste.json(収集曜日)は作らない — 鮮度未確認の誠実縮退の回帰ガード(2017年更新の収集日CSV)', () => {
    // なぜ: 品川の収集日CSV(gomisyusyubi.csv)はHTTP Last-Modified 2017-03-15で9年更新なし、
    // 区公式の収集日一覧も令和5年度更新のため、現行年度(令和8年度)のデータと確認できない。
    // 古いデータを公開しないため収集曜日データを作らない。waste.json が存在しないことを固定する。
    expect(existsSync(resolve(repoRoot, 'data/normalized/13109/waste.json'))).toBe(false);
    // 代わりに procedure_waste_check が品川区公式『ごみ・資源収集日一覧』・令和8年版カレンダーへ誘導する。
    const wasteProc = parseProcedures().find((p) => p.id === 'procedure_waste_check');
    expect(wasteProc?.onlineUrl).toContain('city.shinagawa.tokyo.jp');
    expect(wasteProc?.dueDescription).toContain('収集日一覧');
  });

  it('waste-sorting.json — 分別辞書415品目がparse; 品川固有の「注意点」列が notes に統合されている', () => {
    const items = parseSorting();
    expect(items.length).toBe(415);
    for (const i of items) {
      expect(i.municipalityCode).toBe(SHINAGAWA);
      expect(i.sourceId).toBe('src-13109-waste_sorting-001');
    }
    // 3区では空欄だった「注意点」列に品川は実データを持つ(例:『汚れの落とせないもの…は燃やすごみに』)。
    const withNotes = items.filter((i) => i.notes && i.notes.length > 0);
    expect(withNotes.length).toBeGreaterThan(0);
  });
});

describe('Shinagawa (13109) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, shinagawaRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    const jusho = outcomeFor(single, shinagawaRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, shinagawaRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('国保: フラグONで moveDate+14日、OFFで非該当', () => {
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, shinagawaRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
    const off = profile({ flags: { needsNationalHealthInsurance: false } });
    expect(
      outcomeFor(off, shinagawaRuleSet, 'procedure_national_health_insurance').applicable,
    ).toBe('not_applicable');
  });

  it('子育て世帯(未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, shinagawaRuleSet).filter(
      (id) => !applicableIds(single, shinagawaRuleSet).includes(id),
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
    expect(outcomeFor(flagOnly, shinagawaRuleSet, 'procedure_school_transfer').applicable).toBe(
      'applicable',
    );
    expect(
      outcomeFor(flagOnly, shinagawaRuleSet, 'procedure_childcare_application').applicable,
    ).toBe('applicable');
  });

  it('犬あり・マイクロチップ不明: needs_confirmation(C-10, 推測しない)/ 装着済み=非該当 / 未装着=該当', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, shinagawaRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, shinagawaRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, shinagawaRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 品川は転入変更の日数期限の記載が無いため dueDate は出さない(dueDescription のみ)。
    expect(dog.dueDate).toBeUndefined();
  });
});

describe('Shinagawa (13109) — 自治体差分の実証(他区の値を混入させない)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const setagayaWithCard = profile({
    municipalityCode: '13112',
    flags: { hasMyNumberCard: true },
  });

  it('マイナンバー継続利用: 品川・世田谷とも住み始めた日+14日を算定(品川の90日文言は据え置き)', () => {
    const shinagawa = outcomeFor(withCard, shinagawaRuleSet, 'procedure_mynumber_continued_use');
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    // 品川は継続利用の条件として「住み始めた日から14日以内に転入届をしていること」を明記して
    // いるため、この14日は算定できる(90日は転入届日起算のため算定しない)。
    // 「引っ越し予定日から30日以内」も条件に挙がるが、品川は"転出予定日"という語を使っておらず
    // 何の予定日か公式ページから確定できないため、この条件は期日の算定に使わない(推測しない)。
    expect(shinagawa.dueDate).toBe('2026-08-15');
    expect(
      shinagawaRuleSet.rules.find((r) => r.procedureId === 'procedure_mynumber_continued_use')
        ?.dueDescription,
    ).toContain('90日');
    // 世田谷も moveDate+14日を算定。
    expect(setagaya.dueDate).toBe('2026-08-15');
  });

  it('子ども医療費の遡及: 品川=6カ月(3か月/15日を混入させない) / 世田谷=3か月', () => {
    const family = (code: string, rs: RuleSet) =>
      outcomeFor(
        profile({
          municipalityCode: code,
          memberCount: 3,
          ageBands: ['elementary', 'adult'],
          flags: { hasMyNumberCard: true, needsNationalPension: false },
        }),
        rs,
        'procedure_child_medical',
      );
    const shinagawa = family('13109', shinagawaRuleSet);
    const setagaya = family('13112', setagayaRuleSet);
    expect(shinagawa.dueDescription).toContain('6カ月');
    expect(shinagawa.dueDescription).not.toContain('3か月');
    expect(shinagawa.dueDescription).not.toContain('3ヶ月');
    expect(shinagawa.dueDescription).not.toContain('15日');
    expect(setagaya.dueDescription).toContain('3か月');
  });

  it('学校転入: 品川は交付書類名を設定しない(杉並『転入学通知書』・世田谷『学校指定通知書』を混入させない)', () => {
    const school = outcomeFor(
      profile({ ageBands: ['elementary', 'adult'], memberCount: 2 }),
      shinagawaRuleSet,
      'procedure_school_transfer',
    );
    expect(school.dueDescription).not.toContain('転入学通知書');
    expect(school.dueDescription).not.toContain('学校指定通知書');
    // 品川固有: 前校の『在学証明書』『教科書給与証明書』を受け取る文言(他区の交付書類名は入れない)。
    expect(school.dueDescription).toContain('教科書給与証明書');
  });
});

describe('Shinagawa (13109) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of shinagawaRuleSet.rules) {
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
    for (const i of parseSorting()) expect(registeredIds.has(i.sourceId)).toBe(true);
  });

  it('越境: 13109プロフィール × 13112/13104ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: SHINAGAWA });
    expect(() => evaluate(p, setagayaRuleSet)).toThrow(MunicipalityScopeMismatchError);
    expect(() => evaluate(p, shinjukuRuleSet)).toThrow(MunicipalityScopeMismatchError);
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
    const first = evaluate(family, shinagawaRuleSet);
    const second = evaluate(family, shinagawaRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
