import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DueRule, Profile, RuleSet } from '@tmn/schemas';
import { facilitySchema, procedureVersionSchema, ruleSetSchema } from '@tmn/schemas';
import { isOfficialUrl, pickCurrentSnapshot } from '@tmn/drift';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';
import { moveOutScheduledDateImpact } from './move-out-date-impact.js';
import { buildWardDifferences } from './ward-differences.js';

/**
 * なぜ: 八王子市(13201)は市部で最初に縦切りデータを置いた自治体。2026-09-25 に未公開(人手レビュー前)の
 * まま置き、同日の人手レビュー承認で公開対象になった(手続きは dataStatus=verified、出典は registry.csv で
 * review_status=approved・reviewer に承認記録)。来歴・型・決定論・期限と、承認状態をCIで機械検証する。
 *
 * 固定したい不変条件:
 * (a) 承認済み: 14手続き(市の10件+自治体以外の4件)すべて verified、八王子市の出典23件と
 *     東京都水道局の追加1件はすべて approved。coverage は手続き系・施設・自治体以外が verified、
 *     収集曜日・分別辞書・チャット(索引の作り直し前)は unavailable。
 * (e) 自治体以外の4件: 郵便・電気ガス・運転免許は区の共通テンプレートと「区」の言い回し以外は同一
 *     (都/国の出典が八王子市にもそのまま当てはまるため)。水道は八王子市向けで、区の共通テンプレートが
 *     依拠する「23区内なら下水道局への届出不要」を持ち込まない。
 * (b) 期限は八王子市の公式文言にある日数だけ: 転入届・国保=引越し日+14日、マイナンバー=
 *     引越し日+14日と転出予定日+30日の早い方(90日は転入届出日起算のため算定しない)、
 *     児童手当=転出予定日+15日(引越し日からは算定しない)、子ども医療費=3か月(月単位のため算定しない)、
 *     犬・学校・保育・年金・ごみ=日数の記載なし。
 * (c) 越境しない: 他自治体のルールセットで評価すると例外。文言に23区の名称・区を前提にした
 *     言い回し(区役所・区民・区内 等)が現れない。出典URLは八王子市の2ホストのみ。
 * (d) 収集曜日・分別辞書は作らない(waste.json / waste-sorting.json 不在)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const HACHIOJI = '13201';
const RULE_VERSION = '2026-09-25.1';
const LAST_VERIFIED = '2026-09-25T00:00:00Z';

const MUNICIPAL_IDS = [
  'procedure_resident_registration',
  'procedure_mynumber_continued_use',
  'procedure_national_health_insurance',
  'procedure_national_pension_address',
  'procedure_child_allowance',
  'procedure_child_medical',
  'procedure_school_transfer',
  'procedure_childcare_application',
  'procedure_dog_registration_transfer',
  'procedure_waste_check',
] as const;

/** 自治体以外(ライフライン等)の4手続き(ADR-009)。 */
const NON_MUNICIPAL_IDS = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
  'procedure_driver_license_change',
] as const;

const ALL_IDS = [...MUNICIPAL_IDS, ...NON_MUNICIPAL_IDS];

/** 23特別区の名称(cross-ward-text.test.ts と同じ出典=municipalities.ts)。 */
const WARD_NAMES = [
  '千代田区',
  '中央区',
  '港区',
  '新宿区',
  '文京区',
  '台東区',
  '墨田区',
  '江東区',
  '品川区',
  '目黒区',
  '大田区',
  '世田谷区',
  '渋谷区',
  '中野区',
  '杉並区',
  '豊島区',
  '北区',
  '荒川区',
  '板橋区',
  '練馬区',
  '足立区',
  '葛飾区',
  '江戸川区',
] as const;

/**
 * 「区」を前提にした言い回し。八王子市のデータを区のデータから書き起こしたときに残りやすい。
 * 「市区町村」「通学区域」は正当な語なので、それらに含まれない形だけを挙げる。
 */
const WARD_ONLY_PHRASES = ['区役所', '区民', '区内', '区外', '区立', '区長', '本区'] as const;

function readJson(relFromRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, relFromRoot), 'utf-8'));
}

const ruleSet: RuleSet = ruleSetSchema.parse(
  readJson(`packages/rules/data/${HACHIOJI}/rules.json`),
);

function procedures() {
  const raw = readJson(`data/normalized/${HACHIOJI}/procedures.json`) as { procedures: unknown[] };
  return raw.procedures.map((p) => procedureVersionSchema.parse(p));
}

function facilities() {
  const raw = readJson(`data/normalized/${HACHIOJI}/facilities.json`) as { facilities: unknown[] };
  return raw.facilities.map((f) => facilitySchema.parse(f));
}

