import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasSourceSnapshots } from '@tmn/test-fixtures/source-snapshots';
import type { Profile, RuleSet } from '@tmn/schemas';
import {
  facilitySchema,
  procedureVersionSchema,
  ruleSetSchema,
  wasteSortingItemSchema,
} from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';
import { pickCurrentSnapshot } from '@tmn/drift';
import { expectedLastVerifiedAt, expectedVersion } from './reaudited.fixture.js';

/**
 * なぜ: Batch8(中央13102 / 港13103 / 文京13105 / 台東13106 / 墨田13107)の縦切りデータの来歴・型・
 * 決定論・**区ごとに異なる期限** をCIで機械検証する。ユーザー決裁(2026-08-07「23区全対応・案A=
 * 手続き中心で埋め、付帯データは取れる区だけ」)に基づく追加であり、本バッチで23区の実装が揃う。
 * 2026-08-07にユーザー決裁「5区とも承認」により人手レビュー承認され、区の全10手続きが
 * dataStatus=verified、対応する registry.csv のソースが review_status=approved へ更新された。
 * あわせて自治体以外(ライフライン等)の手続き4件(ADR-009)を共通テンプレートから追加し14件になった。
 *
 * 本バッチで特に固定したい不変条件:
 * (a) **子ども医療費助成の期限が区ごとに違う**: 港=15日 / 墨田=15日 / 文京=3ヶ月 / 台東=3ヶ月 /
 *     中央=公式ページに記載なし(要確認)。共通デフォルト値を作らない(CLAUDE.md原則3)。
 * (b) **港区・台東区はマイナンバーカード継続利用の失効期限が公式ページで確認できない**ため
 *     「未確認」と表示する。確認できた3区(中央・文京・墨田)の値をこの2区に当てはめない。
 * (c) 児童手当の15日特例は5区とも「前住所地の転出予定日」起算(台東区は起算日の定義自体が無い)の
 *     ため、いずれの区でも moveDate からは算定しない(dueDate を出さない)。
 * (d) 犬の届出期限も区で違う: 墨田=30日以内と明記(offsetDays 30)、他4区は日数記載なし(unknown)。
 * (e) 付帯データの誠実縮退: 5区とも waste.json は作らない。waste-sorting.json は墨田のみ。
 * (f) 公開ゲート(ADR-007): 5区の全ソースが registry.csv で approved であること。
 * (h) ライフライン4件そのものの検証は non-municipal.test.ts が全区横断で行うため、本ファイルの
 *     区固有アサーションは区の手続き10件を対象にする(NON_MUNICIPAL_IDS で除外)。
 * (g) **自治体スコープの分離(CLAUDE.md原則4)**: 利用者向けフィールド(title/shortDescription/
 *     applicabilityReason/dueDescription/cautions 等)に他区の区名が一切現れないこと。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const CHUO = '13102';
const MINATO = '13103';
const BUNKYO = '13105';
const TAITO = '13106';
const SUMIDA = '13107';
const BATCH8 = [CHUO, MINATO, BUNKYO, TAITO, SUMIDA] as const;
const RULE_VERSION = '2026-08-07.1';
/**
 * 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で ruleVersion を
 * 上げた区。手続き(procedures.json)の内容は変わっていないため pv.version は据え置き。
 * 台東区は公式ページに『転入日』の定義が無く、転出予定日起算のルールを持てないため不変。
 */
const REVISED_RULE_VERSION = '2026-08-09.1';
/**
 * 2026-08-09(2回目): マイナンバー継続利用の期日を1日前へ直した区。
 * 「◯日経過した転入届があった場合は失効」の◯日目は**すでに失効している日**であり、
 * 失効しない最終日はその前日。以前は失効日そのものを期限として表示していた。
 */
const CORRECTED_RULE_VERSION = '2026-08-09.2';
const REVISED_WARDS: readonly string[] = [CHUO, MINATO, BUNKYO, SUMIDA];
const ruleVersionOf = (code: string) =>
  code === CHUO
    ? CORRECTED_RULE_VERSION
    : REVISED_WARDS.includes(code)
      ? REVISED_RULE_VERSION
      : RULE_VERSION;
const LAST_VERIFIED = '2026-08-07T00:00:00Z';

