import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, ProcedureVersion, RuleSet } from '@tmn/schemas';
import { procedureVersionSchema, ruleSetSchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';

/**
 * なぜ: 2026-08-06 に追加した「自治体以外(ライフライン等)の引越し手続き」4件を、全対応区
 * 横断で機械検証する(ADR-009 / REQUIREMENTS §5.3 P2 の前倒し)。区別テストは各区固有データの
 * 回帰ガードなので、この4件のように「全区で同一であること」自体が要件のデータはここに集約する。
 *
 * ここで固定する不変条件:
 * (a) 4件が対応15区すべてに存在し、内容は municipalityCode 以外まったく同一である
 *     (2026-08-07 に中野13114 / 豊島13116 / 北13117 / 荒川13118 を承認・公開して9区→13区、
 *      続けて足立13121 / 江戸川13123 を承認・公開して13区→15区)
 * (b) 該当判定: 水道・郵便・電気ガスは全員該当 / 運転免許は needsVehicleGuidance が true のときだけ
 * (c) 期限を推測で作らない(4件とも dueRule=unknown → dueDate は生成されない)
 * (d) 2026-08-07 人手レビュー承認(ユーザー決裁。ADR-009)により公開される
 *     (dataStatus=verified かつ 出典は registry で approved)
 * (e) 中立性: 特定の電力・ガス会社や民間引越しポータル事業者を名指ししない
 * (f) 既存の区の手続き10件を壊していない
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const WARDS: readonly string[] = [
  '13101',
  '13104',
  '13108',
  '13109',
  '13111',
  '13112',
  '13114',
  '13115',
  '13116',
  '13117',
  '13118',
  '13119',
  '13120',
  '13121',
  '13123',
];

const NON_MUNICIPAL_IDS = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
  'procedure_driver_license_change',
] as const;

/** 区の手続き(2026-08-06 以前から公開されている10件)。壊れていないことの回帰ガード。 */
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

const NON_MUNICIPAL_SOURCE_IDS = [
  'src-13000-water_supply-001',
  'src-13000-sewerage-001',
  'src-00000-postal_forwarding-001',
  'src-00000-utilities_contact-001',
  'src-13000-driver_license-001',
] as const;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf-8'));
}

function proceduresOf(code: string): ProcedureVersion[] {
  const raw = readJson(`data/normalized/${code}/procedures.json`) as { procedures: unknown[] };
  return raw.procedures.map((p) => procedureVersionSchema.parse(p));
}

function ruleSetOf(code: string): RuleSet {
  return ruleSetSchema.parse(readJson(`packages/rules/data/${code}/rules.json`));
}

const procedures = new Map(WARDS.map((code) => [code, proceduresOf(code)]));
const ruleSets = new Map(WARDS.map((code) => [code, ruleSetOf(code)]));

function nonMunicipalOf(code: string): ProcedureVersion[] {
  return procedures
    .get(code)!
    .filter((p) => (NON_MUNICIPAL_IDS as readonly string[]).includes(p.id));
}

/**
 * なぜ: 「全区で同一」を機械的に比較するため、municipalityCode だけを除いた正規形にする
 * (municipalityCode は区ごとに異なるのが正しい=CLAUDE.md原則4のスコープ表現)。
 */
function withoutMunicipalityCode(p: ProcedureVersion): string {
  const { municipalityCode: _omit, ...rest } = p;
  return JSON.stringify(rest);
}

function profileFor(code: string, overrides: Partial<Profile['flags']> = {}): Profile {
  return {
    destination: { municipalityCode: code },
    moveDate: '2026-09-01',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
      isPregnantMember: false,
      ...overrides,
    },
  };
}

function outcomeFor(code: string, procedureId: string, flags: Partial<Profile['flags']> = {}) {
  const outcome = evaluate(profileFor(code, flags), ruleSets.get(code)!).outcomes.find(
    (o) => o.procedureId === procedureId,
  );
  if (!outcome) throw new Error(`no outcome for ${procedureId} in ${code}`);
  return outcome;
}