function profile(overrides: {
  municipalityCode?: string;
  moveDate?: string;
  moveOutScheduledDate?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: overrides.municipalityCode ?? HACHIOJI },
    moveDate: overrides.moveDate ?? '2026-08-01',
    ...(overrides.moveOutScheduledDate !== undefined
      ? { moveOutScheduledDate: overrides.moveOutScheduledDate }
      : {}),
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

function outcome(p: Profile, procedureId: string) {
  const o = evaluate(p, ruleSet).outcomes.find((x) => x.procedureId === procedureId);
  if (!o) throw new Error(`no outcome for ${procedureId}`);
  return o;
}

function ruleOf(procedureId: string) {
  const rule = ruleSet.rules.find((r) => r.procedureId === procedureId);
  if (!rule) throw new Error(`no rule for ${procedureId}`);
  return rule;
}

function family(overrides: { moveOutScheduledDate?: string } = {}): Profile {
  return profile({
    memberCount: 4,
    ageBands: ['age0_2', 'elementary', 'adult'],
    flags: { hasMyNumberCard: true },
    ...overrides,
  });
}

/** 引用符つきCSVの最小パーサ(notes 列の将来の引用符に備える)。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const registry = (() => {
  const rows = parseCsv(
    readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8'),
  ).filter((r) => r.length > 1);
  const header = rows[0] ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`registry column missing: ${name}`);
    return i;
  };
  const records = rows.slice(1).map((r) => ({
    sourceId: r[col('source_id')] ?? '',
    owner: r[col('owner_organization')] ?? '',
    municipalityCode: r[col('municipality_code')] ?? '',
    url: r[col('source_url')] ?? '',
    sourceType: r[col('source_type')] ?? '',
    license: r[col('license')] ?? '',
    contentHash: r[col('content_hash')] ?? '',
    lastVerifiedAt: r[col('last_verified_at')] ?? '',
    reviewStatus: r[col('review_status')] ?? '',
    reviewer: r[col('reviewer')] ?? '',
  }));
  return { records, byId: new Map(records.map((r) => [r.sourceId, r])) };
})();

const hachiojiSources = registry.records.filter((r) => r.sourceId.startsWith('src-13201-'));

/** 利用者に見える文字列(手続き・ルール・施設の公開フィールド)。 */
function userVisibleTexts(): string[] {
  const out: string[] = [];
  for (const p of procedures()) {
    out.push(p.title, p.shortDescription, p.applicabilityReason, p.dueDescription ?? '');
    out.push(...(p.locations ?? []), p.contact ?? '', ...(p.cautions ?? []));
    out.push(...p.requiredDocuments.map((d) => d.label));
  }
  for (const r of ruleSet.rules) {
    out.push(
      r.dueDescription ?? '',
      r.applicabilityReasonTemplate,
      r.needsConfirmationReason ?? '',
    );
  }
  for (const f of facilities()) out.push(f.name, f.category, f.address, f.hours ?? '');
  return out.filter((t) => t.length > 0);
}

describe('八王子市 — スキーマと承認状態', () => {
  it('rules.json は RuleSet として parse し、14ルール・自治体スコープ一致・公開版の指定なし', () => {
    expect(ruleSet.municipalityCode).toBe(HACHIOJI);
    expect(ruleSet.ruleVersion).toBe(RULE_VERSION);
    // 公開されているルールが1件も無いので「公開済みの版」を別に持つ理由がない(ADR-007 §5)。
    expect(ruleSet.publishedRuleVersion).toBeUndefined();
    expect(ruleSet.rules.map((r) => r.procedureId).sort()).toEqual([...ALL_IDS].sort());
  });

  it('procedures.json は14件 parse し、全件 verified(承認済み)・版と最終確認日が揃う', () => {
    const list = procedures();
    expect(list.map((p) => p.id).sort()).toEqual([...ALL_IDS].sort());
    for (const pv of list) {
      expect(pv.municipalityCode).toBe(HACHIOJI);
      // ADR-007: 公開単位は verified のみ。2026-09-25 の人手レビュー承認で partial → verified。
      expect(pv.dataStatus, pv.id).toBe('verified');
      expect(pv.version, pv.id).toBe(RULE_VERSION);
      expect(pv.lastVerifiedAt, pv.id).toBe(LAST_VERIFIED);
      expect(pv.sourceIds.length, pv.id).toBeGreaterThan(0);
      expect(pv.dueDate, pv.id).toBeUndefined();
      expect(pv.dueDescription, pv.id).toBeDefined();
    }
  });

  it('台帳の八王子市の出典23件は全て approved・承認記録あり・sha256 記録済み', () => {
    expect(hachiojiSources).toHaveLength(23);
    for (const s of hachiojiSources) {
      expect(s.reviewStatus, s.sourceId).toBe('approved');
      expect(s.reviewer, s.sourceId).toContain('maintainer');
      expect(s.municipalityCode, s.sourceId).toBe(HACHIOJI);
      expect(s.owner, s.sourceId).toBe('八王子市');
      expect(s.contentHash, s.sourceId).toMatch(/^[0-9a-f]{64}$/);
      // 承認日(2026-09-25)以降であること。再監査で個別に進む(2026-09-28 に施設・国民年金の2件)。
      expect(s.lastVerifiedAt, s.sourceId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.lastVerifiedAt! >= '2026-09-25', s.sourceId).toBe(true);
      // 利用条件が不明なソースは公開しない(原則10)。八王子市の著作権ポリシーに従う旨と、
      // 2026-09-25 のユーザー決裁(原文は証跡としてのみ保持し公開リポジトリから除外)を記録する。
      expect(s.license, s.sourceId).toContain('市サイト著作権ポリシー');
      expect(s.license, s.sourceId).toContain('公開リポジトリからは除外');
    }
  });

  it('八王子市の水道のために足した東京都水道局の出典も approved', () => {
    const s = registry.byId.get('src-13000-water_supply-002');
    expect(s?.reviewStatus).toBe('approved');
    expect(s?.reviewer).toContain('maintainer');
    expect(s?.municipalityCode).toBe('13000');
    expect(s?.owner).toBe('東京都水道局');
    expect(isOfficialUrl(s?.url ?? '')).toBe(true);
  });

  it('coverage.csv — 承認済みカテゴリとチャットは verified、収集曜日・分別辞書は unavailable(未対応を対応済みに見せない)', () => {
    const rows = readFileSync(resolve(repoRoot, 'docs/data-sources/coverage.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const header = (rows[0] as string).split(',');
    const row = rows.find((l) => l.startsWith(`${HACHIOJI},`));
    expect(row).toBeDefined();
    const cells = (row as string).split(',');
    expect(cells[1]).toBe('八王子市');
    const expected: Record<string, string> = {
      resident_registration: 'verified',
      my_number: 'verified',
      national_health_insurance: 'verified',
      national_pension: 'verified',
      child_benefits: 'verified',
      school_childcare: 'verified',
      dog_registration: 'verified',
      facilities: 'verified',
      // 収集曜日の機械判読データが無い / 分別方法一覧CSVは未取り込み。
      waste_schedule: 'unavailable',
      waste_sorting: 'unavailable',
      // 索引の作り直しと評価を通すまでは未対応(承認とは別の工程)。
      // 2026-09-25: 索引の再構築と186問の評価(断定0・混入0・越境違反0)を経て verified。
      rag: 'verified',
      non_municipal: 'verified',
      overall_status: 'partial',
    };
    for (const [col, v] of Object.entries(expected)) {
      expect(cells[header.indexOf(col)], col).toBe(v);
    }
    expect(cells[15]).toBe('2026-09-25');
  });

  it('facilities.json — 転入届を受け付ける14窓口(本庁舎市民課+事務所13)・座標なし・長房を含めない', () => {
    const list = facilities();
    expect(list).toHaveLength(14);
    expect(list.filter((f) => f.category === '事務所')).toHaveLength(13);
    expect(list.filter((f) => f.category === '市役所本庁舎')).toHaveLength(1);
    for (const f of list) {
      expect(f.municipalityCode).toBe(HACHIOJI);
      expect(f.address.startsWith('東京都八王子市'), f.name).toBe(true);
      // 施設1件に出典1つの構造のため、名称・時間の出典と別のCSVから座標を持ち込まない。
      expect(f.lat).toBeUndefined();
      expect(f.lng).toBeUndefined();
    }
    // 住民記録の届出を取り扱わない(市民部事務所の取扱業務表)。
    expect(list.some((f) => f.name.includes('長房'))).toBe(false);
    const raw = readJson(`data/normalized/${HACHIOJI}/facilities.json`) as {
      reviewStatus?: string;
    };
    expect(raw.reviewStatus).toBe('approved');
  });

  it('収集曜日・分別辞書のデータは作らない(機械判読できる収集曜日データが無い)', () => {
    expect(existsSync(resolve(repoRoot, `data/normalized/${HACHIOJI}/waste.json`))).toBe(false);
    expect(existsSync(resolve(repoRoot, `data/normalized/${HACHIOJI}/waste-sorting.json`))).toBe(
      false,
    );
  });
});

describe('八王子市 — 期限は公式文言にある日数だけ(正例・負例・境界)', () => {
  it('転入届: 3種の転入元すべてで該当・引越し日+14日・過料の記載', () => {
    for (const originType of ['outside_tokyo', 'inside_tokyo', 'overseas'] as const) {
      const o = outcome(profile({ originType }), 'procedure_resident_registration');
      expect(o.applicable, originType).toBe('applicable');
      expect(o.priority).toBe('urgent');
      expect(o.dueDate, originType).toBe('2026-08-15');
    }
    const due = ruleOf('procedure_resident_registration').dueDescription ?? '';
    expect(due).toContain('住み始めてから14日以内');
    expect(due).toContain('5万円以下の過料');
  });

  it('転入届: 月跨ぎ・年跨ぎ・うるう年の境界も暦日で算定する', () => {
    const at = (moveDate: string) =>
      outcome(profile({ moveDate }), 'procedure_resident_registration').dueDate;
    expect(at('2026-08-25')).toBe('2026-09-08');
    expect(at('2026-12-25')).toBe('2027-01-08');
    expect(at('2028-02-20')).toBe('2028-03-05');
    expect(at('2027-02-20')).toBe('2027-03-06');
  });

  it('国民健康保険: フラグONで該当・引越し日+14日 / OFFで非該当', () => {
    const on = outcome(profile({}), 'procedure_national_health_insurance');
    expect(on.applicable).toBe('applicable');
    expect(on.dueDate).toBe('2026-08-15');
    expect(ruleOf('procedure_national_health_insurance').dueDescription).toContain(
      '事実発生日から14日以内',
    );
    const off = outcome(
      profile({ flags: { needsNationalHealthInsurance: false } }),
      'procedure_national_health_insurance',
    );
    expect(off.applicable).toBe('not_applicable');
  });

  it('マイナンバー継続利用: 引越し日+14日と転出予定日+30日の早い方。90日は算定しない', () => {
    const expected: DueRule = {
      type: 'earliestOf',
      of: [
        { type: 'offsetDays', from: 'moveDate', days: 14 },
        { type: 'offsetDays', from: 'moveOutScheduledDate', days: 30 },
      ],
    };
    expect(ruleOf('procedure_mynumber_continued_use').dueRule).toEqual(expected);
    const due = ruleOf('procedure_mynumber_continued_use').dueDescription ?? '';
    expect(due).toContain('異動日の翌日から起算して14日以内');
    expect(due).toContain('転出予定日の翌日から起算して30日以内');
    expect(due).toContain('90日以内');

    const card = (moveOutScheduledDate?: string) =>
      outcome(
        profile({ flags: { hasMyNumberCard: true }, moveOutScheduledDate }),
        'procedure_mynumber_continued_use',
      );
    // 転出予定日なし → 引越し日+14日だけで算定。
    expect(card().applicable).toBe('applicable');
    expect(card().dueDate).toBe('2026-08-15');
    // 転出予定日+30日のほうが早い(7/10+30=8/9 < 8/15)。
    expect(card('2026-07-10').dueDate).toBe('2026-08-09');
    // 境界: ちょうど同じ日(7/16+30=8/15)。
    expect(card('2026-07-16').dueDate).toBe('2026-08-15');
    // 引越し日+14日のほうが早い(7/25+30=8/24 > 8/15)。
    expect(card('2026-07-25').dueDate).toBe('2026-08-15');
    // 負例: カードなし。
    expect(
      outcome(profile({ flags: { hasMyNumberCard: false } }), 'procedure_mynumber_continued_use')
        .applicable,
    ).toBe('not_applicable');
  });

  it('国民年金: 第1号被保険者は手続き不要と明記・日付なし / フラグOFFで非該当', () => {
    const o = outcome(profile({}), 'procedure_national_pension_address');
    expect(o.applicable).toBe('applicable');
    expect(o.dueDate).toBeUndefined();
    expect(o.dueDescription).toContain('第1号被保険者');
    expect(o.dueDescription).toContain('手続は不要');
    expect(
      outcome(
        profile({ flags: { needsNationalPension: false } }),
        'procedure_national_pension_address',
      ).applicable,
    ).toBe('not_applicable');
  });

  it('児童手当: 転出予定日+15日。未入力なら日付を出さない(引越し日で代用しない)', () => {
    expect(ruleOf('procedure_child_allowance').dueRule).toEqual({
      type: 'offsetDays',
      from: 'moveOutScheduledDate',
      days: 15,
    });
    const without = outcome(family(), 'procedure_child_allowance');
    expect(without.applicable).toBe('applicable');
    expect(without.dueDate).toBeUndefined();
    expect(without.dueDescription).toContain('転出予定日から15日以内');
    expect(without.dueDescription).toContain('引越し日からは算定できません');

    const at = (moveOutScheduledDate: string) =>
      outcome(family({ moveOutScheduledDate }), 'procedure_child_allowance').dueDate;
    expect(at('2026-07-31')).toBe('2026-08-15');
    expect(at('2026-12-20')).toBe('2027-01-04'); // 年跨ぎ
    expect(at('2028-02-20')).toBe('2028-03-06'); // うるう年(2月29日を含む)
    expect(at('2027-02-20')).toBe('2027-03-07'); // 平年

    // 負例: 子どもがいない世帯。
    expect(outcome(profile({}), 'procedure_child_allowance').applicable).toBe('not_applicable');
  });

  it('子ども医療費助成: 3か月以内(月単位)は日付にしない・所得制限なし・児童手当の15日と混同しない', () => {
    const rule = ruleOf('procedure_child_medical');
    expect(rule.dueRule).toEqual({ type: 'unknown' });
    expect(rule.needsConfirmationReason).toBeUndefined();
    const due = rule.dueDescription ?? '';
    expect(due).toContain('3か月以内');
    expect(due).not.toContain('15日以内');
    expect(due).not.toContain('14日以内');
    expect(rule.applicabilityReasonTemplate).toContain('所得制限はありません');

    for (const band of ['age0_2', 'age3_5', 'elementary', 'junior_senior'] as const) {
      const o = outcome(
        profile({ ageBands: [band, 'adult'], memberCount: 2 }),
        'procedure_child_medical',
      );
      expect(o.applicable, band).toBe('applicable');
      expect(o.dueDate, band).toBeUndefined();
    }
    expect(
      outcome(profile({ ageBands: ['adult', 'senior65plus'] }), 'procedure_child_medical')
        .applicable,
    ).toBe('not_applicable');
  });

  it('学校: 就学通知書(教科用図書給与証明書)・日数の記載なし / 小中学生かフラグで該当', () => {
    const o = outcome(
      profile({ ageBands: ['elementary', 'adult'], memberCount: 2 }),
      'procedure_school_transfer',
    );
    expect(o.applicable).toBe('applicable');
    expect(o.dueDate).toBeUndefined();
    expect(o.dueDescription).toContain('就学通知書');
    expect(o.dueDescription).toContain('教科用図書給与証明書');
    expect(o.dueDescription).not.toContain('転入学通知書');
    expect(o.dueDescription).toContain('記載がありません');
    expect(
      outcome(profile({ flags: { hasSchoolOrChildcareNeeds: true } }), 'procedure_school_transfer')
        .applicable,
    ).toBe('applicable');
    expect(
      outcome(profile({ ageBands: ['age0_2', 'adult'] }), 'procedure_school_transfer').applicable,
    ).toBe('not_applicable');
  });

  it('保育: 未就学児かフラグで該当・日付なし(入園希望月ごとの締切)', () => {
    for (const band of ['age0_2', 'age3_5'] as const) {
      const o = outcome(
        profile({ ageBands: [band, 'adult'], memberCount: 2 }),
        'procedure_childcare_application',
      );
      expect(o.applicable, band).toBe('applicable');
      expect(o.dueDate, band).toBeUndefined();
    }
    const due = ruleOf('procedure_childcare_application').dueDescription ?? '';
    expect(due).toContain('入園希望月の前月末日までに転入');
    expect(due).toContain('前月15日');
    expect(
      outcome(
        profile({ ageBands: ['elementary', 'adult'], memberCount: 2 }),
        'procedure_childcare_application',
      ).applicable,
    ).toBe('not_applicable');
  });

  it('犬: マイクロチップなしで該当・日数の記載なし(30日は新規登録の期限) / チップ不明は要確認 / チップありは非該当', () => {
    const noChip = outcome(
      profile({ flags: { hasDog: true, dogHasMicrochip: false } }),
      'procedure_dog_registration_transfer',
    );
    expect(noChip.applicable).toBe('applicable');
    expect(noChip.dueDate).toBeUndefined();
    expect(noChip.dueDescription).toContain('記載がありません');
    expect(noChip.dueDescription).toContain('飼い始めたときの登録');

    const unknown = outcome(
      profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } }),
      'procedure_dog_registration_transfer',
    );
    expect(unknown.applicable).toBe('needs_confirmation');
    expect(unknown.applicabilityReason).toContain('マイクロチップ');

    expect(
      outcome(
        profile({ flags: { hasDog: true, dogHasMicrochip: true } }),
        'procedure_dog_registration_transfer',
      ).applicable,
    ).toBe('not_applicable');
    expect(outcome(profile({}), 'procedure_dog_registration_transfer').applicable).toBe(
      'not_applicable',
    );
  });

  it('ごみ: 全員該当・日付なし・公式の町名一覧へ誘導し、有料の指定収集袋に触れる', () => {
    const o = outcome(profile({}), 'procedure_waste_check');
    expect(o.applicable).toBe('applicable');
    expect(o.dueDate).toBeUndefined();
    expect(o.dueDescription).toContain('収集地区');
    expect(o.dueDescription).toContain('指定収集袋');
    expect(o.dueDescription).toContain('保持していません');
    const pv = procedures().find((p) => p.id === 'procedure_waste_check');
    expect(pv?.onlineUrl).toBe(
      'https://www.city.hachioji.tokyo.jp/kurashi/gomi/kateigomi/shushubi/p029891.html',
    );
  });

  it('単身・都外・マイナンバーあり は8件該当(市5件+ライフライン3件)・子育て/犬/運転免許は非該当', () => {
    const single = profile({ flags: { hasMyNumberCard: true } });
    const applicable = evaluate(single, ruleSet)
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
        'procedure_water_supply',
        'procedure_postal_forwarding',
        'procedure_utilities_contact',
      ].sort(),
    );
    expect(outcome(single, 'procedure_driver_license_change').applicable).toBe('not_applicable');
  });

  it('転出予定日を起算日にするルールは、公式文言に「転出予定日」がある(ADR-013の回帰ガード)', () => {
    const origins = (d: DueRule): string[] =>
      d.type === 'offsetDays' ? [d.from] : d.type === 'earliestOf' ? d.of.map((x) => x.from) : [];
    const usesMoveOut = ruleSet.rules.filter((r) =>
      origins(r.dueRule).includes('moveOutScheduledDate'),
    );
    expect(usesMoveOut.map((r) => r.procedureId).sort()).toEqual(
      ['procedure_child_allowance', 'procedure_mynumber_continued_use'].sort(),
    );
    for (const r of usesMoveOut) {
      expect(r.dueDescription ?? '', r.procedureId).toContain('転出予定日');
    }
  });

  it('転出予定日の案内: 未入力の子育て世帯には児童手当が「入れれば出る」・マイナンバーが「早まりうる」', () => {
    const impact = moveOutScheduledDateImpact(family(), ruleSet);
    expect(impact.enablesDueDateFor).toEqual(['procedure_child_allowance']);
    expect(impact.advancesDueDateFor).toEqual(['procedure_mynumber_continued_use']);
    // 入力済みなら得られるものは無い。
    const done = moveOutScheduledDateImpact(
      family({ moveOutScheduledDate: '2026-07-31' }),
      ruleSet,
    );
    expect(done.enablesDueDateFor).toEqual([]);
    expect(done.advancesDueDateFor).toEqual([]);
  });

  it('比較ページの機械判定: 4トピックとも「判定できません」に落ちない(承認後にそのまま載せられる)', () => {
    const report = buildWardDifferences([
      {
        municipalityCode: HACHIOJI,
        municipalityName: '八王子市',
        rules: ruleSet.rules,
        procedures: procedures(),
        sources: new Map(
          [...ruleSet.rules.flatMap((r) => r.sourceIds)].map((id) => [
            id,
            {
              sourceId: id,
              title: `${id} の出典`,
              url: `https://example.invalid/${id}`,
              lastVerifiedAt: LAST_VERIFIED,
            },
          ]),
        ),
      },
    ]);
    const valueOf = (topicId: string) =>
      report.topics.find((t) => t.topicId === topicId)?.cells[0]?.valueId;
    for (const t of report.topics) {
      expect(t.cells[0]?.valueId, t.topicId).not.toBe('undetermined');
    }
    expect(valueOf('mynumber_continued_use_window')).toBe('stated_90days');
    expect(valueOf('child_allowance_15day_origin')).toBe('move_out_scheduled_date');
    expect(valueOf('dog_registration_change_days')).toBe('not_stated');
    expect(valueOf('child_medical_application_deadline')).toBe('month_3');
  });
});