/** なぜ: (g) 他区名の混入検出に使う23区の名称表。自区名は当然許可する。 */
const WARD_NAMES: Record<string, string> = {
  '13101': '千代田区',
  '13102': '中央区',
  '13103': '港区',
  '13104': '新宿区',
  '13105': '文京区',
  '13106': '台東区',
  '13107': '墨田区',
  '13108': '江東区',
  '13109': '品川区',
  '13110': '目黒区',
  '13111': '大田区',
  '13112': '世田谷区',
  '13113': '渋谷区',
  '13114': '中野区',
  '13115': '杉並区',
  '13116': '豊島区',
  '13117': '北区',
  '13118': '荒川区',
  '13119': '板橋区',
  '13120': '練馬区',
  '13121': '足立区',
  '13122': '葛飾区',
  '13123': '江戸川区',
};

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

function ruleSetOf(code: string): RuleSet {
  return ruleSetSchema.parse(readJson(`packages/rules/data/${code}/rules.json`));
}

function proceduresOf(code: string) {
  const raw = readJson(`data/normalized/${code}/procedures.json`) as { procedures: unknown[] };
  return raw.procedures.map((p) => procedureVersionSchema.parse(p));
}

function facilitiesOf(code: string) {
  const raw = readJson(`data/normalized/${code}/facilities.json`) as { facilities: unknown[] };
  return raw.facilities.map((f) => facilitySchema.parse(f));
}

const RULE_SETS: Record<string, RuleSet> = Object.fromEntries(
  BATCH8.map((code) => [code, ruleSetOf(code)]),
);

/**
 * なぜ: 2026-08-06 追加の「自治体以外(ライフライン等)の手続き」4件(ADR-009)。全対応区で
 * municipalityCode 以外まったく同一の内容であり、区固有データの回帰ガードである本ファイルの
 * 対象外とする(4件そのものの検証は non-municipal.test.ts が全区横断で行う)。
 */
const NON_MUNICIPAL_IDS = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
  'procedure_driver_license_change',
];
/** 条件なしで全員該当する3件(運転免許は needsVehicleGuidance が必要なため含めない)。 */
const NON_MUNICIPAL_ALWAYS_APPLICABLE = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
];

function municipalProceduresOf(code: string) {
  return proceduresOf(code).filter((p) => !NON_MUNICIPAL_IDS.includes(p.id));
}

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: overrides.municipalityCode ?? CHUO },
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

function outcomeFor(p: Profile, code: string, procedureId: string) {
  const o = evaluate(p, RULE_SETS[code] as RuleSet).outcomes.find(
    (x) => x.procedureId === procedureId,
  );
  if (!o) throw new Error(`no outcome for ${procedureId} (${code})`);
  return o;
}

/**
 * なぜ: 評価器は REQUIREMENTS §10「dueDate または dueDescription」に従い、期限を算定できた
 * 場合は outcome から dueDescription を落とす。期限を算定する区の公式文言を検証するには
 * rules.json 側の dueDescription を直接参照する必要がある。
 */
function ruleDueDescription(code: string, procedureId: string): string {
  const rule = (RULE_SETS[code] as RuleSet).rules.find((r) => r.procedureId === procedureId);
  if (!rule?.dueDescription) throw new Error(`no dueDescription for ${procedureId} (${code})`);
  return rule.dueDescription;
}

/** 子育て世帯(未就学+小学生+成人)のプロフィール。子ども系ルールを該当にするため。 */
function familyIn(code: string): Profile {
  return profile({
    municipalityCode: code,
    memberCount: 4,
    ageBands: ['age0_2', 'elementary', 'adult'],
    flags: { hasMyNumberCard: true },
  });
}

