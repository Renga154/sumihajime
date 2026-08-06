import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import { facilitySchema, procedureVersionSchema, ruleSetSchema } from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: Batch10(足立13121 / 江戸川13123)の縦切りデータの来歴・型・決定論・**区ごとに異なる
 * 期限** をCIで機械検証する。ユーザー決裁(2026-08-07「23区全対応・案A=手続き中心で埋め、
 * 付帯データは取れる区だけ」)に基づく追加であり、2区とも人手レビュー未了(全ソース
 * review_status=pending / 全手続き dataStatus=partial)。
 *
 * 本バッチで特に固定したい不変条件:
 * (a) **子ども医療費助成の期限が区ごとに違う**: 江戸川=3か月以内(事由発生日=転入日起算)/
 *     足立=公式ページに申請期限の記載が無く「要確認」。既存13区で6種類の値がある項目のため、
 *     共通デフォルト値を作らず他区の値も持ち込まない(CLAUDE.md原則3)。
 * (b) **児童手当の15日特例の起算日は2区とも「前住所地の転出予定日」**。足立区は
 *     「転入日(前住所地の転出予定日)」と括弧書きで同義に定義しているため、両区とも
 *     moveDate から期限を算定してはならない(北区のような転入日起算と混同しない)。
 * (c) **犬の届出期限も区で違う**: 江戸川=30日以内をマイクロチップ分岐の前に共通で明記
 *     (offsetDays 30)、足立=転入時の変更届に日数の記載なし(unknown)。足立の「30日以内」は
 *     新規に飼い始めたときの登録に対する期限であり転入時の変更届の期限ではない。
 * (d) **学校で交付される書類の名称が違う**: 足立=就学通知書 / 江戸川=転入学通知書。
 * (e) マイナンバーカード継続利用は2区とも90日だが起算日が「転入(届出)日」のため算定しない。
 * (f) 付帯データの誠実縮退: 2区とも waste.json / waste-sorting.json を作らない。
 * (g) 公開ゲート(ADR-007): 2区の全ソースが registry.csv で pending であること。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const ADACHI = '13121';
const EDOGAWA = '13123';
const BATCH10 = [ADACHI, EDOGAWA] as const;
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
  BATCH10.map((code) => [code, ruleSetOf(code)]),
);

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: overrides.municipalityCode ?? ADACHI },
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

