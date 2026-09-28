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
 * なぜ: Batch6-A 板橋区(13119)縦切りデータの来歴・型・決定論・自治体差分をCIで機械検証する。
 * 板橋は2026-08-07に人手レビュー承認(ユーザー決裁「2区とも承認」)済みで、既存7区に無い期限値を
 * 2つ持つため、次の点を固定する:
 * (a) 全手続きが dataStatus=verified(2026-08-07承認)で、公開ゲート(ADR-007)の対象。
 *     自治体以外(ライフライン等)の手続き4件(ADR-009)を含め14件
 * (b) waste.json(収集曜日)は作らない(誠実縮退)。都カタログに町名別収集曜日CSVが無く、
 *     ゴミ集積所一覧CSVも実データ1行のみのため、推測で曜日を作らない(承認後も恒久的な誠実縮退)
 * (c) waste-sorting.json(分別辞書)は1,125品目を整備。他区と列構成が異なり「料金種別」を持たず
 *     「粗大ごみ回収料金」から feeNote を生成している(bulkyFeeAmountAsFeeNote)
 * (d) 施設は本庁舎1階+区民事務所6件の計7件。公共施設一覧CSVがExcel由来の破損(ID列全行同一値・
 *     番地列の42.7%が日付誤変換)を抱えるため不採用とし、公式ページの住所を採用=座標なし
 * (e) **既存7区に無い板橋固有の期限**: 子ども医療費助成の遡及=原則14日以内
 *     (千代田/世田谷/新宿=3か月・杉並=15日・品川/大田=6か月・練馬=記載なし)/
 *     犬の登録事項変更=30日以内(既存7区はいずれも転入時の日数期限の記載が無く unknown だった)。
 *     起算日の法的根拠として狂犬病予防法第4条第4項を procedures.json の caution に明記した
 *     (ユーザー決裁により他区へは展開しない=板橋固有のまま)
 * (f) 学校転入ソース(src-13119-school_transfer-001)はページ更新日2020-03-06と他P0出典より
 *     古いことを caution に明記のうえ公開する
 * (g) ペルソナ別評価・越境・sourceIds実在・決定論(既存区テストと同型)。ライフライン4件そのものの
 *     検証は non-municipal.test.ts が全区横断で行うため、本ファイルの区固有アサーションは
 *     区の手続き10件を対象にする(NON_MUNICIPAL_IDS で除外)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const itabashiRulesRaw = readJson('packages/rules/data/13119/rules.json');
const setagayaRulesRaw = readJson('packages/rules/data/13112/rules.json');
const suginamiRulesRaw = readJson('packages/rules/data/13115/rules.json');
const nerimaRulesRaw = readJson('packages/rules/data/13120/rules.json');
const proceduresRaw = readJson('data/normalized/13119/procedures.json') as {
  procedures: unknown[];
};
const facilitiesRaw = readJson('data/normalized/13119/facilities.json') as {
  facilities: unknown[];
};
const wasteSortingRaw = readJson('data/normalized/13119/waste-sorting.json') as {
  items: unknown[];
};

const itabashiRuleSet: RuleSet = ruleSetSchema.parse(itabashiRulesRaw);
const setagayaRuleSet: RuleSet = ruleSetSchema.parse(setagayaRulesRaw);
const suginamiRuleSet: RuleSet = ruleSetSchema.parse(suginamiRulesRaw);
const nerimaRuleSet: RuleSet = ruleSetSchema.parse(nerimaRulesRaw);

const parseProcedures = () => proceduresRaw.procedures.map((x) => procedureVersionSchema.parse(x));
const parseFacilities = () => facilitiesRaw.facilities.map((x) => facilitySchema.parse(x));
const parseSorting = () => wasteSortingRaw.items.map((x) => wasteSortingItemSchema.parse(x));

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

