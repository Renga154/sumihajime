import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import { facilitySchema, procedureVersionSchema, ruleSetSchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: Batch9(目黒13110 / 渋谷13113 / 葛飾13122)の縦切りデータの来歴・型・決定論・
 * **区ごとに異なる期限と分岐** をCIで機械検証する。ユーザー決裁(2026-08-07
 * 「23区全対応・案A=手続き中心で埋め、付帯データは取れる区だけ」)に基づく追加であり、
 * 3区とも人手レビュー未了(全ソース review_status=pending / 全手続き dataStatus=partial)。
 *
 * 本バッチで特に固定したい不変条件:
 * (a) **目黒区は狂犬病予防法の特例制度に参加していない**。目黒区公式ページは
 *     「目黒区は…『狂犬病予防法の特例制度』に参加しないため、狂犬病予防法における犬の
 *     登録などの手続きは従来通り区の窓口で行う必要があります」と明記している。したがって
 *     目黒区のルールは dogHasMicrochip で分岐させず hasDog のみで該当とし、マイクロチップ
 *     登録済み(true)でも未確認(unknown)でも applicable になる。渋谷・葛飾は逆に
 *     「登録済みなら区の窓口不要」なので true→not_applicable / unknown→needs_confirmation。
 *     他区のロジックを目黒へコピーすると誤案内になるため、この差異を回帰ガードで固定する。
 * (b) **犬の届出期限も根拠の対象が区で違う**: 目黒=「変更の届出 変更後30日以内」が転入を
 *     含む変更全般に掛かるため moveDate+30 を算定する。葛飾の「30日以内(生後90日以内の犬は
 *     生後120日以内)」は**新規に飼い始めたときの登録**の期限であって転入時の住所変更の期限
 *     ではないため算定しない(事前監査の記述を原文確認で訂正)。渋谷は日数の記載自体がない。
 * (c) **子ども医療費助成の期限が区ごとに違う**: 目黒=3か月 / 渋谷=**14日** / 葛飾=3か月。
 *     共通デフォルト値を作らない(CLAUDE.md原則3)。
 * (d) **マイナンバーカード継続利用の失効条件の記述量が区で違う**: 目黒=90日のみ(30日・14日の
 *     記載が公式ページに無い) / 渋谷=90日+30日 / 葛飾=90日+30日+14日。無い条件を補わない。
 * (e) 児童手当の15日特例は3区とも「前住所地の転出予定日」起算のため moveDate から算定しない。
 * (f) 学校の交付書類名: 目黒=入学指定通知書 / 渋谷=就学通知書 / 葛飾=名称の記載なし。
 * (g) 付帯データの誠実縮退: 3区とも waste.json / waste-sorting.json を作らない。
 * (h) 公開ゲート(ADR-007): 3区の全ソースが registry.csv で pending であること。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const MEGURO = '13110';
const SHIBUYA = '13113';
const KATSUSHIKA = '13122';
const BATCH9 = [MEGURO, SHIBUYA, KATSUSHIKA] as const;
/** マイクロチップ登録済みなら区の窓口が不要になる区(目黒区はここに含まれない)。 */
const MICROCHIP_EXEMPT = [SHIBUYA, KATSUSHIKA] as const;
const RULE_VERSION = '2026-08-07.1';
const LAST_VERIFIED = '2026-08-07T00:00:00Z';

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
  BATCH9.map((code) => [code, ruleSetOf(code)]),
);

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: overrides.municipalityCode ?? MEGURO },
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

/** 犬あり+マイクロチップ状態を指定したプロフィールの犬ルール評価。 */
function dogOutcome(code: string, dogHasMicrochip: Profile['flags']['dogHasMicrochip']) {
  return outcomeFor(
    profile({ municipalityCode: code, flags: { hasDog: true, dogHasMicrochip } }),
    code,
    'procedure_dog_registration_transfer',
  );
}

