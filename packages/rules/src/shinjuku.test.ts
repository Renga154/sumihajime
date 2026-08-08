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
 * なぜ: T-016 新宿区(13104)縦切りデータ(第3のデータ形式=HTML表収集曜日)の来歴・型・
 * 決定論・自治体差分をCIで機械検証する。
 * (a) rules/procedures/facilities/waste が全て @tmn/schemas でparse成功
 * (b) 2026-07-22 人手レビュー承認済み(dataStatus=verified)であることの回帰ガード
 * (c) ペルソナ別評価で子育て世帯の該当増加を明示アサート
 * (d) 3自治体差分: 同一プロフィールで 13112/13108/13104 のマイナンバー期限・子ども医療費・
 *     犬の届出期限が異なることの実証(デモの根拠)
 * (e) 越境(13104プロフィール×他区ルール)がエラー
 * (f) 全ルール・全公開物のsourceIdsがregistry.csvに実在
 * (g) 決定論
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const shinjukuRulesRaw = readJson('packages/rules/data/13104/rules.json');
const kotoRulesRaw = readJson('packages/rules/data/13108/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const proceduresRaw = readJson('data/normalized/13104/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13104/facilities.json') as {
  facilities: unknown[];
};
const wasteRaw = readJson('data/normalized/13104/waste.json') as {
  wasteAreas: unknown[];
  wasteSchedules: unknown[];
};

const shinjukuRuleSet: RuleSet = ruleSetSchema.parse(shinjukuRulesRaw);
const kotoRuleSet: RuleSet = ruleSetSchema.parse(kotoRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);

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
const parseAreas = () => wasteRaw.wasteAreas.map((x) => wasteAreaSchema.parse(x));
const parseSchedules = () => wasteRaw.wasteSchedules.map((x) => wasteScheduleSchema.parse(x));

const SHINJUKU = '13104';