describe('Batch8 — schema validation & approved status (CI gate)', () => {
  it.each(BATCH8)(
    '%s: rules.json が RuleSet として parse し 14ルール(区10件+ライフライン等4件)・自治体スコープ一致',
    (code) => {
      const rs = RULE_SETS[code] as RuleSet;
      expect(rs.municipalityCode).toBe(code);
      expect(rs.ruleVersion).toBe(ruleVersionOf(code));
      // ADR-007: 承認後は publishedRuleVersion を持たず、ruleVersion がそのまま公開版になる。
      expect(rs.publishedRuleVersion).toBeUndefined();
      expect(rs.rules.length).toBe(14);
      expect(rs.rules.filter((r) => !NON_MUNICIPAL_IDS.includes(r.procedureId))).toHaveLength(10);
    },
  );

  it.each(BATCH8)(
    '%s: procedures.json — 区の手続き10件 parse し 全件 verified(2026-08-07人手レビュー承認)',
    (code) => {
      const procedures = municipalProceduresOf(code);
      expect(procedures.length).toBe(10);
      expect(proceduresOf(code)).toHaveLength(14);
      for (const pv of procedures) {
        expect(pv.municipalityCode).toBe(code);
        // ADR-007: 公開単位は verified のみ。
        expect(pv.dataStatus).toBe('verified');
        expect(pv.version).toBe(expectedVersion(code, pv.id, RULE_VERSION));
        expect(pv.lastVerifiedAt).toBe(expectedLastVerifiedAt(code, pv.id, LAST_VERIFIED));
        expect(pv.sourceIds.length).toBeGreaterThan(0);
        // 期限は dueDate(算定式)ではなく dueDescription(公式文言)を静的に保持する。
        expect(pv.dueDate).toBeUndefined();
        expect(pv.dueDescription).toBeDefined();
        // 承認によりpending系のcaution文言は除去されている。
        expect(pv.cautions?.some((c) => c.includes('人手レビュー未了'))).toBeFalsy();
      }
    },
  );

  it.each(BATCH8)('%s: procedures と rules が同一の14 procedureId を過不足なく覆う', (code) => {
    const procIds = proceduresOf(code)
      .map((p) => p.id)
      .sort();
    const ruleIds = (RULE_SETS[code] as RuleSet).rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口件数(中央4 / 港5 / 文京1 / 台東1 / 墨田5)と座標の有無', () => {
    // 中央: 本庁舎1 + 特別出張所3(公式ページ由来・緯度経度なし。都のCSVはID列が科学的記数法で破損)。
    const chuo = facilitiesOf(CHUO);
    expect(chuo.length).toBe(4);
    for (const f of chuo) expect(f.lat).toBeUndefined();

    // 港: 5地区の総合支所(公式ページ由来・緯度経度なし。施設CSVは区独自CKANでGIF標準ではない)。
    const minato = facilitiesOf(MINATO);
    expect(minato.length).toBe(5);
    for (const f of minato) expect(f.lat).toBeUndefined();

    // 文京: 住民異動の受付は文京シビックセンター2階のみ(統一の公共施設CSVが存在しない)。
    const bunkyo = facilitiesOf(BUNKYO);
    expect(bunkyo.length).toBe(1);
    expect(bunkyo[0]?.lat).toBeUndefined();

    // 台東: 区民事務所の所在地が公式一覧ページに無いため本庁舎のみ(所在地を推測で補わない)。
    const taito = facilitiesOf(TAITO);
    expect(taito.length).toBe(1);
    expect(taito[0]?.lat).toBeUndefined();

    // 墨田: 自治体標準CSV由来(ID列破損なし)。区役所 + 出張所4、緯度経度は実値。
    // 横川出張所は令和7年11月28日で窓口業務を終了したため除外(2026-09-29 再監査)。
    const sumida = facilitiesOf(SUMIDA);
    expect(sumida.length).toBe(5);
    expect(sumida.map((f) => f.name)).not.toContain('横川出張所');
    for (const f of sumida) {
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
      expect(f.facilityId).toMatch(/^13107500000\d$/);
    }
  });

  it('coverage.csv — 5区は承認済みカテゴリが verified、収集曜日は恒久的にunavailable', () => {
    // なぜ: 2026-08-07 承認により手続き系カテゴリ(区の10手続き+ライフライン等4件)と施設は
    // verified になった一方、waste_schedule は機械判読可能な収集曜日データが存在せず恒久的な
    // 誠実縮退で unavailable(CLAUDE.md原則8/9)。rag は 2026-08-07 の23区索引化+151問評価
    // (fail=0/混入0。docs/research/rag-eval-2026-08-07.md)で verified へ移行済み。
    // 分別辞書は墨田だけ整備済みなので、5区一律にせず区ごとに期待値を分ける(原則9)。
    const rows = readFileSync(resolve(repoRoot, 'docs/data-sources/coverage.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const header = (rows[0] as string).split(',');
    for (const code of BATCH8) {
      const row = rows.find((l) => l.startsWith(`${code},`));
      expect(row, `coverage row missing for ${code}`).toBeDefined();
      const cells = (row as string).split(',');
      // resident_registration(2) .. facilities(9)
      for (let i = 2; i <= 9; i++) {
        expect(cells[i], `${code} / ${header[i]}`).toBe('verified');
      }
      expect(cells[10], `${code} / waste_schedule`).toBe('unavailable');
      expect(cells[11], `${code} / waste_sorting`).toBe(
        code === SUMIDA ? 'verified' : 'unavailable',
      );
      expect(cells[12], `${code} / rag`).toBe('verified');
      expect(cells[13], `${code} / non_municipal`).toBe('verified');
      expect(cells[14], `${code} / overall_status`).toBe('partial');
    }
  });

  it.each(BATCH8)('%s: waste.json(収集曜日)を作らない — 誠実縮退の回帰ガード', (code) => {
    // 中央・文京=町丁目別の構造化HTML表はあるが表パーサ未整備、港=PDFのみで都カタログにCSVが無い、
    // 台東=分別CSVが404で収集曜日は分割HTMLのみ、墨田=都カタログ登録の収集曜日CSVが404。
    // いずれも推測で曜日を作らないため waste.json を作らない。
    expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste.json`))).toBe(false);
  });

  it('waste-sorting.json は墨田のみ整備(476品目)。中央・港・文京・台東は作らない', () => {
    const raw = readJson(`data/normalized/${SUMIDA}/waste-sorting.json`) as { items: unknown[] };
    const items = raw.items.map((i) => wasteSortingItemSchema.parse(i));
    expect(items.length).toBe(476);
    for (const i of items) {
      expect(i.municipalityCode).toBe(SUMIDA);
      expect(i.sourceId).toBe('src-13107-waste_sorting-001');
      expect(i.itemId).toMatch(/^131075S\d{5}$/);
    }
    // UTF-8 BOM 付きCSVを正しく復号できていること(BOMが残れば先頭列名が壊れる)。
    expect(items.some((i) => i.name === 'アイロン')).toBe(true);
    // 分別区分が空欄だった1行は推測で埋めず除外している(477行 - 1 = 476品目)。
    expect(items.some((i) => i.itemId === '131075S00210')).toBe(false);

    for (const code of [CHUO, MINATO, BUNKYO, TAITO]) {
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste-sorting.json`))).toBe(
        false,
      );
    }
  });
});