describe('Batch9 — schema validation & pending status (CI gate)', () => {
  it.each(BATCH9)(
    '%s: rules.json が RuleSet として parse し 10ルール・自治体スコープ一致',
    (code) => {
      const rs = RULE_SETS[code] as RuleSet;
      expect(rs.municipalityCode).toBe(code);
      expect(rs.ruleVersion).toBe(RULE_VERSION);
      expect(rs.rules.length).toBe(10);
    },
  );

  it.each(BATCH9)('%s: procedures.json が10件 parse し 全件 partial(人手レビュー未了)', (code) => {
    const procedures = proceduresOf(code);
    expect(procedures.length).toBe(10);
    for (const pv of procedures) {
      expect(pv.municipalityCode).toBe(code);
      // ADR-007: 公開単位は verified のみ。partial は公開(D1シード)対象に入らない。
      expect(pv.dataStatus).toBe('partial');
      expect(pv.version).toBe(RULE_VERSION);
      expect(pv.lastVerifiedAt).toBe(LAST_VERIFIED);
      expect(pv.sourceIds.length).toBeGreaterThan(0);
      // 期限は dueDate(算定式)ではなく dueDescription(公式文言)を静的に保持する。
      expect(pv.dueDate).toBeUndefined();
      expect(pv.dueDescription).toBeDefined();
    }
  });

  it.each(BATCH9)('%s: procedures と rules が同一の10 procedureId を過不足なく覆う', (code) => {
    const procIds = proceduresOf(code)
      .map((p) => p.id)
      .sort();
    const ruleIds = (RULE_SETS[code] as RuleSet).rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口件数(目黒5 / 渋谷10 / 葛飾7)と座標の不存在', () => {
    // 目黒: 総合庁舎戸籍住民課 + 地区サービス事務所4(北部・中央・南部・西部)。
    // 東部地区サービス事務所は公式ページで引越しの届出を扱わない旨が明記されているため除外。
    // 公共施設一覧CSVは配信元 data.bodik.jp が常時403で取得できず公式ページ由来のみ。
    const meguro = facilitiesOf(MEGURO);
    expect(meguro.length).toBe(5);
    expect(meguro.map((f) => f.name)).not.toContain('東部地区サービス事務所');

    // 渋谷: 区役所3階住民戸籍課 + 出張所8 + 区民サービスセンター。
    // 新橋出張所は窓口業務終了と公式ページに明記されているため除外。
    const shibuya = facilitiesOf(SHIBUYA);
    expect(shibuya.length).toBe(10);
    expect(shibuya.map((f) => f.name)).not.toContain('新橋出張所');

    // 葛飾: 区役所本庁舎戸籍住民課 + 区民事務所6(金町・亀有・新小岩・高砂・堀切・水元)。
    const katsushika = facilitiesOf(KATSUSHIKA);
    expect(katsushika.length).toBe(7);
    expect(katsushika.map((f) => f.name).filter((n) => n.endsWith('区民事務所')).length).toBe(6);

    // 3区とも出典ページに緯度経度が無いため座標を持たない(捏造回避)。
    for (const code of BATCH9) {
      for (const f of facilitiesOf(code)) {
        expect(f.lat, `${code}/${f.facilityId}`).toBeUndefined();
        expect(f.lng, `${code}/${f.facilityId}`).toBeUndefined();
      }
    }
  });

  it('coverage.csv — 3区は全カテゴリ unavailable(未対応を一部対応に見せない)', () => {
    // なぜ: 3区は人手レビュー未了で公開データが1件も無く municipalities.ts の supported も
    // false のため、利用者から見て実際に使えるカテゴリが存在しない(CLAUDE.md原則9)。
    const rows = readFileSync(resolve(repoRoot, 'docs/data-sources/coverage.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const header = (rows[0] as string).split(',');
    for (const code of BATCH9) {
      const row = rows.find((l) => l.startsWith(`${code},`));
      expect(row, `coverage row missing for ${code}`).toBeDefined();
      const cells = (row as string).split(',');
      for (let i = 2; i <= 13; i++) {
        expect(cells[i], `${code} / ${header[i]}`).toBe('unavailable');
      }
    }
  });

  it.each(BATCH9)(
    '%s: waste.json / waste-sorting.json を作らない — 誠実縮退の回帰ガード',
    (code) => {
      // 目黒=収集曜日は住所別検索ツールと地域別PDFのみ(CSVなし・HTML表なし)、
      // 渋谷=収集曜日は構造化HTML表があるがパーサ整備は23区完了後・分別CSVは区公式ドメイン外配信、
      // 葛飾=収集曜日は地区別PDFのみで『ゴミ集積所一覧』CSVは実質2行。
      // いずれも推測で曜日を作らない。
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste.json`))).toBe(false);
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste-sorting.json`))).toBe(
        false,
      );
    },
  );
});