describe('八王子市 — 自治体以外(ライフライン等)の4手続き(ADR-009)', () => {
  const WARD_TEMPLATE = '13101';
  const templateProcs = new Map(
    (
      readJson(`data/normalized/${WARD_TEMPLATE}/procedures.json`) as { procedures: unknown[] }
    ).procedures
      .map((p) => procedureVersionSchema.parse(p))
      .map((p) => [p.id, p]),
  );
  const templateRules = new Map(
    ruleSetSchema
      .parse(readJson(`packages/rules/data/${WARD_TEMPLATE}/rules.json`))
      .rules.map((r) => [r.procedureId, r]),
  );
  /** 区の共通テンプレートから市向けに置き換えた言い回し(これ以外は同一であるべき)。 */
  const toCity = (s: string) =>
    s
      .replace(
        'この手続きは区(自治体)の窓口ではなく、区以外の機関・事業者への手続きです。',
        'この手続きは市(自治体)の窓口ではなく、市区町村以外の機関・事業者への手続きです。',
      )
      .replace('(区の手続きではなく', '(市の手続きではなく')
      .replace('(区の手続きではありません)', '(市の手続きではありません)')
      .replace('本サービスの区の窓口一覧', '本サービスの市の窓口一覧');
  const byId = (id: string) => {
    const p = procedures().find((x) => x.id === id);
    if (!p) throw new Error(`missing ${id}`);
    return p;
  };

  it.each([
    'procedure_postal_forwarding',
    'procedure_utilities_contact',
    'procedure_driver_license_change',
  ])(
    '%s: 都/国の出典がそのまま当てはまるため、区の共通テンプレートと「区」の言い回し以外は同一',
    (id) => {
      const t = templateProcs.get(id);
      expect(t).toBeDefined();
      if (!t) return;
      const expected = JSON.parse(toCity(JSON.stringify(t))) as typeof t;
      const actual = byId(id);
      const strip = (p: typeof t) => {
        const {
          municipalityCode: _m,
          version: _v,
          lastVerifiedAt: _l,
          dataStatus: _d,
          ...rest
        } = p;
        return rest;
      };
      expect(strip(actual)).toEqual(strip(expected));
      expect(actual.dataStatus).toBe('verified');
      const tr = templateRules.get(id);
      expect(ruleOf(id)).toEqual(tr ? JSON.parse(toCity(JSON.stringify(tr))) : undefined);
    },
  );

  it('水道: 八王子市向けの文言で、23区限定の下水道の案内を持ち込まない', () => {
    const w = byId('procedure_water_supply');
    const text = JSON.stringify(w);
    expect(text).not.toContain('23区');
    expect(text).not.toContain('下水道局への届出は必要ありません');
    expect(w.sourceIds).not.toContain('src-13000-sewerage-001');
    expect(w.sourceIds.sort()).toEqual(
      [
        'src-13000-water_supply-001',
        'src-13000-water_supply-002',
        'src-13201-water_supply-001',
        'src-13201-sewerage-001',
        'src-13201-sewerage-002',
      ].sort(),
    );
    // 市の公式ページが明記している事実。
    expect(w.cautions?.[0]).toContain('市役所ではなく東京都水道局');
    expect(text).toContain('水道料金と一緒に2か月ごとに納めます');
    // 水道水だけの世帯の下水道の届出は市のページに記載が無い → 無いと明示し、要否を断定しない。
    expect(text).toContain('記載がありません');
    expect(text).not.toContain('下水道の届出は不要');
    expect(w.contact).toContain('0570-091-100');
    // 期限は東京都水道局の「3〜4日前まで」をそのまま示し、日付にはしない。
    expect(ruleOf('procedure_water_supply').dueRule).toEqual({ type: 'unknown' });
    expect(w.dueDescription).toContain('3〜4日前');
  });

  it('4件とも「市区町村以外の手続き」であることを cautions の先頭で明示し、「区」の言い回しが無い', () => {
    for (const id of NON_MUNICIPAL_IDS) {
      const p = byId(id);
      expect(p.cautions?.[0], id).toContain('市区町村以外の機関・事業者への手続き');
      const text = JSON.stringify(p) + JSON.stringify(ruleOf(id));
      for (const bad of ['区以外', '区の手続き', '区(自治体)', '区の窓口']) {
        expect(text.includes(bad), `${id}: ${bad}`).toBe(false);
      }
    }
  });

  it('該当判定: 水道・郵便・電気ガスは全員該当 / 運転免許は車・バイクの案内が必要な人だけ / 日付は出さない', () => {
    for (const id of [
      'procedure_water_supply',
      'procedure_postal_forwarding',
      'procedure_utilities_contact',
    ]) {
      for (const originType of ['outside_tokyo', 'inside_tokyo', 'overseas'] as const) {
        const o = outcome(profile({ originType }), id);
        expect(o.applicable, `${id}/${originType}`).toBe('applicable');
        expect(o.dueDate, id).toBeUndefined();
      }
    }
    expect(outcome(profile({}), 'procedure_driver_license_change').applicable).toBe(
      'not_applicable',
    );
    const car = outcome(
      profile({ flags: { needsVehicleGuidance: true } }),
      'procedure_driver_license_change',
    );
    expect(car.applicable).toBe('applicable');
    expect(car.dueDate).toBeUndefined();
  });

  it('東京都水道局の追加出典のスナップショットも content_hash と一致する', () => {
    const s = registry.byId.get('src-13000-water_supply-002');
    const dir = resolve(repoRoot, 'data/sources/13000/snapshots');
    const current = pickCurrentSnapshot(readdirSync(dir), 'src-13000-water_supply-002', 'html');
    expect(current).not.toBeNull();
    const hash = createHash('sha256')
      .update(readFileSync(resolve(dir, current as string)))
      .digest('hex');
    expect(hash).toBe(s?.contentHash);
  });
});

