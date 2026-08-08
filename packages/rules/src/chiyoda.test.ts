import { existsSync, readFileSync } from 'node:fs';
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

/**
 * なぜ: Step4-B 千代田区(13101)縦切りデータの来歴・型・決定論・自治体差分・「誠実縮退」を
 * CIで機械検証する。
 * (a) rules/procedures/facilities/waste-sorting が全て @tmn/schemas でparse成功
 * (b) 2026-07-25 人手レビュー承認済み(dataStatus=verified / reviewStatus=approved)
 *     であることの回帰ガード(公開ゲートは approved ソースのみ通過)
 * (c) 誠実縮退: 収集曜日は公式PDFのみのため waste.json を作らない。waste_check手続きは
 *     公式カレンダー(PDF)とアプリ「分けちよ！」へ誘導し、収集曜日データを持たないことを実証
 * (d) ペルソナ別評価で子育て世帯の該当増加を明示アサート
 * (e) 4自治体差分: マイナンバー継続利用の期限(千代田=90日=江東と同じ・新宿/世田谷=14日算定)、
 *     子ども医療費の遡及(千代田=3か月=世田谷/新宿・江東は記載なし)を実証(デモの根拠)
 * (f) 越境(13101プロフィール×他区ルール)がエラー
 * (g) 全ルール・全公開物のsourceIdsがregistry.csvに実在
 * (h) 決定論
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const chiyodaRulesRaw = readJson('packages/rules/data/13101/rules.json');
const shinjukuRulesRaw = readJson('packages/rules/data/13104/rules.json');
const kotoRulesRaw = readJson('packages/rules/data/13108/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const proceduresRaw = readJson('data/normalized/13101/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13101/facilities.json') as {
  facilities: unknown[];
};
const sortingRaw = readJson('data/normalized/13101/waste-sorting.json') as {
  items: unknown[];
};

const chiyodaRuleSet: RuleSet = ruleSetSchema.parse(chiyodaRulesRaw);
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
const parseSortingItems = () => sortingRaw.items.map((x) => wasteSortingItemSchema.parse(x));

const CHIYODA = '13101';

/**
 * なぜ: 千代田(13101)固定のプロフィールを組み立てるヘルパー。町名は千代田区の実在町名を採用。
 * destinationのmunicipalityCodeを差し替えられるようにし、自治体差分テストで他区版も作る。
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
      municipalityCode: overrides.municipalityCode ?? CHIYODA,
      town: overrides.town ?? '九段南',
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

describe('Chiyoda (13101) — schema validation (来歴・型検証; CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13101, 10 rules, ruleVersion 2026-07-25.1, publishedRuleVersion未指定', () => {
    expect(chiyodaRuleSet.municipalityCode).toBe(CHIYODA);
    expect(chiyodaRuleSet.ruleVersion).toBe('2026-08-06.1');
    // 2026-08-07 人手レビュー承認(ADR-009)。publishedRuleVersion は除去済みで、
    // ruleVersion がそのまま公開版になる(ADR-007)。
    expect(chiyodaRuleSet.publishedRuleVersion).toBeUndefined();
    expect(chiyodaRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      chiyodaRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 2026-07-25人手レビュー承認済み(verified)+ sourceIds + lastVerifiedAt', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(CHIYODA);
      // 2026-07-25 人手レビュー承認済み(公開ゲートは approved ソースのみ通過=ADR-007)。
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe('2026-07-25T00:00:00Z');
      // dueDateは静的には持たず、dueDescription(公式文言)のみ(実行時にルールが算定)。
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it('procedures と rules は同一の10 procedureId を過不足なく覆う', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = chiyodaRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口系7件(本庁舎1+出張所6)parse; 事務室・ストックヤード・倉庫等は非混入; 座標は捏造しない', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(7);
    for (const f of facilities) expect(f.municipalityCode).toBe(CHIYODA);
    const cats = new Set(facilities.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    expect(cats.has('出張所')).toBe(true);
    expect(facilities.filter((f) => f.category === '本庁舎')).toHaveLength(1);
    // 千代田区の出張所は6か所(麹町/富士見/神保町/神田公園/万世橋/和泉橋。区民館併設)。
    expect(facilities.filter((f) => f.category === '出張所')).toHaveLength(6);
    for (const base of ['麹町', '富士見', '神保町', '神田公園', '万世橋', '和泉橋']) {
      expect(facilities.some((f) => f.name.startsWith(`${base}出張所`))).toBe(true);
    }
    // 事務室・ストックヤード・防災備蓄倉庫・旧出張所等の非窓口行が混入していないこと。
    expect(facilities.some((f) => /事務室|ストックヤード|倉庫|旧/.test(f.name))).toBe(false);
    // 出典CSVは緯度経度が全行空欄のため、7施設とも座標を持たない(捏造回避の回帰ガード)。
    for (const f of facilities) {
      expect(f.lat === undefined || f.lat === null).toBe(true);
      expect(f.lng === undefined || f.lng === null).toBe(true);
    }
  });

  it('waste-sorting.json — 446品目(自治体標準オープンデータ)parse; 品目名とカテゴリが入れ替わっていない', () => {
    const items = parseSortingItems();
    expect(items.length).toBe(446);
    for (const i of items) {
      expect(i.municipalityCode).toBe(CHIYODA);
      expect(i.sourceId).toBe('src-13101-waste_sorting-001');
    }
    // 「アルミホイル」は品目名(name)であり分別区分(category)ではない(itemCategorySwapped不要の回帰ガード)。
    const alumi = items.find((i) => i.name === 'アルミホイル');
    expect(alumi).toBeDefined();
    expect(alumi?.category).toBe('燃やさないごみ');
  });
});

describe('Chiyoda (13101) — 誠実縮退(収集曜日は公式PDFのみ→waste.jsonを作らない)', () => {
  it('waste.json は存在しない(推測で収集曜日を作らない=誠実縮退)', () => {
    expect(existsSync(resolve(repoRoot, 'data/normalized/13101/waste.json'))).toBe(false);
  });

  it('waste_check手続きは収集曜日データを持たず、公式カレンダー(PDF)とアプリ「分けちよ！」へ誘導する', () => {
    const waste = parseProcedures().find((p) => p.id === 'procedure_waste_check');
    expect(waste).toBeDefined();
    expect(waste?.canonicalType).toBe('waste_schedule');
    // 収集曜日は算定しない(dueDateなし)。公式カレンダー/アプリへの誘導を文言で担保。
    expect(waste?.dueDate).toBeUndefined();
    const text = `${waste?.dueDescription ?? ''}\n${(waste?.cautions ?? []).join('\n')}`;
    expect(text).toContain('収集カレンダー');
    expect(text).toContain('分けちよ');
    // ごみ導線ページ(公式)を出典とし、オンライン導線URLを持つ。
    expect(waste?.sourceIds).toContain('src-13101-waste_guide-001');
    expect(waste?.onlineUrl).toContain('city.chiyoda.lg.jp');
  });

  it('waste_check の rule も dueRule=unknown(曜日を日付として出さない)', () => {
    const rule = chiyodaRuleSet.rules.find((r) => r.procedureId === 'procedure_waste_check');
    expect(rule?.dueRule.type).toBe('unknown');
  });
});

describe('Chiyoda (13101) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, chiyodaRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    // 転入届は urgent かつ moveDate+14日(新しい住所に引っ越してから14日以内)。
    const jusho = outcomeFor(single, chiyodaRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, chiyodaRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('子育て世帯(4人・未就学0-2+小学生): 児童手当・子ども医療・学校転入・保育 が増える', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const family = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const added = applicableIds(family, chiyodaRuleSet).filter(
      (id) => !applicableIds(single, chiyodaRuleSet).includes(id),
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
    expect(outcomeFor(off, chiyodaRuleSet, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, chiyodaRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
  });

  it('犬あり・マイクロチップ不明: needs_confirmation(C-10, 推測しない)/ 装着済み=非該当 / 未装着=該当かつ dueDate無し(千代田は日数の期限記載なし)', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, chiyodaRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, chiyodaRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, chiyodaRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 千代田の転入(住所変更)ページには狂犬病予防法の「30日以内」の日数明記が無い→日付を算定しない
    // (新宿は30日を算定=自治体差分)。
    expect(dog.dueDate).toBeUndefined();
  });
});

describe('Chiyoda (13101) — 4自治体差分の実証(デモの根拠)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const shinjukuWithCard = profile({
    municipalityCode: '13104',
    town: '愛住町',
    flags: { hasMyNumberCard: true },
  });
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

  it('マイナンバー継続利用の期限(4区比較): 千代田=90日文言(dueDate無し) / 江東・新宿・世田谷=14日算定', () => {
    const chiyoda = outcomeFor(withCard, chiyodaRuleSet, 'procedure_mynumber_continued_use');
    const koto = outcomeFor(kotoWithCard, kotoRuleSet, 'procedure_mynumber_continued_use');
    const shinjuku = outcomeFor(
      shinjukuWithCard,
      shinjukuRuleSet,
      'procedure_mynumber_continued_use',
    );
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );

    // 千代田だけは日付を出さない。公式ページがカード失効の条件として挙げているのは
    // 「転入手続きをした日から90日」だけで、その起算日(=転入届を出した日)を本サービスは知らない。
    // 引越し日から14日以内という記載はあるが、千代田はそれをカード失効の条件として書いていない。
    expect(chiyoda.dueDate).toBeUndefined();
    expect(chiyoda.dueDescription).toContain('90日');
    // 江東・新宿・世田谷は「住み始めた日から14日以内に転入届をしないとカードが失効する」と
    // 明記しているため moveDate+14日を算定する。
    expect(koto.dueDate).toBe('2026-08-15');
    expect(shinjuku.dueDate).toBe('2026-08-15');
    expect(setagaya.dueDate).toBe('2026-08-15');
    // 同一手続きでも4区で結果が一様でないこと(千代田≠新宿の差をデモで見せられる)。
    expect(chiyoda.dueDate).not.toBe(shinjuku.dueDate);
  });

  it('子ども医療費助成の期限文言(4区比較): 千代田=3か月 / 世田谷=3か月 / 新宿=3ヶ月 / 江東=3か月記載なし', () => {
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
    const chiyoda = family('13101', '九段南', chiyodaRuleSet);
    const setagaya = family('13112', '世田谷4丁目', setagayaRuleSet);
    const shinjuku = family('13104', '愛住町', shinjukuRuleSet);
    const koto = family('13108', '青海', kotoRuleSet);

    // 千代田は3か月遡及の公式文言を保持(いずれも日数固定ではないため dueDate は出さない)。
    expect(chiyoda.dueDate).toBeUndefined();
    expect(chiyoda.dueDescription).toContain('3か月');
    expect(setagaya.dueDescription).toContain('3か月');
    expect(shinjuku.dueDescription).toContain('3ヶ月');
    // 江東は本ページに遡及期限の記載が無いため「3か月/3ヶ月」を持ち込まない(混入回避)。
    expect(koto.dueDescription).not.toContain('3か月');
    expect(koto.dueDescription).not.toContain('3ヶ月');
  });

  it('同一プロフィール(子育て)で4区とも学校転入・保育が該当する(条件式は全区共通)', () => {
    const family = (code: string, town: string) => ({
      municipalityCode: code,
      town,
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'] as Profile['household']['ageBands'],
      flags: { hasMyNumberCard: true, needsNationalPension: false },
    });
    const chiyodaIds = applicableIds(profile(family(CHIYODA, '九段南')), chiyodaRuleSet);
    const shinjukuIds = applicableIds(profile(family('13104', '愛住町')), shinjukuRuleSet);
    const kotoIds = applicableIds(profile(family('13108', '青海')), kotoRuleSet);
    const setagayaIds = applicableIds(profile(family('13112', '世田谷4丁目')), setagayaRuleSet);
    for (const ids of [chiyodaIds, shinjukuIds, kotoIds, setagayaIds]) {
      expect(ids).toContain('procedure_school_transfer');
      expect(ids).toContain('procedure_childcare_application');
    }
    // 4区とも同じ子育て該当集合になる(学校転入・保育の該当有無では区別できない)。
    expect(chiyodaIds).toEqual(shinjukuIds);
    expect(chiyodaIds).toEqual(kotoIds);
    expect(chiyodaIds).toEqual(setagayaIds);
  });
});

describe('Chiyoda (13101) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of chiyodaRuleSet.rules) {
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
    for (const i of parseSortingItems()) expect(registeredIds.has(i.sourceId)).toBe(true);
  });

  it('越境: 13101プロフィール × 13104/13108/13112ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: CHIYODA });
    expect(() => evaluate(p, shinjukuRuleSet)).toThrow(MunicipalityScopeMismatchError);
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
    const first = evaluate(family, chiyodaRuleSet);
    const second = evaluate(family, chiyodaRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