describe('Batch9 — 目黒区は狂犬病予防法の特例制度に参加していない(最重要の分岐差)', () => {
  it('目黒: マイクロチップ登録済みでも区の窓口手続きが必要=該当のまま', () => {
    const chipped = dogOutcome(MEGURO, true);
    expect(chipped.applicable).toBe('applicable');
    // 他区の「登録済みなら来庁不要」を目黒に適用していないこと。
    expect(chipped.applicable).not.toBe('not_applicable');
    expect(chipped.applicabilityReason).toContain('特例制度');
    expect(chipped.applicabilityReason).toContain('参加しない');
  });

  it('目黒: マイクロチップの状態が未確認でも判定は保留にならない(該当が確定する)', () => {
    // なぜ: 目黒区では届出先がマイクロチップの有無で変わらないため、未確認でも
    // needs_confirmation にせず applicable と断定できる。保留にすると利用者に
    // 不要な確認作業を強いる。
    const unknownChip = dogOutcome(MEGURO, 'unknown');
    expect(unknownChip.applicable).toBe('applicable');
    expect(unknownChip.applicable).not.toBe('needs_confirmation');
  });

  it('目黒: ルール条件が dogHasMicrochip を参照していない', () => {
    const rule = (RULE_SETS[MEGURO] as RuleSet).rules.find(
      (r) => r.procedureId === 'procedure_dog_registration_transfer',
    );
    expect(JSON.stringify(rule?.condition)).not.toContain('dogHasMicrochip');
    // 分岐しないので保留理由も持たない。
    expect(rule?.needsConfirmationReason).toBeUndefined();
  });

  it.each(MICROCHIP_EXEMPT)('%s: マイクロチップ登録済みなら区の窓口は不要=非該当', (code) => {
    expect(dogOutcome(code, true).applicable).toBe('not_applicable');
  });

  it.each(MICROCHIP_EXEMPT)(
    '%s: マイクロチップ未確認は needs_confirmation(C-10 推測しない)',
    (code) => {
      const o = dogOutcome(code, 'unknown');
      expect(o.applicable).toBe('needs_confirmation');
      expect(o.applicabilityReason).toContain('マイクロチップ');
    },
  );

  it('犬の届出期限: 目黒=moveDate+30日を算定 / 渋谷・葛飾=算定しない(根拠の対象が違う)', () => {
    // 目黒区公式ページは「変更の届出 変更後30日以内に届出してください」の直下に
    // 「目黒区へ転入」を置いており、転入が30日の対象であることが読み取れる。
    const meguro = dogOutcome(MEGURO, false);
    expect(meguro.dueDate).toBe('2026-08-31');
    expect(meguro.dueDescription).toBeUndefined();
    expect(ruleDueDescription(MEGURO, 'procedure_dog_registration_transfer')).toContain('30日以内');

    // 渋谷は日数の記載自体がない。
    const shibuya = dogOutcome(SHIBUYA, false);
    expect(shibuya.dueDate).toBeUndefined();
    expect(shibuya.dueDescription).toContain('記載がありません');

    // 葛飾の「30日以内(生後90日以内の犬は生後120日以内)」は新規に飼い始めたときの
    // 登録期限であって転入時の住所変更の期限ではない。期限を算定しないこと、および
    // 誤解を招かないよう文言でその区別を明示していることを固定する。
    const katsushika = dogOutcome(KATSUSHIKA, false);
    expect(katsushika.dueDate).toBeUndefined();
    expect(katsushika.dueDescription).toContain('記載がありません');
    expect(katsushika.dueDescription).toContain('飼い始めたとき');
  });

  it('目黒の犬の手続きは「窓口不要」と読める文言を含まない', () => {
    const due = ruleDueDescription(MEGURO, 'procedure_dog_registration_transfer');
    expect(due).not.toContain('窓口での手続きは不要');
    expect(due).not.toContain('区への届出は不要');
    expect(due).not.toContain('来所は不要');
    expect(due).toContain('区の受付窓口');
  });
});