describe('Batch8 — 区ごとに異なる期限(共通デフォルト値を作らない)', () => {
  it('転入届は5区とも moveDate+14日(共通なのは各区の公式ページに14日と書かれているから)', () => {
    for (const code of BATCH8) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_resident_registration',
      );
      expect(o.applicable).toBe('applicable');
      expect(o.priority).toBe('urgent');
      expect(o.dueDate).toBe('2026-08-15');
    }
  });

  it('国民健康保険も5区とも moveDate+14日', () => {
    for (const code of BATCH8) {
      const o = outcomeFor(
        profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: true } }),
        code,
        'procedure_national_health_insurance',
      );
      expect(o.dueDate).toBe('2026-08-15');
    }
  });

  it('子ども医療費助成: 港=15日 / 墨田=15日 / 文京=3ヶ月 / 台東=3ヶ月 / 中央=要確認', () => {
    const due = (code: string) =>
      outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDescription ?? '';

    // 港・墨田は15日。月単位の期限を混入させない。
    for (const code of [MINATO, SUMIDA]) {
      const d = due(code);
      expect(d, code).toContain('15日以内');
      expect(d, code).not.toContain('2か月');
      expect(d, code).not.toContain('3ヶ月');
      expect(d, code).not.toContain('3カ月');
      expect(d, code).not.toContain('6カ月');
    }

    // 文京・台東は3ヶ月。15日を混入させない。
    for (const code of [BUNKYO, TAITO]) {
      const d = due(code);
      expect(d, code).toContain('3ヶ月');
      expect(d, code).not.toContain('15日以内');
      expect(d, code).not.toContain('2か月');
      expect(d, code).not.toContain('6カ月');
    }

    // 中央は公式ページに交付申請の遡及期限の記載が無いため『要確認』。数値の期限を書かない。
    const chuo = due(CHUO);
    expect(chuo).toContain('記載がありません');
    expect(chuo).toContain('要確認');
    expect(chuo).not.toContain('15日以内');
    expect(chuo).not.toContain('2か月');
    expect(chuo).not.toContain('3ヶ月');
    expect(chuo).not.toContain('3カ月');
    expect(chuo).not.toContain('6カ月');
    // 償還払いの5年時効(別手続き)と混同していないこと=遡及期限として5年を出していない。
    expect(chuo).toContain('5年以内');
    expect(chuo).toContain('別の手続き');
    // 中央は needs_confirmation の理由も持つ(該当は出すが期限は確定しない)。
    const chuoRule = (RULE_SETS[CHUO] as RuleSet).rules.find(
      (r) => r.procedureId === 'procedure_child_medical',
    );
    expect(chuoRule?.needsConfirmationReason).toBeDefined();
    expect(chuoRule?.dueRule).toEqual({ type: 'unknown' });

    // 5区とも dueDate(算定値)は出さない(「申請すれば遡及」であって届出期限ではないため)。
    for (const code of BATCH8) {
      expect(outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDate).toBeUndefined();
    }
  });

  it('マイナンバー継続利用: 中央/文京/墨田=90日ルールあり / 港・台東は「未確認」表示', () => {
    const withCard = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasMyNumberCard: true } }),
        code,
        'procedure_mynumber_continued_use',
      );

    const ruleDueOf = (code: string) =>
      (RULE_SETS[code] as RuleSet).rules.find(
        (r) => r.procedureId === 'procedure_mynumber_continued_use',
      )?.dueDescription ?? '';

    for (const code of [CHUO, BUNKYO, SUMIDA]) {
      expect(withCard(code).applicable).toBe('applicable');
      // 90日は「転入届出日」起算のため算定しない(文言としては残る)。
      expect(ruleDueOf(code), code).toContain('90日');
    }
    // 中央は「転入日から15日経過…した転入届があった場合はカードが失効」と明記。
    // 15日経過した日は**すでに失効している日**なので、失効しない最終日は引越し日+14日。
    // (同じ区の転入届の届出期限も「住み始めてから14日以内」で一致する。)
    expect(withCard(CHUO).dueDate).toBe('2026-08-15');
    // 文京は「引越し日から14日以内に転入届を行わなかった場合、カードは失効」と明記 → 引越し日+14日。
    expect(withCard(BUNKYO).dueDate).toBe('2026-08-15');
    // 墨田はカード失効の条件として90日しか書いていない(表の『引っ越し後14日以内』は転入届自体の
    // 届出期間で、カード失効の条件として結び付けられていない)。推測せず日付を出さない。
    expect(withCard(SUMIDA).dueDate).toBeUndefined();

    // 港・台東: 公式ページに継続利用の失効期限の記載が無いため、確認できなかったことを明示する。
    for (const code of [MINATO, TAITO]) {
      const o = withCard(code);
      expect(o.dueDescription, code).toContain('確認できませんでした');
      expect(o.dueDescription, code).toContain('未確認');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.applicabilityReason, code).toContain('未確認');
      // 確認できていない90日を断定していないこと。
      expect(o.dueDescription, code).not.toContain('90日');
      const rule = (RULE_SETS[code] as RuleSet).rules.find(
        (r) => r.procedureId === 'procedure_mynumber_continued_use',
      );
      expect(rule?.needsConfirmationReason, code).toBeDefined();
      expect(rule?.needsConfirmationReason, code).not.toContain('90日');
    }
  });

  it('児童手当の15日特例: 5区とも起算日が引越し日ではないため dueDate を算定しない', () => {
    for (const code of BATCH8) {
      const o = outcomeFor(familyIn(code), code, 'procedure_child_allowance');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('15日以内');
    }
    // 中央・港・文京・墨田は「転出予定日」起算であることを明記している。
    for (const code of [CHUO, MINATO, BUNKYO, SUMIDA]) {
      expect(ruleDueDescription(code, 'procedure_child_allowance'), code).toContain('転出予定日');
    }
    // 台東だけは公式ページに『転入日』の定義自体が無く、起算日を確定できないと明示する。
    const taito = ruleDueDescription(TAITO, 'procedure_child_allowance');
    expect(taito).toContain('定義がない');
    expect(taito).toContain('算定していません');
  });

  it('犬の届出: 墨田=30日以内(moveDate+30を算定) / 中央・港・文京・台東=日数記載なしで算定しない', () => {
    const noChip = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasDog: true, dogHasMicrochip: false } }),
        code,
        'procedure_dog_registration_transfer',
      );

    const sumida = noChip(SUMIDA);
    expect(sumida.applicable).toBe('applicable');
    expect(sumida.dueDate).toBe('2026-08-31');
    expect(sumida.dueDescription).toBeUndefined();
    expect(ruleDueDescription(SUMIDA, 'procedure_dog_registration_transfer')).toContain('30日以内');

    for (const code of [CHUO, MINATO, BUNKYO, TAITO]) {
      const o = noChip(code);
      expect(o.applicable, code).toBe('applicable');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('記載がありません');
    }
  });

  it('国民年金: 5区とも公式ページに国内転入の住所変更の記載がなく「記載がありません」と表示', () => {
    for (const code of BATCH8) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_national_pension_address',
      );
      expect(o.dueDescription, code).toContain('記載がありません');
      expect(o.dueDate, code).toBeUndefined();
      // 記載が無い区に「住民異動届のみで足りる」と断定を持ち込んでいないこと。
      expect(o.dueDescription, code).not.toContain('必要ありません');
    }
  });

  it('学校の交付書類名: 中央=就学通知書 / 港・文京・台東・墨田は名称を設定しない', () => {
    const school = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, ageBands: ['elementary', 'adult'], memberCount: 2 }),
        code,
        'procedure_school_transfer',
      ).dueDescription ?? '';

    expect(school(CHUO)).toContain('就学通知書');
    expect(school(CHUO)).not.toContain('転入学通知書');

    for (const code of [MINATO, BUNKYO, TAITO, SUMIDA]) {
      expect(school(code), code).not.toContain('就学通知書');
      expect(school(code), code).not.toContain('転入学通知書');
      expect(school(code), code).not.toContain('学校指定通知書');
    }
  });

  it('保育の申込先が区で違う: 中央=直接申込み / 港=現住自治体経由 / 文京=転入可否で分岐', () => {
    const care = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, ageBands: ['age0_2', 'adult'], memberCount: 3 }),
        code,
        'procedure_childcare_application',
      ).dueDescription ?? '';

    expect(care(CHUO)).toContain('直接');
    expect(care(CHUO)).toContain('自治体経由');
    expect(care(MINATO)).toContain('現在お住まいの自治体を通じて');
    expect(care(BUNKYO)).toContain('直接');
    expect(care(BUNKYO)).toContain('現在お住まいの市区町村を通じて');
  });
});