describe('Batch10 — schema validation & pending status (CI gate)', () => {
  it.each(BATCH10)(
    '%s: rules.json が RuleSet として parse し 10ルール・自治体スコープ一致',
    (code) => {
      const rs = RULE_SETS[code] as RuleSet;
      expect(rs.municipalityCode).toBe(code);
      expect(rs.ruleVersion).toBe(RULE_VERSION);
      expect(rs.rules.length).toBe(10);
    },
  );

  it.each(BATCH10)('%s: procedures.json が10件 parse し 全件 partial(人手レビュー未了)', (code) => {
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

  it.each(BATCH10)('%s: procedures と rules が同一の10 procedureId を過不足なく覆う', (code) => {
    const procIds = proceduresOf(code)
      .map((p) => p.id)
      .sort();
    const ruleIds = (RULE_SETS[code] as RuleSet).rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口件数(足立17 / 江戸川6)と座標の不在', () => {
    // 足立: 区役所南館1階戸籍住民課 + 区民事務所16(公式『区民事務所のご案内』由来)。
    // 都カタログにGIF標準の公共施設一覧CSVが無いため座標は設定しない(捏造回避)。
    const adachi = facilitiesOf(ADACHI);
    expect(adachi.length).toBe(17);
    for (const f of adachi) {
      expect(f.lat).toBeUndefined();
      expect(f.lng).toBeUndefined();
    }
    expect(adachi.filter((f) => f.category === '区民事務所').length).toBe(16);

    // 江戸川: 区役所区民課 + 事務所5(小松川・葛西・小岩・東部・鹿骨)。
    const edogawa = facilitiesOf(EDOGAWA);
    expect(edogawa.length).toBe(6);
    for (const f of edogawa) {
      expect(f.lat).toBeUndefined();
      expect(f.lng).toBeUndefined();
    }
    expect(edogawa.map((f) => f.name).sort()).toEqual(
      [
        '江戸川区役所 区民課(本庁舎)',
        '小松川事務所(小松川区民館内)',
        '葛西事務所(葛西区民館内)',
        '小岩事務所(小岩区民館内)',
        '東部事務所(東部区民館内)',
        '鹿骨事務所(鹿骨区民館内)',
      ].sort(),
    );
  });

  it('coverage.csv — 2区は全カテゴリ unavailable(未対応を一部対応に見せない)', () => {
    // なぜ: 2区は人手レビュー未了で公開データが1件も無く municipalities.ts の supported も
    // false のため、利用者から見て実際に使えるカテゴリが存在しない(CLAUDE.md原則9)。
    const rows = readFileSync(resolve(repoRoot, 'docs/data-sources/coverage.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const header = (rows[0] as string).split(',');
    expect(header.slice(2, 13)).toHaveLength(11);
    for (const code of BATCH10) {
      const row = rows.find((l) => l.startsWith(`${code},`));
      expect(row, `coverage row missing for ${code}`).toBeDefined();
      const cells = (row as string).split(',');
      for (let i = 2; i <= 13; i++) {
        expect(cells[i], `${code} / ${header[i]}`).toBe('unavailable');
      }
    }
  });

  it.each(BATCH10)(
    '%s: waste.json / waste-sorting.json を作らない — 誠実縮退の回帰ガード',
    (code) => {
      // 足立=都カタログに収集曜日CSV・分別辞書CSVとも0件で公式カレンダーもPDFのみ。
      // 江戸川=CSVは0件。曜日表のHTML表はあるが本バッチではパーサ未整備。
      // いずれも推測で曜日を作らないため waste.json を作らない。
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste.json`))).toBe(false);
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste-sorting.json`))).toBe(
        false,
      );
    },
  );
});

describe('Batch10 — 区ごとに異なる期限(共通デフォルト値を作らない)', () => {
  it('転入届は2区とも moveDate+14日(共通なのは公式に14日と書かれているから)', () => {
    for (const code of BATCH10) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_resident_registration',
      );
      expect(o.applicable).toBe('applicable');
      expect(o.priority).toBe('urgent');
      expect(o.dueDate).toBe('2026-08-15');
    }
    // 過料の金額表記は区で異なる(足立=5万円以下 / 江戸川=50000円以下)。文言を混ぜない。
    expect(ruleDueDescription(ADACHI, 'procedure_resident_registration')).toContain('5万円以下');
    expect(ruleDueDescription(EDOGAWA, 'procedure_resident_registration')).toContain('50000円以下');
  });

  it('国民健康保険も2区とも moveDate+14日', () => {
    for (const code of BATCH10) {
      const o = outcomeFor(
        profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: true } }),
        code,
        'procedure_national_health_insurance',
      );
      expect(o.dueDate).toBe('2026-08-15');
    }
  });

  it('子ども医療費助成: 江戸川=3か月以内 / 足立=要確認(他区の値を混入させない)', () => {
    const due = (code: string) =>
      outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDescription ?? '';

    // 江戸川区固有の3か月。事由発生日(転入日)起算であることも明示されている。
    const edogawa = due(EDOGAWA);
    expect(edogawa).toContain('3か月以内');
    expect(edogawa).toContain('事由発生日');
    expect(edogawa).not.toContain('2か月');
    expect(edogawa).not.toContain('6カ月');
    expect(edogawa).not.toContain('15日以内');

    // 足立区は公式ページに申請期限の記載が無いため『要確認』。数値の期限を一切書かない。
    const adachi = due(ADACHI);
    expect(adachi).toContain('要確認');
    expect(adachi).toContain('記載がありません');
    expect(adachi).not.toContain('2か月');
    expect(adachi).not.toContain('3か月');
    expect(adachi).not.toContain('3カ月');
    expect(adachi).not.toContain('6カ月');
    expect(adachi).not.toContain('15日以内');
    // 足立は needs_confirmation の理由も持つ(判定は該当のまま期限だけ確定しない)。
    const adachiRule = (RULE_SETS[ADACHI] as RuleSet).rules.find(
      (r) => r.procedureId === 'procedure_child_medical',
    );
    expect(adachiRule?.needsConfirmationReason).toBeDefined();
    expect(adachiRule?.dueRule).toEqual({ type: 'unknown' });

    // 2区とも dueDate(算定値)は出さない(遡及の起算点であって申請期限ではないため)。
    for (const code of BATCH10) {
      expect(outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDate).toBeUndefined();
    }
  });

  it('児童手当の15日特例: 2区とも「前住所地の転出予定日」起算のため moveDate から算定しない', () => {
    for (const code of BATCH10) {
      const o = outcomeFor(familyIn(code), code, 'procedure_child_allowance');
      expect(o.applicable, code).toBe('applicable');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('15日以内');
      expect(o.dueDescription, code).toContain('転出予定日');
      expect(o.dueDescription, code).toContain('算定できません');
    }
    // 足立区は「転入日(前住所地の転出予定日)」と括弧書きで同義に定義している点を固定する。
    expect(ruleDueDescription(ADACHI, 'procedure_child_allowance')).toContain(
      '転入日(前住所地の転出予定日)の翌日',
    );
    // 江戸川区は「転入は前住所地の転出予定日の翌日」と分けて書いている。
    expect(ruleDueDescription(EDOGAWA, 'procedure_child_allowance')).toContain(
      '前住所地の転出予定日の翌日',
    );
  });

  it('児童手当と子ども医療費助成の期限体系を取り違えていない(江戸川区の反例)', () => {
    // なぜ: 江戸川区は15日特例(児童手当)と3か月(子ども医療費助成)を明確に区別している。
    // 一方に他方の値が混入していないことを機械で固定する。
    const allowance = ruleDueDescription(EDOGAWA, 'procedure_child_allowance');
    const medical = ruleDueDescription(EDOGAWA, 'procedure_child_medical');
    expect(allowance).toContain('15日以内');
    expect(allowance).not.toContain('3か月');
    expect(medical).toContain('3か月以内');
    // 医療費助成側に「15日以内」という期限を書いてしまうのが取り違えの典型。
    // (「児童手当の15日特例とは別の期限体系」という注意喚起は残してよい)
    expect(medical).not.toContain('15日以内');
    expect(medical).toContain('児童手当の15日特例とは別の期限体系');
  });

  it('マイナンバー継続利用: 2区とも90日ルールだが転入(届出)日起算のため算定しない', () => {
    for (const code of BATCH10) {
      const o = outcomeFor(
        profile({ municipalityCode: code, flags: { hasMyNumberCard: true } }),
        code,
        'procedure_mynumber_continued_use',
      );
      expect(o.applicable, code).toBe('applicable');
      expect(o.dueDescription, code).toContain('90日');
      expect(o.dueDescription, code).toContain('14日以内');
      expect(o.dueDate, code).toBeUndefined();
    }
    // 足立区だけが「転出日から30日以内の転入手続き」という第3の条件を明記している。
    expect(ruleDueDescription(ADACHI, 'procedure_mynumber_continued_use')).toContain('30日以内');
    expect(ruleDueDescription(EDOGAWA, 'procedure_mynumber_continued_use')).not.toContain(
      '30日以内',
    );
  });

  it('犬の届出: 江戸川=30日以内(moveDate+30を算定) / 足立=日数記載なしで算定しない', () => {
    const noChip = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasDog: true, dogHasMicrochip: false } }),
        code,
        'procedure_dog_registration_transfer',
      );

    // 江戸川区はマイクロチップ分岐の前に「30日以内に届出」を共通で明記している。
    const edogawa = noChip(EDOGAWA);
    expect(edogawa.applicable).toBe('applicable');
    expect(edogawa.dueDate).toBe('2026-08-31');
    expect(edogawa.dueDescription).toBeUndefined();
    expect(ruleDueDescription(EDOGAWA, 'procedure_dog_registration_transfer')).toContain(
      '30日以内',
    );

    // 足立区の30日は「新たに飼い始めたときの登録」に対する期限で転入時の変更届の期限ではない。
    const adachi = noChip(ADACHI);
    expect(adachi.applicable).toBe('applicable');
    expect(adachi.dueDate).toBeUndefined();
    expect(adachi.dueDescription).toContain('記載がありません');
    expect(adachi.dueDescription).toContain('飼い始めたときの登録');
  });

  it('国民年金: 2区とも国内転入の届出は公式ページに記載なし(他区の断定を持ち込まない)', () => {
    for (const code of BATCH10) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_national_pension_address',
      );
      expect(o.dueDescription, code).toContain('記載がありません');
      // 中野区・豊島区の「第1号被保険者は住民異動届のみで足りる」を持ち込んでいないこと。
      expect(o.dueDescription, code).not.toContain('必要ありません');
      expect(o.dueDescription, code).not.toContain('第1号被保険者は住民票の住所変更');
    }
    // 海外からの転入時の扱いは2区とも明記されている(足立=海外から帰国 / 江戸川=外国から転入)。
    expect(ruleDueDescription(ADACHI, 'procedure_national_pension_address')).toContain(
      '海外から帰国',
    );
    expect(ruleDueDescription(EDOGAWA, 'procedure_national_pension_address')).toContain(
      '外国から転入',
    );
  });

  it('学校の交付書類名: 足立=就学通知書 / 江戸川=転入学通知書(取り違えない)', () => {
    const school = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, ageBands: ['elementary', 'adult'], memberCount: 2 }),
        code,
        'procedure_school_transfer',
      ).dueDescription ?? '';

    expect(school(ADACHI)).toContain('就学通知書');
    expect(school(ADACHI)).not.toContain('転入学通知書');

    expect(school(EDOGAWA)).toContain('転入学通知書');
    expect(school(EDOGAWA)).not.toContain('就学通知書');

    // 前の学校が発行する書類の名称も区の表記どおり(足立=教科書給与証明書 / 江戸川=教科用図書給与証明書)。
    expect(school(ADACHI)).toContain('教科書給与証明書');
    expect(school(EDOGAWA)).toContain('教科用図書給与証明書');
  });
});

