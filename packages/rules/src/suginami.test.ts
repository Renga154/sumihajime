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
 * なぜ: Step4-A 杉並区(13115)縦切りデータの来歴・型・決定論・自治体差分をCIで機械検証する。
 * 杉並は2026-07-25に人手レビュー承認(ユーザー決裁「2区とも承認」)済みで、「収集曜日を作らない
 * 誠実縮退」を含むため、既存3区と異なる次の点を固定する:
 * (a) 全手続きが dataStatus=verified(2026-07-25承認)で、公開ゲート(ADR-007)の対象
 * (b) waste.json(収集曜日)を作らない(=ファイルが存在しない)ことの回帰ガード(承認後も恒久的)
 * (c) waste-sorting.json(分別辞書)は整備済みで、杉並固有の「注意点」列が notes に統合されている
 * (d) 施設は窓口系7件(本庁舎1+区民事務所6)。事前調査の『区民事務所7件』を6件へ訂正した回帰ガード
 * (e) 自治体差分: マイナンバー継続利用=90日(世田谷/新宿の14日と相違)/子ども医療=15日遡及
 *     (世田谷/新宿の3か月と相違)/学校の交付書類名=『転入学通知書』(世田谷『学校指定通知書』と相違)
 * (f) ペルソナ別評価・越境・sourceIds実在・決定論(既存3区テストと同型)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const suginamiRulesRaw = readJson('packages/rules/data/13115/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const shinjukuRulesRaw = readJson('packages/rules/data/13104/rules.json');
const proceduresRaw = readJson('data/normalized/13115/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13115/facilities.json') as {
  facilities: unknown[];
};
const wasteSortingRaw = readJson('data/normalized/13115/waste-sorting.json') as {
  items: unknown[];
};

const suginamiRuleSet: RuleSet = ruleSetSchema.parse(suginamiRulesRaw);
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

const SUGINAMI = '13115';

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
      municipalityCode: overrides.municipalityCode ?? SUGINAMI,
      town: overrides.town ?? '阿佐谷南',
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

describe('Suginami (13115) — schema validation & approved status (CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13115, 10 rules, ruleVersion 2026-07-25.1', () => {
    expect(suginamiRuleSet.municipalityCode).toBe(SUGINAMI);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    // 2026-09-25: 子ども医療費の遡及期限の変更(再監査)で版を上げた。
    expect(suginamiRuleSet.ruleVersion).toBe('2026-09-25.1');
    // 2026-08-07 人手レビュー承認(ADR-009)。publishedRuleVersion は除去済みで、
    // ruleVersion がそのまま公開版になる(ADR-007)。
    expect(suginamiRuleSet.publishedRuleVersion).toBeUndefined();
    expect(suginamiRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      suginamiRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 verified(2026-07-25人手レビュー承認)', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(SUGINAMI);
      // 2026-07-25 人手レビュー承認(ユーザー決裁「2区とも承認」)によりverified(ADR-007の公開単位)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe(
        expectedLastVerifiedAt(SUGINAMI, pv.id, '2026-07-25T00:00:00Z'),
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
    const ruleIds = suginamiRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口系7件(本庁舎1+区民事務所6)parse; 事前調査の『区民事務所7件』を6件へ訂正', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(7);
    for (const f of facilities) expect(f.municipalityCode).toBe(SUGINAMI);
    const honcho = facilities.filter((f) => f.category === '本庁舎');
    const kumin = facilities.filter((f) => f.category === '区民事務所');
    expect(honcho).toHaveLength(1);
    // 出典CSV・区公式の区民事務所一覧のいずれでも区民事務所は6件(阿佐谷は本庁舎が直接管轄)。
    expect(kumin).toHaveLength(6);
    // 本庁舎はCSVに窓口行が無いため公式ページ(facilities-002)から補完(緯度経度は未設定=捏造回避)。
    expect(honcho[0]?.sourceId).toBe('src-13115-facilities-002');
    expect(honcho[0]?.lat).toBeUndefined();
    // 区民事務所は出典CSV由来で緯度経度を持つ。
    for (const f of kumin) {
      expect(f.sourceId).toBe('src-13115-facilities-001');
      expect(typeof f.lat).toBe('number');
    }
    const names = facilities.map((f) => f.name);
    expect(names.some((n) => n.includes('杉並区役所'))).toBe(true);
    expect(names.some((n) => n.includes('井草区民事務所'))).toBe(true);
  });

  it('waste.json(収集曜日)は作らない — 誠実縮退の回帰ガード(第三者SaaS依存で機械取得不可)', () => {
    // なぜ: 杉並の収集曜日はコグモ(第三者SaaS)のJSウィジェット依存で機械取得不可のため、
    // 収集曜日データを捏造・無理に構造化しない。waste.json が存在しないことを固定する。
    expect(existsSync(resolve(repoRoot, 'data/normalized/13115/waste.json'))).toBe(false);
    // 代わりに procedure_waste_check が公式の収集曜日検索ツール・全域PDFへ誘導する。
    const wasteProc = parseProcedures().find((p) => p.id === 'procedure_waste_check');
    expect(wasteProc?.onlineUrl).toContain('city.suginami.tokyo.jp');
    expect(wasteProc?.dueDescription).toContain('収集曜日検索');
  });

  it('waste-sorting.json — 分別辞書がparse; 杉並固有の「注意点」列が notes に統合されている', () => {
    const items = parseSorting();
    expect(items.length).toBeGreaterThan(100);
    for (const i of items) {
      expect(i.municipalityCode).toBe(SUGINAMI);
      expect(i.sourceId).toBe('src-13115-waste_sorting-001');
    }
    // 3区では空欄だった「注意点」列(例:『最大辺がおおむね30cm…は粗大ごみです』)が notes に入る。
    const withCaution = items.filter((i) => i.notes?.includes('30cm'));
    expect(withCaution.length).toBeGreaterThan(0);
  });
});