describe('八王子市 — 来歴と越境しないこと', () => {
  it('全ルール・全手続き・全施設の sourceIds が台帳に実在し、市の手続きは八王子市の出典だけを使う', () => {
    const isMunicipal = (id: string) => (MUNICIPAL_IDS as readonly string[]).includes(id);
    const ids = [
      ...ruleSet.rules.flatMap((r) => r.sourceIds),
      ...procedures().flatMap((p) => p.sourceIds),
      ...facilities().map((f) => f.sourceId),
    ];
    for (const sid of ids) {
      expect(registry.byId.get(sid), `missing ${sid}`).toBeDefined();
    }
    const municipalIds = [
      ...ruleSet.rules.filter((r) => isMunicipal(r.procedureId)).flatMap((r) => r.sourceIds),
      ...procedures()
        .filter((p) => isMunicipal(p.id))
        .flatMap((p) => p.sourceIds),
      ...facilities().map((f) => f.sourceId),
    ];
    for (const sid of municipalIds) {
      expect(registry.byId.get(sid)?.municipalityCode, sid).toBe(HACHIOJI);
    }
    // 自治体以外の4件が使ってよいのは、八王子市・東京都(13000)・国(00000)の出典だけ(他の区の出典は使わない)。
    for (const sid of procedures()
      .filter((p) => !isMunicipal(p.id))
      .flatMap((p) => p.sourceIds)) {
      expect(['13201', '13000', '00000'], sid).toContain(registry.byId.get(sid)?.municipalityCode);
    }
    // 逆方向: 台帳に登録した出典は、どこからも参照されずに放置されていない。
    for (const s of hachiojiSources) {
      expect(ids, s.sourceId).toContain(s.sourceId);
    }
  });

  it('出典スナップショットが存在し content_hash と一致する', () => {
    const dir = resolve(repoRoot, `data/sources/${HACHIOJI}/snapshots`);
    const files = readdirSync(dir);
    for (const s of hachiojiSources) {
      const current = pickCurrentSnapshot(files, s.sourceId, s.sourceType);
      expect(current, `snapshot missing: ${s.sourceId}`).not.toBeNull();
      const hash = createHash('sha256')
        .update(readFileSync(resolve(dir, current as string)))
        .digest('hex');
      expect(hash, s.sourceId).toBe(s.contentHash);
    }
  });

  it('出典URLは八王子市の公式2ホスト(市公式サイト・子育て応援サイト)の https のみ', () => {
    const allowed = new Set(['www.city.hachioji.tokyo.jp', 'kosodate.city.hachioji.tokyo.jp']);
    for (const s of hachiojiSources) {
      expect(isOfficialUrl(s.url), s.url).toBe(true);
      expect(allowed.has(new URL(s.url).hostname), s.url).toBe(true);
    }
  });

  it('越境: 八王子市のプロフィールを他自治体のルールで、他自治体のプロフィールを八王子市のルールで評価すると例外', () => {
    for (const other of ['13101', '13112', '13121', '13123']) {
      const otherSet = ruleSetSchema.parse(readJson(`packages/rules/data/${other}/rules.json`));
      expect(() => evaluate(profile({}), otherSet)).toThrow(MunicipalityScopeMismatchError);
      expect(() => evaluate(profile({ municipalityCode: other }), ruleSet)).toThrow(
        MunicipalityScopeMismatchError,
      );
    }
  });

  it('文言に23区の名称が現れない(ルール・手続き・施設・台帳の公開列)', () => {
    const blob = [
      JSON.stringify(ruleSet),
      readFileSync(resolve(repoRoot, `data/normalized/${HACHIOJI}/procedures.json`), 'utf-8'),
      JSON.stringify(facilities()),
      ...hachiojiSources.map((s) => s.sourceId),
    ].join('\n');
    const registryText = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.startsWith('src-13201-'))
      .join('\n');
    for (const name of WARD_NAMES) {
      expect(blob.includes(name), name).toBe(false);
      expect(registryText.includes(name), name).toBe(false);
    }
  });

  it('利用者に見える文言に「区」を前提にした言い回しが残っていない', () => {
    const offenders = userVisibleTexts().flatMap((t) =>
      WARD_ONLY_PHRASES.filter((w) => t.includes(w)).map((w) => `${w}: ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  it('決定論 — 同一入力で同一結果 + スナップショット(回帰ガード)', () => {
    const p = profile({
      memberCount: 4,
      ageBands: ['age0_2', 'elementary', 'adult'],
      moveOutScheduledDate: '2026-07-20',
      flags: { hasMyNumberCard: true, hasDog: true, dogHasMicrochip: 'unknown' },
    });
    const first = evaluate(p, ruleSet);
    expect(evaluate(p, ruleSet)).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