describe('Batch8 — ペルソナ評価(正例・負例・境界)', () => {
  it.each(BATCH8)(
    '%s: 単身・都外・マイナンバーあり は8件該当(区5件+ライフライン3件)・子育て/犬/運転免許は非該当',
    (code) => {
      const single = profile({ municipalityCode: code, flags: { hasMyNumberCard: true } });
      const applicable = evaluate(single, RULE_SETS[code] as RuleSet)
        .outcomes.filter((o) => o.applicable === 'applicable')
        .map((o) => o.procedureId)
        .sort();
      expect(applicable).toEqual(
        [
          'procedure_mynumber_continued_use',
          'procedure_national_health_insurance',
          'procedure_national_pension_address',
          'procedure_resident_registration',
          'procedure_waste_check',
          ...NON_MUNICIPAL_ALWAYS_APPLICABLE,
        ].sort(),
      );
      for (const id of [
        'procedure_child_allowance',
        'procedure_child_medical',
        'procedure_school_transfer',
        'procedure_childcare_application',
        'procedure_dog_registration_transfer',
        'procedure_driver_license_change',
      ]) {
        expect(outcomeFor(single, code, id).applicable, `${code}/${id}`).toBe('not_applicable');
      }
    },
  );

  it.each(BATCH8)('%s: 国保フラグOFFで非該当(負例)', (code) => {
    const off = profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, code, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
  });

  it.each(BATCH8)('%s: 子育て世帯で 児童手当・子ども医療・学校・保育 が増える', (code) => {
    const single = profile({ municipalityCode: code, flags: { hasMyNumberCard: true } });
    const singleIds = evaluate(single, RULE_SETS[code] as RuleSet)
      .outcomes.filter((o) => o.applicable === 'applicable')
      .map((o) => o.procedureId);
    const added = evaluate(familyIn(code), RULE_SETS[code] as RuleSet)
      .outcomes.filter((o) => o.applicable === 'applicable')
      .map((o) => o.procedureId)
      .filter((id) => !singleIds.includes(id))
      .sort();
    expect(added).toEqual(
      [
        'procedure_child_allowance',
        'procedure_child_medical',
        'procedure_school_transfer',
        'procedure_childcare_application',
      ].sort(),
    );
  });

  it.each(BATCH8)(
    '%s: 犬あり・マイクロチップ不明は needs_confirmation(C-10 推測しない)',
    (code) => {
      const unknown = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: 'unknown' },
      });
      const o = outcomeFor(unknown, code, 'procedure_dog_registration_transfer');
      expect(o.applicable).toBe('needs_confirmation');
      expect(o.applicabilityReason).toContain('マイクロチップ');
      // なぜ: 墨田区は公式ページが『変更があったときは30日以内』をマイクロチップの有無に関わらず
      // 冒頭で述べているため、届出先が未確定(needs_confirmation)でも期限自体は確定しており
      // 算定して見せてよい。他4区は日数の記載が無いため期限を出さない。
      expect(o.dueDate, code).toBe(code === SUMIDA ? '2026-08-31' : undefined);

      const chipped = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: true },
      });
      expect(outcomeFor(chipped, code, 'procedure_dog_registration_transfer').applicable).toBe(
        'not_applicable',
      );
    },
  );

  it('期限計算の境界: 月末・年末・うるう年を跨いでも暦日で算定する(中央の転入届14日)', () => {
    const at = (moveDate: string) => {
      const p: Profile = { ...profile({ municipalityCode: CHUO }), moveDate };
      return outcomeFor(p, CHUO, 'procedure_resident_registration').dueDate;
    };
    expect(at('2026-08-25')).toBe('2026-09-08'); // 月跨ぎ
    expect(at('2026-12-25')).toBe('2027-01-08'); // 年跨ぎ
    expect(at('2028-02-20')).toBe('2028-03-05'); // うるう年(2月29日を含む)
  });

  it('期限計算の境界: 墨田の犬の届出30日も月跨ぎ・年跨ぎ・うるう年で暦日算定する', () => {
    const at = (moveDate: string) => {
      const p: Profile = {
        ...profile({ municipalityCode: SUMIDA, flags: { hasDog: true, dogHasMicrochip: false } }),
        moveDate,
      };
      return outcomeFor(p, SUMIDA, 'procedure_dog_registration_transfer').dueDate;
    };
    expect(at('2026-08-25')).toBe('2026-09-24'); // 月跨ぎ
    expect(at('2026-12-25')).toBe('2027-01-24'); // 年跨ぎ
    expect(at('2028-02-20')).toBe('2028-03-21'); // うるう年(2月29日を含む)
  });
});