describe('非自治体手続き — 全対応区に同一内容で存在する(ADR-009)', () => {
  it.each(WARDS)('%s: 4件の手続きと4件のルールが存在し、区の10件は不変', (code) => {
    const ids = procedures.get(code)!.map((p) => p.id);
    expect(ids).toHaveLength(14);
    for (const id of NON_MUNICIPAL_IDS) expect(ids).toContain(id);
    // 区の手続き10件は追加前と同じ集合のまま(既存を壊していないことの回帰ガード)。
    expect(ids.filter((id) => (MUNICIPAL_IDS as readonly string[]).includes(id)).sort()).toEqual(
      [...MUNICIPAL_IDS].sort(),
    );

    const ruleIds = ruleSets.get(code)!.rules.map((r) => r.procedureId);
    expect(ruleIds.sort()).toEqual(ids.sort());
  });

  it('4件の内容は municipalityCode 以外すべての区で完全に一致する', () => {
    // なぜ: 共通テンプレートから区の数だけ生成する設計(ADR-009)の機械的な裏書き。
    // 文言が区ごとに揺れると「どの区の情報か」が曖昧になり原則4の検証が難しくなる。
    const reference = nonMunicipalOf('13101').map(withoutMunicipalityCode);
    for (const code of WARDS) {
      expect(nonMunicipalOf(code).map(withoutMunicipalityCode)).toEqual(reference);
      for (const p of nonMunicipalOf(code)) {
        expect(p.municipalityCode).toBe(code);
      }
    }
  });

  it('ルール定義も区をまたいで完全に一致する(条件・優先度・期限・出典)', () => {
    const pick = (code: string) =>
      JSON.stringify(
        ruleSets
          .get(code)!
          .rules.filter((r) => (NON_MUNICIPAL_IDS as readonly string[]).includes(r.procedureId)),
      );
    const reference = pick('13101');
    for (const code of WARDS) expect(pick(code)).toBe(reference);
  });
});

describe('非自治体手続き — 該当判定(正例・負例)', () => {
  it.each(WARDS)('%s: 水道・郵便・電気ガスは条件なしで全員該当', (code) => {
    for (const id of [
      'procedure_water_supply',
      'procedure_postal_forwarding',
      'procedure_utilities_contact',
    ]) {
      expect(outcomeFor(code, id).applicable).toBe('applicable');
    }
  });

  it.each(WARDS)('%s: 運転免許は needsVehicleGuidance=false で非該当(負例)', (code) => {
    expect(outcomeFor(code, 'procedure_driver_license_change').applicable).toBe('not_applicable');
  });

  it.each(WARDS)('%s: 運転免許は needsVehicleGuidance=true で該当(正例)', (code) => {
    const outcome = outcomeFor(code, 'procedure_driver_license_change', {
      needsVehicleGuidance: true,
    });
    expect(outcome.applicable).toBe('applicable');
    expect(outcome.sourceIds).toEqual(['src-13000-driver_license-001']);
  });

  it('免許フラグの ON/OFF 以外で該当集合は変わらない(他フラグと独立)', () => {
    const off = evaluate(profileFor('13112'), ruleSets.get('13112')!)
      .outcomes.filter((o) => o.applicable === 'applicable')
      .map((o) => o.procedureId);
    const on = evaluate(profileFor('13112', { needsVehicleGuidance: true }), ruleSets.get('13112')!)
      .outcomes.filter((o) => o.applicable === 'applicable')
      .map((o) => o.procedureId);
    expect(on.filter((id) => !off.includes(id))).toEqual(['procedure_driver_license_change']);
  });
});

describe('非自治体手続き — 期限を推測で作らない(原則3)', () => {
  it.each(WARDS)('%s: 4件とも dueRule=unknown で dueDate を生成しない', (code) => {
    for (const id of NON_MUNICIPAL_IDS) {
      const rule = ruleSets.get(code)!.rules.find((r) => r.procedureId === id)!;
      expect(rule.dueRule.type).toBe('unknown');
      // 静的な ProcedureVersion 側も dueDate を持たず、公式文言(dueDescription)のみ。
      const pv = procedures.get(code)!.find((p) => p.id === id)!;
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
      // 実行時にも日付は生成されない(needs_confirmation/applicable いずれでも)。
      expect(outcomeFor(code, id, { needsVehicleGuidance: true }).dueDate).toBeUndefined();
    }
  });

  it('公式に日数の記載が無いことを利用者向け文言で明示している', () => {
    const byId = new Map(nonMunicipalOf('13112').map((p) => [p.id, p]));
    // 水道: 「3〜4日前まで」は公式の前倒し表現。引越し日起算のN日以内ではないことを明示する。
    expect(byId.get('procedure_water_supply')!.dueDescription).toContain('3〜4日前');
    // 郵便: 3〜7営業日は「登録に要する処理日数」であって期限ではない。
    expect(byId.get('procedure_postal_forwarding')!.dueDescription).toContain('3〜7営業日');
    for (const id of NON_MUNICIPAL_IDS) {
      const text = byId.get(id)!.dueDescription!;
      expect(text).toMatch(/記載がありません|要確認/);
      // 「◯日以内」を断定する文言を作っていない(数字+日以内 の断定形が無い)。
      expect(text).not.toMatch(/\d+日以内に(手続き|届出|申請)/);
    }
  });
});