describe('Suginami (13115) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, suginamiRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    const jusho = outcomeFor(single, suginamiRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, suginamiRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('国保: フラグONで moveDate+14日、OFFで非該当', () => {
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, suginamiRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
    const off = profile({ flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, suginamiRuleSet, 'procedure_national_health_insurance').applicable).toBe(
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
    const added = applicableIds(family, suginamiRuleSet).filter(
      (id) => !applicableIds(single, suginamiRuleSet).includes(id),
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
    expect(outcomeFor(flagOnly, suginamiRuleSet, 'procedure_school_transfer').applicable).toBe(
      'applicable',
    );
    expect(
      outcomeFor(flagOnly, suginamiRuleSet, 'procedure_childcare_application').applicable,
    ).toBe('applicable');
  });

  it('犬あり・マイクロチップ不明: needs_confirmation(C-10, 推測しない)/ 装着済み=非該当 / 未装着=該当', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, suginamiRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, suginamiRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, suginamiRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 杉並は転入変更の日数期限の記載が無いため dueDate は出さない(dueDescription のみ)。
    expect(dog.dueDate).toBeUndefined();
  });
});

describe('Suginami (13115) — 自治体差分の実証(他区の値を混入させない)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const setagayaWithCard = profile({
    municipalityCode: '13112',
    town: '世田谷4丁目',
    flags: { hasMyNumberCard: true },
  });

  it('マイナンバー継続利用: 杉並・世田谷とも住み始めた日+14日を算定(杉並の90日文言は据え置き)', () => {
    const suginami = outcomeFor(withCard, suginamiRuleSet, 'procedure_mynumber_continued_use');
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    // 杉並は「転入届を行った日が『転出予定日から30日、または新しい住所に住み始めてから14日を
    // 経過した日』を過ぎていた場合、マイナンバーカードは失効」と明記しているため14日を算定する。
    // 90日そのものは転入届日起算のため算定しない。
    expect(suginami.dueDate).toBe('2026-08-15');
    expect(
      suginamiRuleSet.rules.find((r) => r.procedureId === 'procedure_mynumber_continued_use')
        ?.dueDescription,
    ).toContain('90日');
    expect(setagaya.dueDate).toBe('2026-08-15');
  });

  it('子ども医療費の遡及: 杉並=2026-10-01以降は3カ月(日付は算定しない・9/30までの15日は注意事項) / 世田谷=3か月', () => {
    const family = (code: string, town: string, rs: RuleSet) =>
      outcomeFor(
        profile({
          municipalityCode: code,
          town,
          memberCount: 3,
          ageBands: ['elementary', 'adult'],
          flags: { hasMyNumberCard: true, needsNationalPension: false },
        }),
        rs,
        'procedure_child_medical',
      );
    const suginami = family('13115', '阿佐谷南', suginamiRuleSet);
    const setagaya = family('13112', '世田谷4丁目', setagayaRuleSet);
    // 2026-09-25 再監査: 杉並の公式ページが「出生日・転入日が令和8年10月1日以降は翌日から3カ月以内」に
    // 変わった(9月30日までは従来の15日)。月単位は日付を算定しない方針(他の3か月の区と同じ)のため期日なし。
    // 比較ページが3か月の区として数えるよう、期限の本文は10月1日以降の値だけにし、15日は注意事項へ移した。
    expect(suginami.dueDate).toBeUndefined();
    const suginamiRule = suginamiRuleSet.rules.find(
      (r) => r.procedureId === 'procedure_child_medical',
    );
    expect(suginamiRule?.dueRule).toEqual({ type: 'unknown' });
    expect(suginamiRule?.dueDescription).toContain('令和8年10月1日以降');
    expect(suginamiRule?.dueDescription).toContain('3カ月以内');
    expect(suginamiRule?.dueDescription).not.toContain('15日');
    // 世田谷は月単位(3か月)のため日付は算定せず、公式文言のまま出す。
    expect(setagaya.dueDate).toBeUndefined();
    expect(setagaya.dueDescription).toContain('3か月');
  });

  it('学校の交付書類名: 杉並=『転入学通知書』(世田谷『学校指定通知書』を混入させない)', () => {
    const school = outcomeFor(
      profile({ ageBands: ['elementary', 'adult'], memberCount: 2 }),
      suginamiRuleSet,
      'procedure_school_transfer',
    );
    expect(school.dueDescription).toContain('転入学通知書');
    expect(school.dueDescription).not.toContain('学校指定通知書');
  });
});

describe('Suginami (13115) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of suginamiRuleSet.rules) {
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

  it('越境: 13115プロフィール × 13112/13104ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: SUGINAMI });
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
    const first = evaluate(family, suginamiRuleSet);
    const second = evaluate(family, suginamiRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