describe('Batch8 — provenance integrity & scope safety', () => {
  const registryRows = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);
  const registryIds = new Set(registryRows.map((l) => l.slice(0, l.indexOf(','))));

  it.each(BATCH8)(
    '%s: 全ルール・全手続き・全施設の sourceIds が registry.csv に実在する',
    (code) => {
      for (const rule of (RULE_SETS[code] as RuleSet).rules) {
        for (const sid of rule.sourceIds) {
          expect(registryIds.has(sid), `rule ${code}/${rule.procedureId} → missing ${sid}`).toBe(
            true,
          );
        }
      }
      for (const pv of proceduresOf(code)) {
        for (const sid of pv.sourceIds) {
          expect(registryIds.has(sid), `procedure ${pv.id} → missing ${sid}`).toBe(true);
        }
      }
      for (const f of facilitiesOf(code)) {
        expect(
          registryIds.has(f.sourceId),
          `facility ${f.facilityId} → missing ${f.sourceId}`,
        ).toBe(true);
      }
    },
  );

  it.each(BATCH8)(
    '%s: registry.csv の当該行は全て review_status=approved(2026-08-07人手レビュー承認)',
    (code) => {
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cells = row.split(',');
        // 列順: ... 14:content_hash, 15:effective_from, 16:effective_to, 17:review_status
        expect(cells[17], row.slice(0, 60)).toBe('approved');
        // content_hash(SHA-256 16進64桁)が記録されていること。
        expect(cells[14], row.slice(0, 60)).toMatch(/^[0-9a-f]{64}$/);
      }
    },
  );

  // 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
  it.skipIf(!hasSourceSnapshots()).each(BATCH8)(
    '%s: 出典スナップショットが存在し content_hash と一致する',
    async (code) => {
      const { createHash } = await import('node:crypto');
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      for (const row of rows) {
        const cells = row.split(',');
        const sourceId = cells[0] as string;
        const ext = cells[6] as string;
        // 再監査で版付き(<id>.<YYYYMMDD>.<ext>)が増えていれば、その最新が現行の原文(台帳のハッシュもそれ)。
        const dir = resolve(repoRoot, `data/sources/${code}/snapshots`);
        const current = existsSync(dir)
          ? pickCurrentSnapshot(readdirSync(dir), sourceId, ext)
          : null;
        const file = resolve(dir, current ?? `${sourceId}.${ext}`);
        expect(existsSync(file), `snapshot missing: ${file}`).toBe(true);
        const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
        expect(hash, `hash mismatch for ${sourceId}`).toBe(cells[14]);
      }
    },
  );

  it('死リンク(HTTP 404)のURLを台帳に登録していない — Batch8で実確認したURLの回帰ガード', () => {
    // なぜ: 台東区の『ごみ分別一覧』CSV2件と墨田区の『資源物とごみの収集曜日一覧』CSVは
    // 東京都オープンデータカタログに登録されているが 2026-08-07 時点で実際には HTTP 404 を返す。
    // カタログ記載=取得可能ではないため、これらを一次根拠として台帳へ入れない(CLAUDE.md原則5/9)。
    const deadUrls = [
      'gomibunbetuitiran.csv',
      '20250314_gomi_bunbetsu_ku_hp.csv',
      'bunbetu_20151029.csv',
    ];
    // 検査対象は source_url 列(index 5)のみ。notes 列には「404だったので登録しない」という
    // 判断の根拠としてファイル名が出てくるため、行全体の部分一致では誤検知する。
    const urls = registryRows.map((l) => l.split(',')[5] ?? '');
    for (const dead of deadUrls) {
      const hit = urls.find((u) => u.includes(dead));
      expect(hit, `dead link registered as source_url: ${dead}`).toBeUndefined();
    }
  });

  it.each(BATCH8)('%s: 利用者向けデータに他区の区名が混入していない(CLAUDE.md原則4)', (code) => {
    const others = Object.entries(WARD_NAMES)
      .filter(([c]) => c !== code)
      .map(([, name]) => name);
    const texts: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(readJson(`packages/rules/data/${code}/rules.json`));
    collect(readJson(`data/normalized/${code}/procedures.json`));
    collect(readJson(`data/normalized/${code}/facilities.json`));

    for (const text of texts) {
      for (const other of others) {
        expect(text.includes(other), `${code}: "${other}" leaked into "${text.slice(0, 80)}"`).toBe(
          false,
        );
      }
    }
  });

  it('越境: 各区のプロフィールを他区のルールセットで評価すると必ず例外', () => {
    for (const code of BATCH8) {
      for (const other of BATCH8) {
        if (other === code) continue;
        expect(() =>
          evaluate(profile({ municipalityCode: code }), RULE_SETS[other] as RuleSet),
        ).toThrow(MunicipalityScopeMismatchError);
      }
    }
  });

  it.each(BATCH8)('%s: 決定論 — 同一入力で同一結果 + スナップショット(回帰ガード)', (code) => {
    const p = profile({
      municipalityCode: code,
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      flags: { hasMyNumberCard: true, hasDog: true, dogHasMicrochip: 'unknown' },
    });
    const first = evaluate(p, RULE_SETS[code] as RuleSet);
    expect(evaluate(p, RULE_SETS[code] as RuleSet)).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