describe('Batch10 — ペルソナ評価(正例・負例・境界)', () => {
  it.each(BATCH10)('%s: 単身・都外・マイナンバーあり は5件該当・子育て/犬は非該当', (code) => {
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

  it.each(BATCH10)('%s: 国保フラグOFF・マイナンバーなしで非該当(負例)', (code) => {
    const off = profile({
      municipalityCode: code,
      flags: { needsNationalHealthInsurance: false, hasMyNumberCard: false },
    });
    expect(outcomeFor(off, code, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
    expect(outcomeFor(off, code, 'procedure_mynumber_continued_use').applicable).toBe(
      'not_applicable',
    );
  });

  it.each(BATCH10)('%s: 子育て世帯で 児童手当・子ども医療・学校・保育 が増える', (code) => {
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

  it.each(BATCH10)(
    '%s: 犬あり・マイクロチップ不明は needs_confirmation(C-10 推測しない)',
    (code) => {
      const unknown = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: 'unknown' },
      });
      const o = outcomeFor(unknown, code, 'procedure_dog_registration_transfer');
      expect(o.applicable).toBe('needs_confirmation');
      expect(o.applicabilityReason).toContain('マイクロチップ');
      // なぜ: 江戸川区は30日以内をマイクロチップの装着有無の分岐より前に共通で書いているため、
      // 届出先が未確定(needs_confirmation)でも期限自体は確定しており算定して見せてよい。
      // 足立区は転入時の変更届に日数の記載が無いため期限を出さない。
      expect(o.dueDate, code).toBe(code === EDOGAWA ? '2026-08-31' : undefined);

      const chipped = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: true },
      });
      expect(outcomeFor(chipped, code, 'procedure_dog_registration_transfer').applicable).toBe(
        'not_applicable',
      );
    },
  );

  it('期限計算の境界: 月末・年末・うるう年を跨いでも暦日で算定する(転入届14日)', () => {
    const at = (code: string, moveDate: string) => {
      const p: Profile = { ...profile({ municipalityCode: code }), moveDate };
      return outcomeFor(p, code, 'procedure_resident_registration').dueDate;
    };
    for (const code of BATCH10) {
      expect(at(code, '2026-08-25'), code).toBe('2026-09-08'); // 月跨ぎ
      expect(at(code, '2026-12-25'), code).toBe('2027-01-08'); // 年跨ぎ
      expect(at(code, '2028-02-20'), code).toBe('2028-03-05'); // うるう年(2月29日を含む)
      expect(at(code, '2027-02-20'), code).toBe('2027-03-06'); // 平年(28日)との差
    }
  });

  it('期限計算の境界: 江戸川区の犬30日も月跨ぎ・年跨ぎ・うるう年で暦日算定する', () => {
    const at = (moveDate: string) => {
      const p: Profile = {
        ...profile({
          municipalityCode: EDOGAWA,
          flags: { hasDog: true, dogHasMicrochip: false },
        }),
        moveDate,
      };
      return outcomeFor(p, EDOGAWA, 'procedure_dog_registration_transfer').dueDate;
    };
    expect(at('2026-08-25')).toBe('2026-09-24'); // 月跨ぎ
    expect(at('2026-12-25')).toBe('2027-01-24'); // 年跨ぎ
    expect(at('2028-02-01')).toBe('2028-03-02'); // うるう年(2月29日を含む)
    expect(at('2027-02-01')).toBe('2027-03-03'); // 平年
  });
});