describe('Batch9 — 区ごとに異なる期限(共通デフォルト値を作らない)', () => {
  it('転入届は3区とも moveDate+14日(共通なのは公式に14日と書かれているから)', () => {
    for (const code of BATCH9) {
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

  it('国民健康保険も3区とも moveDate+14日', () => {
    for (const code of BATCH9) {
      const o = outcomeFor(
        profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: true } }),
        code,
        'procedure_national_health_insurance',
      );
      expect(o.dueDate).toBe('2026-08-15');
    }
  });

  it('子ども医療費助成: 目黒=3か月 / 渋谷=14日 / 葛飾=3か月(他区の値を混入させない)', () => {
    const due = (code: string) =>
      outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDescription ?? '';

    for (const code of [MEGURO, KATSUSHIKA]) {
      const d = due(code);
      expect(d, code).toContain('3か月以内');
      expect(d, code).not.toContain('14日以内');
      expect(d, code).not.toContain('15日以内');
      expect(d, code).not.toContain('2か月');
      expect(d, code).not.toContain('6カ月');
    }

    // 渋谷は板橋区に次ぐ2例目の14日。3か月・2か月・6カ月を混入させない。
    const shibuya = due(SHIBUYA);
    expect(shibuya).toContain('14日以内');
    expect(shibuya).not.toContain('3か月');
    expect(shibuya).not.toContain('3カ月');
    expect(shibuya).not.toContain('2か月');
    expect(shibuya).not.toContain('6カ月');

    // 3区とも dueDate(算定値)は出さない(「申請すれば遡及」であって届出期限ではないため)。
    for (const code of BATCH9) {
      expect(outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDate).toBeUndefined();
    }
  });

  it('マイナンバー継続利用: 3区とも90日 / 30日は渋谷・葛飾のみ / 14日は葛飾のみ', () => {
    const withCard = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasMyNumberCard: true } }),
        code,
        'procedure_mynumber_continued_use',
      );

    for (const code of BATCH9) {
      const o = withCard(code);
      expect(o.applicable, code).toBe('applicable');
      expect(o.dueDescription, code).toContain('90日');
      // 90日は「転入届出日」起算のため moveDate からは算定しない。
      expect(o.dueDate, code).toBeUndefined();
    }

    // 目黒: 公式ページに30日・14日の失効条件が無いことを明示し、断定文としては書かない。
    const meguro = withCard(MEGURO).dueDescription ?? '';
    expect(meguro).toContain('記載がありません');
    expect(meguro).not.toMatch(/転出予定日から30日以内であること/);

    // 渋谷: 30日+90日の両方が条件。14日の条件は書かれていない。
    const shibuya = withCard(SHIBUYA).dueDescription ?? '';
    expect(shibuya).toContain('転出予定日から30日以内');
    expect(shibuya).toContain('90日以内');
    expect(shibuya).not.toContain('14日');

    // 葛飾: 90日+30日+14日の3条件がすべて明記されている。
    const katsushika = withCard(KATSUSHIKA).dueDescription ?? '';
    expect(katsushika).toContain('90日');
    expect(katsushika).toContain('30日以内');
    expect(katsushika).toContain('14日以内');
  });

  it('児童手当の15日特例: 3区とも「前住所地の転出予定日」起算のため算定しない', () => {
    for (const code of BATCH9) {
      const o = outcomeFor(familyIn(code), code, 'procedure_child_allowance');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('15日以内');
      expect(o.dueDescription, code).toContain('転出予定日');
      // 北区のような「転入日基準」の断定に置き換わっていないこと。
      expect(o.dueDescription, code).not.toContain('事由発生日(出生日・転入日等)の翌日');
    }
  });

  it('国民年金: 3区とも転入時の日数固定の期限は公式ページに記載がない', () => {
    for (const code of BATCH9) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_national_pension_address',
      );
      // 「記載がありません」/「記載はありません」の助詞差は原文の文脈に合わせているため許容する。
      expect(o.dueDescription, code).toMatch(/記載[はが]ありません/);
      // 他区(中野・豊島)の「第1号被保険者は住民異動届のみで足りる」を持ち込んでいないこと。
      expect(o.dueDescription, code).not.toContain('必要ありません');
    }
  });

  it('学校の交付書類名: 目黒=入学指定通知書 / 渋谷=就学通知書 / 葛飾=名称を設定しない', () => {
    const school = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, ageBands: ['elementary', 'adult'], memberCount: 2 }),
        code,
        'procedure_school_transfer',
      ).dueDescription ?? '';

    expect(school(MEGURO)).toContain('入学指定通知書');
    expect(school(MEGURO)).not.toContain('就学通知書');
    expect(school(MEGURO)).not.toContain('転入学通知書');

    expect(school(SHIBUYA)).toContain('就学通知書');
    expect(school(SHIBUYA)).not.toContain('入学指定通知書');
    expect(school(SHIBUYA)).not.toContain('転入学通知書');

    expect(school(KATSUSHIKA)).not.toContain('就学通知書');
    expect(school(KATSUSHIKA)).not.toContain('入学指定通知書');
    expect(school(KATSUSHIKA)).not.toContain('転入学通知書');
  });
});