/**
 * なぜ: 新宿(13104)固定のプロフィールを組み立てるヘルパー。町名は収集日HTML表の
 * area_label('愛住町')を採用。destinationのmunicipalityCodeを差し替えられるようにし、
 * 自治体差分テストで13112/13108版も作る。
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
      municipalityCode: overrides.municipalityCode ?? SHINJUKU,
      town: overrides.town ?? '愛住町',
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

describe('Shinjuku (13104) — schema validation (来歴・型検証; CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13104, 10 rules, ruleVersion 2026-07-22.1', () => {
    expect(shinjukuRuleSet.municipalityCode).toBe(SHINJUKU);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    expect(shinjukuRuleSet.ruleVersion).toBe('2026-08-09.1');
    // 2026-08-07 人手レビュー承認(ADR-009)。publishedRuleVersion は除去済みで、
    // ruleVersion がそのまま公開版になる(ADR-007)。
    expect(shinjukuRuleSet.publishedRuleVersion).toBeUndefined();
    expect(shinjukuRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      shinjukuRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 2026-07-22人手レビュー承認済み(verified)+ sourceIds + lastVerifiedAt', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(SHINJUKU);
      // 2026-07-22 人手レビュー承認済み(公開ゲートは approved ソースのみ通過)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-07-22T00:00:00Z');
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it('procedures と rules は同一の10 procedureId を過不足なく覆う', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = shinjukuRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口系11件(本庁舎1+特別出張所10、若松町込み)parse; 第一分庁舎・非窓口は非混入', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(11);
    for (const f of facilities) expect(f.municipalityCode).toBe(SHINJUKU);
    const cats = new Set(facilities.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    expect(cats.has('特別出張所')).toBe(true);
    // 本庁舎はちょうど1件(新宿区役所)。特別出張所は出典CSVの9件+公式ページ補完の若松町1件=10件。
    expect(facilities.filter((f) => f.category === '本庁舎')).toHaveLength(1);
    expect(facilities.filter((f) => f.category === '特別出張所')).toHaveLength(10);
    // 第一分庁舎(転入主窓口でない)・区民館・倉庫・集会所等が混入していないこと。
    expect(facilities.some((f) => /分庁舎|区民館|倉庫|集会所|ホール/.test(f.name))).toBe(false);
    // 若松町特別出張所は出典CSVに欠落していたため、2026-07-22人手レビュー時に区公式サイトの
    // 特別出張所一覧ページから補完済み(docs/research/opendata-gaps.md参照)。
    expect(facilities.some((f) => /若松/.test(f.name))).toBe(true);
  });

  it('waste.json — 171地区 / 665収集レコード(HTML表由来)parse; 令和8年度で effectiveTo を明示', () => {
    const areas = parseAreas();
    const schedules = parseSchedules();
    expect(areas.length).toBe(171);
    // 資源167 + 燃やす332 + 金属166 = 665(「*」商業地区は生成しない)。
    expect(schedules.length).toBe(665);
    for (const s of schedules) {
      expect(s.effectiveFrom).toBe('2026-04-01');
      // 江東(年度追従未確認でeffectiveTo無し)と異なり、令和8年度版明記のため上限を設定できる。
      expect(s.effectiveTo).toBe('2027-03-31');
      expect(s.sourceId).toBe('src-13104-waste_schedule-001');
    }
    // 金属・陶器・ガラスは weekOfMonth を保持(江東の「隔週(週指定なし)」との差)。
    const metal = schedules.filter((s) => s.wasteType === '金属・陶器・ガラスごみ');
    expect(metal.length).toBe(166);
    for (const s of metal) {
      const key = s.weekOfMonth?.join(',');
      expect(key === '1,3' || key === '2,4').toBe(true);
    }
    // 資源・燃やすは weekOfMonth を持たない。
    for (const s of schedules.filter((s) => s.wasteType !== '金属・陶器・ガラスごみ')) {
      expect(s.weekOfMonth).toBeUndefined();
    }
    // area_label は重複なし。愛住町を含む。
    const labels = areas.map((a) => a.areaLabel);
    expect(labels).toContain('愛住町');
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('Shinjuku (13104) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, shinjukuRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日(引越ししてきた日から14日以内)。
    const jusho = outcomeFor(single, shinjukuRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, shinjukuRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('子育て世帯(4人・未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, shinjukuRuleSet).filter(
      (id) => !applicableIds(single, shinjukuRuleSet).includes(id),
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

  it('国保フラグOFFで国保タスクが消える(負例)/ ONで moveDate+14日', () => {
    const off = profile({ flags: { hasMyNumberCard: false, needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, shinjukuRuleSet, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, shinjukuRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
  });

  it('犬あり・マイクロチップ不明: needs_confirmation(C-10, 推測しない)/ 装着済み=非該当 / 未装着=該当かつ moveDate+30日', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, shinjukuRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, shinjukuRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, shinjukuRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 新宿は狂犬病予防法の「30日以内」を算定(江東は日数の記載なし=dueDate無し)。
    expect(dog.dueDate).toBe('2026-08-31');
  });
});

describe('Shinjuku (13104) — 3自治体差分の実証(デモの根拠)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const kotoWithCard = profile({
    municipalityCode: '13108',
    town: '青海',
    flags: { hasMyNumberCard: true },
  });
  const setagayaWithCard = profile({
    municipalityCode: '13112',
    town: '世田谷4丁目',
    flags: { hasMyNumberCard: true },
  });

  it('マイナンバー継続利用の期限(3区比較): 3区とも14日算定。90日を明記するのは江東だけ', () => {
    const shinjuku = outcomeFor(withCard, shinjukuRuleSet, 'procedure_mynumber_continued_use');
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    const koto = outcomeFor(kotoWithCard, kotoRuleSet, 'procedure_mynumber_continued_use');

    // 3区とも「住み始めた日から14日以内に転入届をしないとカードが失効する」と明記しているため
    // moveDate+14日を算定する。
    expect(shinjuku.dueDate).toBe('2026-08-15');
    expect(setagaya.dueDate).toBe('2026-08-15');
    expect(koto.dueDate).toBe('2026-08-15');
    // 残る差: 継続利用そのものの期限(転入届出日から90日)を書いているのは江東だけ。
    const dueTextOf = (rs: RuleSet) =>
      rs.rules.find((r) => r.procedureId === 'procedure_mynumber_continued_use')?.dueDescription ??
      '';
    expect(dueTextOf(kotoRuleSet)).toContain('90日');
    expect(dueTextOf(shinjukuRuleSet)).not.toContain('90日');
    expect(dueTextOf(setagayaRuleSet)).not.toContain('90日');
  });

  it('子ども医療費助成の期限文言(3区比較): 世田谷=3か月 / 新宿=3ヶ月 / 江東=3か月記載なし', () => {
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
    const shinjuku = family('13104', '愛住町', shinjukuRuleSet);
    const setagaya = family('13112', '世田谷4丁目', setagayaRuleSet);
    const koto = family('13108', '青海', kotoRuleSet);

    // 新宿は3ヶ月遡及の公式文言を保持(いずれも日数固定ではないため dueDate は出さない)。
    expect(shinjuku.dueDate).toBeUndefined();
    expect(shinjuku.dueDescription).toContain('3ヶ月');
    expect(setagaya.dueDescription).toContain('3か月');
    // 江東は本ページに遡及期限の記載が無いため「3か月/3ヶ月」を持ち込まない(混入回避)。
    expect(koto.dueDescription).not.toContain('3か月');
    expect(koto.dueDescription).not.toContain('3ヶ月');
  });

  it('同一プロフィール(子育て)で3区(新宿・江東・世田谷)とも学校転入・保育が該当する(Step3で世田谷にも整備→差分解消の変化点)', () => {
    // なぜ: Step3(2026-07-25)以前は世田谷に school_childcare が未整備で「新宿・江東のみ該当」
    // という差分だった。Step3で世田谷にも procedure_school_transfer / childcare_application を
    // 追加(江東・新宿と同一の条件式)したため、同一の子育てプロフィールでは3区とも該当する。
    // この差分の「変化点」を回帰ガードとして固定する(残る自治体差分=マイナンバー期限等は別testで維持)。
    const family = (code: string, town: string) => ({
      municipalityCode: code,
      town,
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'] as Profile['household']['ageBands'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const shinjukuIds = applicableIds(profile(family(SHINJUKU, '愛住町')), shinjukuRuleSet);
    const kotoIds = applicableIds(profile(family('13108', '青海')), kotoRuleSet);
    const setagayaIds = applicableIds(profile(family('13112', '世田谷4丁目')), setagayaRuleSet);
    for (const ids of [shinjukuIds, kotoIds, setagayaIds]) {
      expect(ids).toContain('procedure_school_transfer');
      expect(ids).toContain('procedure_childcare_application');
    }
    // 3区とも同じ子育て該当集合になる(学校転入・保育の該当有無ではもはや区別できない)。
    expect(setagayaIds).toEqual(shinjukuIds);
    expect(setagayaIds).toEqual(kotoIds);
  });
});

describe('Shinjuku (13104) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of shinjukuRuleSet.rules) {
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
    for (const s of parseSchedules()) expect(registeredIds.has(s.sourceId)).toBe(true);
  });

  it('越境: 13104プロフィール × 13108/13112ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: SHINJUKU });
    expect(() => evaluate(p, kotoRuleSet)).toThrow(MunicipalityScopeMismatchError);
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
    const first = evaluate(family, shinjukuRuleSet);
    const second = evaluate(family, shinjukuRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