describe('Batch10 — provenance integrity & scope safety', () => {
  const registryRows = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);
  const registryIds = new Set(registryRows.map((l) => l.slice(0, l.indexOf(','))));

  it.each(BATCH10)(
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

  it.each(BATCH10)(
    '%s: registry.csv の当該行は全て review_status=pending(未承認データを公開しない)',
    (code) => {
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cells = row.split(',');
        // 列順: ... 14:content_hash, 15:effective_from, 16:effective_to, 17:review_status
        expect(cells[17], row.slice(0, 60)).toBe('pending');
        // content_hash(SHA-256 16進64桁)が記録されていること。
        expect(cells[14], row.slice(0, 60)).toMatch(/^[0-9a-f]{64}$/);
      }
    },
  );

  it.each(BATCH10)('%s: 出典スナップショットが存在し content_hash と一致する', async (code) => {
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

  it('出典URLは各区の公式ドメインのみ(他区のドメインを混ぜない)', () => {
    const hostOf = (code: string) =>
      code === ADACHI ? 'www.city.adachi.tokyo.jp' : 'www.city.edogawa.tokyo.jp';
    for (const code of BATCH10) {
      const rows = registryRows.filter((l) => l.startsWith(`src-${code}-`));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const url = row.split(',')[5] as string;
        expect(url, row.slice(0, 40)).toContain(hostOf(code));
        const other = code === ADACHI ? 'edogawa' : 'adachi';
        expect(url, row.slice(0, 40)).not.toContain(other);
      }
    }
  });

  it('越境: 各区のプロフィールを他区のルールセットで評価すると必ず例外', () => {
    for (const code of BATCH10) {
      for (const other of BATCH10) {
        if (other === code) continue;
        expect(() =>
          evaluate(profile({ municipalityCode: code }), RULE_SETS[other] as RuleSet),
        ).toThrow(MunicipalityScopeMismatchError);
      }
    }
  });

  it('自治体名の混入がない — 各区の文言に他区の区名が現れない', () => {
    for (const code of BATCH10) {
      const other = code === ADACHI ? '江戸川区' : '足立区';
      const blob = JSON.stringify(RULE_SETS[code]) + JSON.stringify(proceduresOf(code));
      expect(blob.includes(other), `${code} contains ${other}`).toBe(false);
    }
  });

  it.each(BATCH10)('%s: 決定論 — 同一入力で同一結果 + スナップショット(回帰ガード)', (code) => {
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