describe('Batch9 — ペルソナ評価(正例・負例・境界)', () => {
  it.each(BATCH9)('%s: 単身・都外・マイナンバーあり は5件該当・子育て/犬は非該当', (code) => {
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
      ].sort(),
    );
    for (const id of [
      'procedure_child_allowance',
      'procedure_child_medical',
      'procedure_school_transfer',
      'procedure_childcare_application',
      'procedure_dog_registration_transfer',
    ]) {
      expect(outcomeFor(single, code, id).applicable, `${code}/${id}`).toBe('not_applicable');
    }
  });

  it.each(BATCH9)('%s: 国保フラグOFFで非該当(負例)', (code) => {
    const off = profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, code, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
  });

  it.each(BATCH9)('%s: マイナンバーカード無しなら継続利用は非該当(負例)', (code) => {
    const noCard = profile({ municipalityCode: code, flags: { hasMyNumberCard: false } });
    expect(outcomeFor(noCard, code, 'procedure_mynumber_continued_use').applicable).toBe(
      'not_applicable',
    );
  });

  it.each(BATCH9)('%s: 子育て世帯で 児童手当・子ども医療・学校・保育 が増える', (code) => {
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

  it('期限計算の境界: 月末・年末・うるう年を跨いでも暦日で算定する(3区の転入届14日)', () => {
    const at = (code: string, moveDate: string) => {
      const p: Profile = { ...profile({ municipalityCode: code }), moveDate };
      return outcomeFor(p, code, 'procedure_resident_registration').dueDate;
    };
    for (const code of BATCH9) {
      expect(at(code, '2026-08-25'), code).toBe('2026-09-08'); // 月跨ぎ
      expect(at(code, '2026-12-25'), code).toBe('2027-01-08'); // 年跨ぎ
      expect(at(code, '2028-02-20'), code).toBe('2028-03-05'); // うるう年(2月29日を含む)
    }
  });

  it('期限計算の境界: 目黒の犬30日も月跨ぎ・年跨ぎ・うるう年で暦日算定する', () => {
    const at = (moveDate: string) => {
      const p: Profile = {
        ...profile({ municipalityCode: MEGURO, flags: { hasDog: true, dogHasMicrochip: true } }),
        moveDate,
      };
      return outcomeFor(p, MEGURO, 'procedure_dog_registration_transfer').dueDate;
    };
    expect(at('2026-08-25')).toBe('2026-09-24');
    expect(at('2026-12-25')).toBe('2027-01-24');
    expect(at('2028-02-10')).toBe('2028-03-11'); // うるう年(2月29日を含む)
  });
});