const ITABASHI = '13119';

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: {
      municipalityCode: overrides.municipalityCode ?? ITABASHI,
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

describe('Itabashi (13119) — schema validation & approved status (CI gate)', () => {
  it('rules.json parses as a RuleSet, scoped to 13119, 14 rules, ruleVersion 2026-08-07.1', () => {
    expect(itabashiRuleSet.municipalityCode).toBe(ITABASHI);
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    // 手続き(procedures.json)の内容は変えていないため ProcedureVersion.version は据え置き。
    expect(itabashiRuleSet.ruleVersion).toBe('2026-08-09.1');
    // ADR-007: 承認後は publishedRuleVersion を持たず、ruleVersion がそのまま公開版になる。
    expect(itabashiRuleSet.publishedRuleVersion).toBeUndefined();
    expect(itabashiRuleSet.rules.length).toBe(14);
    // 内訳: 区の手続き10件 + 自治体以外(ライフライン等)4件(ADR-009)。
    expect(
      itabashiRuleSet.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId)),
    ).toHaveLength(10);
  });

  it('procedures.json — 10 ProcedureVersions parse; 全件 verified(2026-08-07人手レビュー承認)', () => {
    // 区の手続き10件のみを対象にする(ライフライン4件は non-municipal.test.ts が検証)。
    const procedures = parseMunicipalProcedures();
    expect(procedures.length).toBe(10);
    expect(parseProcedures()).toHaveLength(14);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(ITABASHI);
      expect(pv.dataStatus).toBe('verified');
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      expect(pv.lastVerifiedAt).toBe(
        expectedLastVerifiedAt('13119', pv.id, '2026-08-07T00:00:00Z'),
      );
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
      // 承認によりpending系のcaution文言は除去されている。
      expect(pv.cautions?.some((c) => c.includes('人手レビュー未了'))).toBe(false);
    }
  });

  it('犬の登録事項変更: 起算日の法的根拠(狂犬病予防法第4条第4項)を caution に明記している(板橋固有)', () => {
    const dog = parseMunicipalProcedures().find(
      (p) => p.id === 'procedure_dog_registration_transfer',
    )!;
    expect(dog.cautions?.some((c) => c.includes('狂犬病予防法第4条第4項'))).toBe(true);
  });

  it('学校転入ソースの現行性の古さ(2020-03-06)を caution に明記している(板橋固有)', () => {
    const school = parseMunicipalProcedures().find((p) => p.id === 'procedure_school_transfer')!;
    expect(school.cautions?.some((c) => c.includes('2020-03-06'))).toBe(true);
  });

  it('procedures と rules は同一の14 procedureId を過不足なく覆う', () => {
    const procIds = parseProcedures()
      .map((p) => p.id)
      .sort();
    const ruleIds = itabashiRuleSet.rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口系7件(本庁舎1+区民事務所6)parse; 破損CSVを避け公式ページ由来のため座標なし', () => {
    const facilities = parseFacilities();
    expect(facilities.length).toBe(7);
    for (const f of facilities) {
      expect(f.municipalityCode).toBe(ITABASHI);
      expect(f.sourceId).toBe('src-13119-facilities-001');
      // 公共施設一覧CSVはID列全行同一値・番地列42.7%がExcel日付誤変換で破損しているため不採用。
      // 公式ページには緯度経度が無いため座標は設定しない(捏造回避)。
      expect(f.lat).toBeUndefined();
      expect(f.lng).toBeUndefined();
      // 破損CSV由来の番地誤変換(例「5月20日」)が住所に混入していないこと。
      expect(f.address).not.toMatch(/\d+月\d+日/);
    }
    expect(facilities.filter((f) => f.category === '本庁舎')).toHaveLength(1);
    expect(facilities.filter((f) => f.category === '区民事務所')).toHaveLength(6);
    const names = facilities.map((f) => f.name);
    for (const n of ['仲町', '常盤台', '志村坂上', '蓮根', '下赤塚', '高島平']) {
      expect(names.some((name) => name.includes(n))).toBe(true);
    }
    expect(names.some((n) => /倉庫|集会所/.test(n))).toBe(false);
  });

  it('waste.json(収集曜日)は作らない — 機械判読可能なCSVが無いことによる誠実縮退の回帰ガード', () => {
    expect(existsSync(resolve(repoRoot, 'data/normalized/13119/waste.json'))).toBe(false);
    const wasteProc = parseProcedures().find((p) => p.id === 'procedure_waste_check');
    expect(wasteProc?.onlineUrl).toContain('city.itabashi.tokyo.jp');
    expect(wasteProc?.dueDescription).toContain('地域別カレンダー');
  });

  it('waste-sorting.json — 分別辞書の全品目がparseされ; 粗大ごみ回収料金が feeNote に反映されている', () => {
    const items = parseSorting();
    // なぜ件数を定数で固定しないか: 出典CSVの更新のたびにテストを書き換える羽目になる。
    // 「原本の行数と一致する(=parseで取りこぼさない)」というデータ由来の不変条件だけを見る。
    expect(items.length).toBe(wasteSortingRaw.items.length);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.municipalityCode).toBe(ITABASHI);
      expect(i.sourceId).toBe('src-13119-waste_sorting-001');
    }
    // 板橋CSVは「料金種別」(無料/有料)を持たず「粗大ごみ回収料金」(円)を持つため、
    // feeNote は『粗大ごみ回収料金 400円』の形式になる(他区の 無料/有料 とは別形式)。
    const withFee = items.filter((i) => i.feeNote !== undefined);
    const rawWithFee = (wasteSortingRaw.items as { feeNote?: string }[]).filter(
      (i) => i.feeNote !== undefined,
    );
    expect(withFee.length).toBe(rawWithFee.length);
    expect(withFee.length).toBeGreaterThan(0);
    for (const i of withFee) expect(i.feeNote).toMatch(/^粗大ごみ回収料金 \d+円$/);
    // 「注意点」列は全行空欄・「備考」列のみ実データを持つ。
    expect(items.filter((i) => i.notes && i.notes.length > 0).length).toBeGreaterThan(0);
  });
});