describe('非自治体手続き — 人手レビュー承認済みで公開される(ADR-007 / ADR-009 2026-08-07決裁)', () => {
  const registry = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
  const rows = registry
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split(',')); // source_id / review_status は引用符を含まない先頭列と定位置列

  it.each(WARDS)(
    '%s: 4件とも dataStatus=verified(2026-08-07 人手レビュー承認により公開対象)',
    (code) => {
      for (const p of nonMunicipalOf(code)) {
        expect(p.dataStatus).toBe('verified');
        expect(p.lastVerifiedAt).toBe('2026-08-06T00:00:00Z');
        expect(p.sourceIds.length).toBeGreaterThan(0);
      }
    },
  );

  it('5つの出典が registry.csv に実在し、2026-08-07 人手レビューにより approved である', () => {
    const ids = new Set(rows.map((r) => r[0]));
    for (const sid of NON_MUNICIPAL_SOURCE_IDS) {
      expect(ids.has(sid)).toBe(true);
    }
    const statusIdx = (registry.split(/\r?\n/)[0] ?? '').split(',').indexOf('review_status');
    expect(statusIdx).toBeGreaterThan(0);
    for (const sid of NON_MUNICIPAL_SOURCE_IDS) {
      const row = rows.find((r) => r[0] === sid)!;
      expect(row[statusIdx]).toBe('approved');
    }
  });

  it('4件が参照する出典は上記5件だけ(区のソースを流用していない)', () => {
    const used = new Set(nonMunicipalOf('13112').flatMap((p) => p.sourceIds));
    expect([...used].sort()).toEqual([...NON_MUNICIPAL_SOURCE_IDS].sort());
    // 区のソース(src-131xx-…)は一切参照しない=区の情報と混ぜない(原則4)。
    for (const sid of used) expect(sid).not.toMatch(/^src-131\d\d-/);
  });
});

describe('非自治体手続き — 電気・ガスの中立性(ADR-009)', () => {
  /**
   * なぜ: 特定の小売電気事業者・ガス事業者・民間の引越しポータルを名指しすると、公共サービスとしての
   * 中立性を損ない、かつ非公式情報を一次根拠にすることにつながる(CLAUDE.md原則5)。
   * 名前が混入したら必ず落ちるようにしておく。
   */
  const FORBIDDEN_VENDORS = [
    '東京電力',
    'TEPCO',
    '東京ガス',
    '大阪ガス',
    'ニチガス',
    'ENEOS',
    '出光',
    'Looop',
    'auでんき',
    'ソフトバンクでんき',
    '楽天でんき',
    'CDエナジー',
    'エルピオ',
    '引越れんらく帳',
    'Smyb',
    'xID',
    'ズバット',
    '引越し侍',
  ];

  const utilities = nonMunicipalOf('13112').find((p) => p.id === 'procedure_utilities_contact')!;
  const allText = WARDS.flatMap((code) =>
    nonMunicipalOf(code).map(
      (p) =>
        `${p.title}\n${p.shortDescription}\n${p.applicabilityReason}\n${p.dueDescription ?? ''}\n` +
        `${(p.cautions ?? []).join('\n')}\n${p.requiredDocuments.map((d) => d.label).join('\n')}\n` +
        `${(p.locations ?? []).join('\n')}\n${p.contact ?? ''}\n${p.onlineUrl ?? ''}`,
    ),
  ).join('\n');

  it('4件のどの文言にも特定の電力・ガス・引越しポータル事業者名が現れない', () => {
    for (const vendor of FORBIDDEN_VENDORS) {
      expect(allText).not.toContain(vendor);
    }
  });

  it('電気・ガスの出典は国(デジタル庁)の公式ページ1件のみ', () => {
    expect(utilities.sourceIds).toEqual(['src-00000-utilities_contact-001']);
    // 事業者サイトへの誘導URLは持たない(オンライン申請先を特定しない)。
    expect(utilities.onlineUrl).toBeUndefined();
    // 手続き方法(channels)も契約先により異なるため確定させない。
    expect(utilities.channels).toEqual([]);
  });

  it('契約先の確認方法は「検針票・請求書・マイページ」の一般的な案内にとどめる', () => {
    const text = `${utilities.shortDescription}\n${(utilities.cautions ?? []).join('\n')}\n${utilities.requiredDocuments.map((d) => d.label).join('\n')}`;
    expect(text).toContain('検針票');
    expect(text).toContain('請求書');
    expect(text).toContain('マイページ');
    expect(text).toContain('名指し');
    // 必要書類は公式に記載が無いため unknown(未知を未知と明示する)。
    expect(utilities.requiredDocuments.every((d) => d.status === 'unknown')).toBe(true);
  });

  it('4件とも「区の手続きではない」ことを cautions の先頭で明示する', () => {
    for (const code of WARDS) {
      for (const p of nonMunicipalOf(code)) {
        expect(p.cautions?.[0]).toContain('区以外の機関・事業者への手続き');
      }
    }
  });
});