describe('Batch9 — provenance integrity & scope safety', () => {
  const registryRows = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);
  const registryIds = new Set(registryRows.map((l) => l.slice(0, l.indexOf(','))));

  it.each(BATCH9)(
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

  it.each(BATCH9)(
    '%s: registry.csv の当該行は全て review_status=pending(未承認データを公開しない)',
    (code) => {
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cells = row.split(',');
        // 列順: ... 15:content_hash, 16:effective_from, 17:effective_to, 18:review_status
        expect(cells[17], row.slice(0, 60)).toBe('pending');
        // content_hash(SHA-256 16進64桁)が記録されていること。
        expect(cells[14], row.slice(0, 60)).toMatch(/^[0-9a-f]{64}$/);
      }
    },
  );

  it.each(BATCH9)('%s: 出典スナップショットが存在し content_hash と一致する', async (code) => {
    const { createHash } = await import('node:crypto');
    const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
    for (const row of rows) {
      const cells = row.split(',');
      const sourceId = cells[0] as string;
      const ext = cells[6] as string;
      const file = resolve(repoRoot, `data/sources/${code}/snapshots/${sourceId}.${ext}`);
      expect(existsSync(file), `snapshot missing: ${file}`).toBe(true);
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(hash, `hash mismatch for ${sourceId}`).toBe(cells[14]);
    }
  });

  it('出典URLのホストが各区の公式サイトに一致する(他区・区外配信を混ぜない)', () => {
    const expectedHost: Record<string, string> = {
      [MEGURO]: 'www.city.meguro.tokyo.jp',
      [SHIBUYA]: 'www.city.shibuya.tokyo.jp',
      [KATSUSHIKA]: 'www.city.katsushika.lg.jp',
    };
    for (const code of BATCH9) {
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const url = new URL(row.split(',')[5] as string);
        expect(url.hostname, row.slice(0, 40)).toBe(expectedHost[code]);
      }
    }
    // 渋谷区の実データ配信先(ArcGIS Hub)は区公式ドメイン外であり、未決裁のため出典にしない。
    expect(registryRows.some((l) => l.includes('opendata.arcgis.com'))).toBe(false);
  });

  it('越境: 各区のプロフィールを他区のルールセットで評価すると必ず例外', () => {
    for (const code of BATCH9) {
      for (const other of BATCH9) {
        if (other === code) continue;
        expect(() =>
          evaluate(profile({ municipalityCode: code }), RULE_SETS[other] as RuleSet),
        ).toThrow(MunicipalityScopeMismatchError);
      }
    }
  });

  it.each(BATCH9)('%s: 利用者向けフィールドに他区(23区)の区名が一切混入していない', (code) => {
    /**
     * なぜ: CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」。利用者の画面に出る
     * 文字列(cautions・applicabilityReason・dueDescription 等)へ他区名が入ると、たとえ
     * 「他区の値は使っていません」という趣旨の注記であっても、別自治体の情報を混ぜたことになる。
     * 期限差の注意喚起は「自治体ごとに異なるため転入前の自治体の値を当てはめない」という
     * 一般的な書き方で行い、他区名・他区の期限値は docs/research/ 側にのみ残す。
     * 本バッチの3区だけでなく23区すべての名称を対象にする(将来の区追加時の取り違え防止)。
     */
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
    expect(WARD_NAMES[code], `${code} は23区の一覧に存在しない`).toBeDefined();

    /** ProcedureVersion のうち利用者に表示されうる文字列をすべて集める。 */
    const userFacingStrings: { where: string; text: string }[] = [];
    for (const pv of proceduresOf(code)) {
      const push = (field: string, text: string | undefined) => {
        if (text !== undefined) userFacingStrings.push({ where: `${pv.id}.${field}`, text });
      };
      push('title', pv.title);
      push('shortDescription', pv.shortDescription);
      push('applicabilityReason', pv.applicabilityReason);
      push('dueDescription', pv.dueDescription);
      push('contact', pv.contact);
      pv.locations?.forEach((l, i) => push(`locations[${i}]`, l));
      pv.cautions?.forEach((c, i) => push(`cautions[${i}]`, c));
      pv.requiredDocuments.forEach((d, i) => push(`requiredDocuments[${i}].label`, d.label));
    }
    // ルール側も outcome 経由で利用者に表示される。
    for (const rule of (RULE_SETS[code] as RuleSet).rules) {
      const push = (field: string, text: string | undefined) => {
        if (text !== undefined)
          userFacingStrings.push({ where: `rule:${rule.procedureId}.${field}`, text });
      };
      push('dueDescription', rule.dueDescription);
      push('applicabilityReasonTemplate', rule.applicabilityReasonTemplate);
      push('needsConfirmationReason', rule.needsConfirmationReason);
    }
    // 施設の表示項目。
    for (const f of facilitiesOf(code)) {
      userFacingStrings.push({ where: `facility:${f.facilityId}.name`, text: f.name });
      userFacingStrings.push({ where: `facility:${f.facilityId}.address`, text: f.address });
      if (f.hours !== undefined)
        userFacingStrings.push({ where: `facility:${f.facilityId}.hours`, text: f.hours });
    }

    expect(userFacingStrings.length).toBeGreaterThan(50);
    for (const { where, text } of userFacingStrings) {
      for (const [other, name] of Object.entries(WARD_NAMES)) {
        if (other === code) continue;
        expect(text, `${where} に他区名「${name}」が含まれる`).not.toContain(name);
      }
    }
  });

  it.each(BATCH9)('%s: 決定論 — 同一入力で同一結果 + スナップショット(回帰ガード)', (code) => {
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