describe('Itabashi (13119) — persona evaluations', () => {
  it('単身・都外・マイナンバーあり: 転入届/マイナンバー/国保/年金/ごみ が該当、子育て・学校・保育・犬は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    expect(applicableIds(single, itabashiRuleSet)).toEqual(
      [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_waste_check',
        ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
      ].sort(),
    );
    const jusho = outcomeFor(single, itabashiRuleSet, 'procedure_resident_registration');
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15');
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, itabashiRuleSet, id).applicable).toBe('not_applicable');
    }
  });

  it('国保: フラグONで moveDate+14日、OFFで非該当', () => {
    const on = profile({ flags: { needsNationalHealthInsurance: true } });
    expect(outcomeFor(on, itabashiRuleSet, 'procedure_national_health_insurance').dueDate).toBe(
      '2026-08-15',
    );
    const off = profile({ flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, itabashiRuleSet, 'procedure_national_health_insurance').applicable).toBe(
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
    const added = applicableIds(family, itabashiRuleSet).filter(
      (id) => !applicableIds(single, itabashiRuleSet).includes(id),
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
    expect(outcomeFor(flagOnly, itabashiRuleSet, 'procedure_school_transfer').applicable).toBe(
      'applicable',
    );
    expect(
      outcomeFor(flagOnly, itabashiRuleSet, 'procedure_childcare_application').applicable,
    ).toBe('applicable');
  });

  it('犬あり・マイクロチップ不明: needs_confirmation / 装着済み=非該当 / 未装着=該当かつ moveDate+30日', () => {
    const unknown = profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } });
    const dogU = outcomeFor(unknown, itabashiRuleSet, 'procedure_dog_registration_transfer');
    expect(dogU.applicable).toBe('needs_confirmation');
    expect(dogU.applicabilityReason).toContain('マイクロチップ');

    const chipped = profile({ flags: { hasDog: true, dogHasMicrochip: true } });
    expect(
      outcomeFor(chipped, itabashiRuleSet, 'procedure_dog_registration_transfer').applicable,
    ).toBe('not_applicable');

    const noChip = profile({ flags: { hasDog: true, dogHasMicrochip: false } });
    const dog = outcomeFor(noChip, itabashiRuleSet, 'procedure_dog_registration_transfer');
    expect(dog.applicable).toBe('applicable');
    // 板橋区公式ページが『板橋区外から転入したとき』を含めて30日以内と明記しているため算定する。
    expect(dog.dueDate).toBe('2026-08-31');
  });
});

describe('Itabashi (13119) — 自治体差分の実証(他区の値を混入させない)', () => {
  const withCard = profile({ flags: { hasMyNumberCard: true } });
  const setagayaWithCard = profile({
    municipalityCode: '13112',
    flags: { hasMyNumberCard: true },
  });

  it('マイナンバー継続利用: 板橋・世田谷とも住み始めた日+14日を算定(板橋の90日文言は据え置き)', () => {
    // 板橋の公式ページは「転入届は住み始めた日から14日以内または転出予定日から30日以内の
    // どちらか早い期日まで。それまでに手続きできない場合…カードが失効」と明記している。
    // 90日(転入届出日起算)は算定できないが、この14日は引越し日から算定できる。
    const itabashi = outcomeFor(withCard, itabashiRuleSet, 'procedure_mynumber_continued_use');
    const setagaya = outcomeFor(
      setagayaWithCard,
      setagayaRuleSet,
      'procedure_mynumber_continued_use',
    );
    expect(itabashi.dueDate).toBe('2026-08-15');
    expect(setagaya.dueDate).toBe('2026-08-15');
    const itabashiDue = itabashiRuleSet.rules.find(
      (r) => r.procedureId === 'procedure_mynumber_continued_use',
    )?.dueDescription;
    expect(itabashiDue).toContain('90日以内');
    expect(itabashiDue).toContain('どちらか早い期日');
  });

  it('マイナンバー継続利用: 板橋は転出予定日が早いと「転出予定日+30日」を期日にする(区の"早い方"に従う)', () => {
    const early = { ...withCard, moveOutScheduledDate: '2026-07-05' };
    expect(outcomeFor(early, itabashiRuleSet, 'procedure_mynumber_continued_use').dueDate).toBe(
      '2026-08-04',
    );
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

  it('子ども医療費助成: 板橋=14日遡及(既存7区に無い値。3か月/15日/6か月を混入させない)', () => {
    // 2026-08-09: 板橋は「転入の場合は原則として14日以内の申請」と日数で明記しているため
    // moveDate+14日 を算定するようになった。算定できた区は outcome から dueDescription が
    // 落ちるため、公式文言は rules.json 側で検証する。
    const itabashi = family('13119', itabashiRuleSet, 'procedure_child_medical');
    expect(itabashi.dueDate).toBe('2026-08-15');
    const itabashiDue = itabashiRuleSet.rules.find(
      (r) => r.procedureId === 'procedure_child_medical',
    )?.dueDescription;
    expect(itabashiDue).toContain('14日以内');
    expect(itabashiDue).toContain('申立書');
    for (const other of ['3か月', '3ヶ月', '6か月', '6カ月', '15日']) {
      expect(itabashiDue).not.toContain(other);
    }
    // 対比: 杉並=3カ月(2026-10-01以降。2026-09-25 再監査で15日から変わった) / 世田谷=3か月 /
    // 練馬=記載なし。同じカテゴリでも区ごとに値が異なる。月単位の杉並は日付を算定しない。
    const suginami = family('13115', suginamiRuleSet, 'procedure_child_medical');
    expect(suginami.dueDate).toBeUndefined();
    expect(suginami.dueDescription).toContain('3カ月以内');
    expect(family('13112', setagayaRuleSet, 'procedure_child_medical').dueDescription).toContain(
      '3か月',
    );
    expect(family('13120', nerimaRuleSet, 'procedure_child_medical').dueDescription).toContain(
      '記載がない',
    );
  });

  it('犬の登録事項変更: 板橋=30日算定(既存7区・練馬はいずれも期限を出さない)', () => {
    const noChip = (code: string, rs: RuleSet) =>
      outcomeFor(
        profile({
          municipalityCode: code,
          flags: { hasDog: true, dogHasMicrochip: false },
        }),
        rs,
        'procedure_dog_registration_transfer',
      );
    expect(noChip('13119', itabashiRuleSet).dueDate).toBe('2026-08-31');
    expect(noChip('13120', nerimaRuleSet).dueDate).toBeUndefined();
    expect(noChip('13112', setagayaRuleSet).dueDate).toBeUndefined();
    expect(noChip('13115', suginamiRuleSet).dueDate).toBeUndefined();
  });

  it('学校転入: 板橋の交付書類名は『転入学通知書』(世田谷『学校指定通知書』・練馬『入学通知書』を混入させない)', () => {
    const school = family('13119', itabashiRuleSet, 'procedure_school_transfer');
    expect(school.dueDescription).toContain('転入学通知書');
    expect(school.dueDescription).not.toContain('学校指定通知書');
    // 板橋固有: 『教科書給与証明書』(練馬は『教科用図書給与証明書』と表記が異なる)。
    expect(school.dueDescription).toContain('教科書給与証明書');
    expect(school.dueDescription).not.toContain('教科用図書給与証明書');
  });

  it('児童手当: 板橋=15日特例の文言(起算日が転出予定日等のため dueDate は算定しない)', () => {
    const itabashi = family('13119', itabashiRuleSet, 'procedure_child_allowance');
    expect(itabashi.dueDescription).toContain('15日以内');
    expect(itabashi.dueDate).toBeUndefined();
  });
});

describe('Itabashi (13119) — provenance integrity & scope safety', () => {
  it('全ルール・全公開物の sourceIds が registry.csv に実在する行を指す', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    const registeredIds = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.slice(0, l.indexOf(','))),
    );
    for (const rule of itabashiRuleSet.rules) {
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

  it('区の手続きの sourceId は 13119 名前空間(他区のソースを参照しない)。ライフライン4件は共通ソース(src-13000-/src-00000-)を参照する', () => {
    const ids = [
      ...itabashiRuleSet.rules
        .filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId))
        .flatMap((r) => r.sourceIds),
      ...parseMunicipalProcedures().flatMap((p) => p.sourceIds),
      ...parseFacilities().map((f) => f.sourceId),
      ...parseSorting().map((i) => i.sourceId),
    ];
    for (const sid of ids) expect(sid.startsWith('src-13119-')).toBe(true);
    // ライフライン4件は区固有ソースを増やさず、既存7区と共通の承認済みソースのみを参照する。
    const nonMunicipalIds = parseProcedures()
      .filter((p) => NON_MUNICIPAL_IDS.includes(p.id))
      .flatMap((p) => p.sourceIds);
    for (const sid of nonMunicipalIds) expect(sid.startsWith('src-131')).toBe(false);
  });

  it('404の旧児童手当URLを台帳へ登録していない(現行URL 1063955 配下のみを使う)', () => {
    const csv = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
    // なぜ: notes 欄には「旧URLは404のため登録しない」という説明文として同じ文字列が現れうるため、
    // 単純な部分一致ではなく前後をカンマで挟んだ source_url セルとして一致するかを見る。
    // 2026-09-25: 1063955/1004634.html も404になり、同名ページが 1063955/1065840.html へ移った(再監査)。
    const dead = [
      ',https://www.city.itabashi.tokyo.jp/kosodate/teate/teate/1004634.html,',
      ',https://www.city.itabashi.tokyo.jp/kosodate/teate/teate/1063955/1004634.html,',
    ];
    const live = ',https://www.city.itabashi.tokyo.jp/kosodate/teate/teate/1063955/1065840.html,';
    for (const d of dead) expect(csv).not.toContain(d);
    expect(csv).toContain(live);
  });

  it('越境: 13119プロフィール × 13112/13115/13120ルールセット は必ず例外(誤適用防止)', () => {
    const p = profile({ municipalityCode: ITABASHI });
    expect(() => evaluate(p, setagayaRuleSet)).toThrow(MunicipalityScopeMismatchError);
    expect(() => evaluate(p, suginamiRuleSet)).toThrow(MunicipalityScopeMismatchError);
    expect(() => evaluate(p, nerimaRuleSet)).toThrow(MunicipalityScopeMismatchError);
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
    const first = evaluate(family, itabashiRuleSet);
    const second = evaluate(family, itabashiRuleSet);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
