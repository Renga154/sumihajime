import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Profile, RuleSet } from '@tmn/schemas';
import {
  facilitySchema,
  procedureVersionSchema,
  ruleSetSchema,
  wasteSortingItemSchema,
} from '@tmn/schemas';
import { evaluate } from './evaluate.js';
import { MunicipalityScopeMismatchError } from './errors.js';

/**
 * なぜ: Batch7(中野13114 / 荒川13118 / 豊島13116 / 北13117)の縦切りデータの来歴・型・
 * 決定論・**区ごとに異なる期限** をCIで機械検証する。ユーザー決裁(2026-08-07
 * 「23区全対応・案A=手続き中心で埋め、付帯データは取れる区だけ」)に基づく追加であり、
 * 4区とも人手レビュー未了(全ソース review_status=pending / 全手続き dataStatus=partial)。
 *
 * 本バッチで特に固定したい不変条件:
 * (a) **子ども医療費助成の期限が区ごとに違う**: 豊島=2か月 / 北=3カ月 / 荒川=3カ月 /
 *     中野=公式ページに記載なし(要確認)。共通デフォルト値を作らない(CLAUDE.md原則3)。
 * (b) **北区のマイナンバーカード継続利用の90日ルールは公式ページで確認できない**ため
 *     「未確認」と表示する。他区(中野・豊島・荒川)で確認できた90日を北区に当てはめない。
 * (c) 児童手当の15日特例の起算日が区で違う: 北区だけ「事由発生日(転入日)の翌日」基準の
 *     ため moveDate から算定でき(offsetDays 15)、他3区は「前住所地の転出予定日」基準の
 *     ため算定しない(unknown)。
 * (d) 犬の届出期限も区で違う: 中野=30日以内と明記(offsetDays 30)、他3区は日数記載なし(unknown)。
 * (e) 付帯データの誠実縮退: 4区とも waste.json は作らない。waste-sorting.json は荒川のみ。
 * (f) 公開ゲート(ADR-007): 4区の全ソースが registry.csv で pending であること。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const NAKANO = '13114';
const ARAKAWA = '13118';
const TOSHIMA = '13116';
const KITA = '13117';
const BATCH7 = [NAKANO, ARAKAWA, TOSHIMA, KITA] as const;
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
  BATCH7.map((code) => [code, ruleSetOf(code)]),
);

function profile(overrides: {
  municipalityCode?: string;
  originType?: Profile['originType'];
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
}): Profile {
  return {
    destination: { municipalityCode: overrides.municipalityCode ?? NAKANO },
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

describe('Batch7 — schema validation & pending status (CI gate)', () => {
  it.each(BATCH7)(
    '%s: rules.json が RuleSet として parse し 10ルール・自治体スコープ一致',
    (code) => {
      const rs = RULE_SETS[code] as RuleSet;
      expect(rs.municipalityCode).toBe(code);
      expect(rs.ruleVersion).toBe(RULE_VERSION);
      expect(rs.rules.length).toBe(10);
    },
  );

  it.each(BATCH7)('%s: procedures.json が10件 parse し 全件 partial(人手レビュー未了)', (code) => {
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

  it.each(BATCH7)('%s: procedures と rules が同一の10 procedureId を過不足なく覆う', (code) => {
    const procIds = proceduresOf(code)
      .map((p) => p.id)
      .sort();
    const ruleIds = (RULE_SETS[code] as RuleSet).rules.map((r) => r.procedureId).sort();
    expect(ruleIds).toEqual(procIds);
  });

  it('facilities.json — 窓口件数(中野6 / 荒川6 / 豊島3 / 北3)と座標の有無', () => {
    // 中野: 本庁舎1 + 地域事務所5(公式ページ由来・緯度経度なし)。
    const nakano = facilitiesOf(NAKANO);
    expect(nakano.length).toBe(6);
    for (const f of nakano) expect(f.lat).toBeUndefined();

    // 荒川: 区役所本庁舎/北庁舎 + 区民事務所4(自治体標準CSV由来・緯度経度は実値)。
    const arakawa = facilitiesOf(ARAKAWA);
    expect(arakawa.length).toBe(6);
    for (const f of arakawa) {
      expect(typeof f.lat).toBe('number');
      expect(typeof f.lng).toBe('number');
    }

    // 豊島: 区役所3階総合窓口課 + 東部/西部区民事務所(公式ページ由来・緯度経度なし)。
    // R4(令和4年度)のままの公共施設CSVは採用しない=古い施設一覧を公開しない誠実縮退。
    const toshima = facilitiesOf(TOSHIMA);
    expect(toshima.length).toBe(3);
    for (const f of toshima) expect(f.lat).toBeUndefined();

    // 北: 王子・赤羽・滝野川の区民事務所3(GIF標準CSVが存在しないため公式ページ由来)。
    const kita = facilitiesOf(KITA);
    expect(kita.length).toBe(3);
    for (const f of kita) expect(f.lat).toBeUndefined();
    expect(kita.map((f) => f.name).sort()).toEqual(
      ['王子区民事務所', '滝野川区民事務所', '赤羽区民事務所'].sort(),
    );
  });

  it('coverage.csv — 4区は全カテゴリ unavailable(未対応を一部対応に見せない)', () => {
    // なぜ: 4区は人手レビュー未了で公開データが1件も無く municipalities.ts の supported も
    // false のため、利用者から見て実際に使えるカテゴリが存在しない。ここで partial(一部対応)
    // と記録すると、CoveragePage が「未対応」バッジの直下に「一部対応」の表を出してしまい、
    // 未対応の区を部分対応に見せることになる(CLAUDE.md原則9)。承認時に引き上げる。
    const rows = readFileSync(resolve(repoRoot, 'docs/data-sources/coverage.csv'), 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const header = (rows[0] as string).split(',');
    const categoryColumns = header.slice(2, 13); // 11カテゴリ列 + overall_status。
    expect(categoryColumns).toHaveLength(11);
    for (const code of BATCH7) {
      const row = rows.find((l) => l.startsWith(`${code},`));
      expect(row, `coverage row missing for ${code}`).toBeDefined();
      const cells = (row as string).split(',');
      for (let i = 2; i <= 13; i++) {
        expect(cells[i], `${code} / ${header[i]}`).toBe('unavailable');
      }
    }
  });

  it.each(BATCH7)('%s: waste.json(収集曜日)を作らない — 誠実縮退の回帰ガード', (code) => {
    // 中野=収集曜日CSVの最終確認日が2021年 かつ 配信ホストが区公式ドメイン外、
    // 荒川=収集曜日CSVが無くHTML表パーサ未整備、豊島/北=都オープンデータにCSVが存在しない。
    // いずれも推測で曜日を作らないため waste.json を作らない。
    expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste.json`))).toBe(false);
  });

  it('waste-sorting.json は荒川のみ整備(223品目)。中野・豊島・北は作らない', () => {
    const raw = readJson(`data/normalized/${ARAKAWA}/waste-sorting.json`) as { items: unknown[] };
    const items = raw.items.map((i) => wasteSortingItemSchema.parse(i));
    expect(items.length).toBe(223);
    for (const i of items) {
      expect(i.municipalityCode).toBe(ARAKAWA);
      expect(i.sourceId).toBe('src-13118-waste_sorting-001');
    }
    // Shift-JIS の出典CSVを正しく復号できていること(文字化けしていれば品目名が壊れる)。
    expect(items.some((i) => i.name === 'アイロン')).toBe(true);
    // 荒川CSVは「注意点」列に実データを持つため notes へ統合されている。
    expect(items.filter((i) => i.notes && i.notes.length > 0).length).toBeGreaterThan(0);

    for (const code of [NAKANO, TOSHIMA, KITA]) {
      expect(existsSync(resolve(repoRoot, `data/normalized/${code}/waste-sorting.json`))).toBe(
        false,
      );
    }
  });
});

describe('Batch7 — 区ごとに異なる期限(共通デフォルト値を作らない)', () => {
  it('転入届は4区とも moveDate+14日(共通なのは公式に14日と書かれているから)', () => {
    for (const code of BATCH7) {
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

  it('国民健康保険も4区とも moveDate+14日', () => {
    for (const code of BATCH7) {
      const o = outcomeFor(
        profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: true } }),
        code,
        'procedure_national_health_insurance',
      );
      expect(o.dueDate).toBe('2026-08-15');
    }
  });

  it('子ども医療費助成: 豊島=2か月 / 北=3カ月 / 荒川=3カ月 / 中野=要確認(他区の値を混入させない)', () => {
    const due = (code: string) =>
      outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDescription ?? '';

    // 豊島区固有の2か月。3カ月・6カ月・15日を混入させない。
    const toshima = due(TOSHIMA);
    expect(toshima).toContain('2か月以内');
    expect(toshima).not.toContain('3カ月');
    expect(toshima).not.toContain('3か月');
    expect(toshima).not.toContain('6カ月');

    // 北区・荒川区は3カ月。2か月を混入させない。
    for (const code of [KITA, ARAKAWA]) {
      const d = due(code);
      expect(d, code).toContain('3カ月以内');
      expect(d, code).not.toContain('2か月');
      expect(d, code).not.toContain('6カ月');
    }

    // 中野区は公式ページに期限の記載が無いため『要確認』。数値の期限を一切書かない。
    const nakano = due(NAKANO);
    expect(nakano).toContain('要確認');
    expect(nakano).not.toContain('2か月');
    expect(nakano).not.toContain('3カ月');
    expect(nakano).not.toContain('3か月');
    expect(nakano).not.toContain('6カ月');
    // 中野は needs_confirmation の理由も持つ(判定を保留せず該当は出すが期限は確定しない)。
    const nakanoRule = (RULE_SETS[NAKANO] as RuleSet).rules.find(
      (r) => r.procedureId === 'procedure_child_medical',
    );
    expect(nakanoRule?.needsConfirmationReason).toBeDefined();
    expect(nakanoRule?.dueRule).toEqual({ type: 'unknown' });

    // 4区とも dueDate(算定値)は出さない(遡及起算日は転入日だが「申請すれば遡及」で期限ではないため)。
    for (const code of BATCH7) {
      expect(outcomeFor(familyIn(code), code, 'procedure_child_medical').dueDate).toBeUndefined();
    }
  });

  it('マイナンバー継続利用: 中野/荒川/豊島=90日ルールあり / 北区のみ「未確認」表示', () => {
    const withCard = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasMyNumberCard: true } }),
        code,
        'procedure_mynumber_continued_use',
      );

    for (const code of [NAKANO, ARAKAWA, TOSHIMA]) {
      const o = withCard(code);
      expect(o.applicable).toBe('applicable');
      expect(o.dueDescription, code).toContain('90日以内');
      // 90日は「転入届出日」起算のため moveDate からは算定しない。
      expect(o.dueDate, code).toBeUndefined();
    }

    // 北区: 公式ページに90日の記載が無いため、確認できなかったことを明示する(推測で断定しない)。
    const kita = withCard(KITA);
    expect(kita.dueDescription).toContain('確認できませんでした');
    expect(kita.dueDescription).toContain('未確認');
    expect(kita.dueDescription).toContain('14日以内');
    expect(kita.dueDate).toBeUndefined();
    expect(kita.applicabilityReason).toContain('未確認');
    // 北区のルールが「90日以内に継続利用の手続きが必要」と断定していないこと。
    expect(kita.dueDescription).not.toMatch(/90日以内に継続利用の手続きをしてください/);
  });

  it('児童手当の15日特例: 北区のみ転入日基準で moveDate+15日を算定 / 他3区は算定しない', () => {
    // 北区は「事由発生日(出生日・転入日等)の翌日から15日以内」と転入日基準で明記されている。
    const kita = outcomeFor(familyIn(KITA), KITA, 'procedure_child_allowance');
    expect(kita.dueDate).toBe('2026-08-16');
    // 算定できた区は outcome から dueDescription が落ちるため、公式文言は rules.json 側で検証する。
    expect(kita.dueDescription).toBeUndefined();
    expect(ruleDueDescription(KITA, 'procedure_child_allowance')).toContain('15日以内');
    expect(ruleDueDescription(KITA, 'procedure_child_allowance')).toContain('事由発生日');

    // 中野・荒川・豊島は「前住所地の転出予定日」起算のため引越し日からは算定できない。
    for (const code of [NAKANO, ARAKAWA, TOSHIMA]) {
      const o = outcomeFor(familyIn(code), code, 'procedure_child_allowance');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('15日以内');
      expect(o.dueDescription, code).toContain('転出予定日');
    }
  });

  it('犬の届出: 中野=30日以内(moveDate+30を算定) / 荒川・豊島・北=日数記載なしで算定しない', () => {
    const noChip = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, flags: { hasDog: true, dogHasMicrochip: false } }),
        code,
        'procedure_dog_registration_transfer',
      );

    const nakano = noChip(NAKANO);
    expect(nakano.applicable).toBe('applicable');
    expect(nakano.dueDate).toBe('2026-08-31');
    expect(nakano.dueDescription).toBeUndefined();
    expect(ruleDueDescription(NAKANO, 'procedure_dog_registration_transfer')).toContain('30日以内');

    for (const code of [ARAKAWA, TOSHIMA, KITA]) {
      const o = noChip(code);
      expect(o.applicable, code).toBe('applicable');
      expect(o.dueDate, code).toBeUndefined();
      expect(o.dueDescription, code).toContain('記載がありません');
    }
  });

  it('国民年金: 中野・豊島=第1号は住民異動届のみで足りると明記 / 荒川・北=公式ページに記載なし', () => {
    for (const code of [NAKANO, TOSHIMA]) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_national_pension_address',
      );
      expect(o.dueDescription, code).toContain('第1号被保険者');
      expect(o.dueDescription, code).toContain('必要ありません');
    }
    for (const code of [ARAKAWA, KITA]) {
      const o = outcomeFor(
        profile({ municipalityCode: code }),
        code,
        'procedure_national_pension_address',
      );
      expect(o.dueDescription, code).toContain('記載がありません');
      // 他区の「住民異動届のみで足りる」を持ち込んでいないこと。
      expect(o.dueDescription, code).not.toContain('必要ありません');
    }
  });

  it('学校の交付書類名: 中野=転入学通知書 / 北=就学通知書 / 荒川・豊島=名称を設定しない', () => {
    const school = (code: string) =>
      outcomeFor(
        profile({ municipalityCode: code, ageBands: ['elementary', 'adult'], memberCount: 2 }),
        code,
        'procedure_school_transfer',
      ).dueDescription ?? '';

    expect(school(NAKANO)).toContain('転入学通知書');
    expect(school(NAKANO)).not.toContain('就学通知書');

    expect(school(KITA)).toContain('就学通知書');
    expect(school(KITA)).not.toContain('転入学通知書');

    for (const code of [ARAKAWA, TOSHIMA]) {
      expect(school(code), code).not.toContain('転入学通知書');
      expect(school(code), code).not.toContain('就学通知書');
      expect(school(code), code).not.toContain('学校指定通知書');
    }
  });
});

describe('Batch7 — ペルソナ評価(正例・負例・境界)', () => {
  it.each(BATCH7)('%s: 単身・都外・マイナンバーあり は5件該当・子育て/犬は非該当', (code) => {
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

  it.each(BATCH7)('%s: 国保フラグOFFで非該当(負例)', (code) => {
    const off = profile({ municipalityCode: code, flags: { needsNationalHealthInsurance: false } });
    expect(outcomeFor(off, code, 'procedure_national_health_insurance').applicable).toBe(
      'not_applicable',
    );
  });

  it.each(BATCH7)('%s: 子育て世帯で 児童手当・子ども医療・学校・保育 が増える', (code) => {
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

  it.each(BATCH7)(
    '%s: 犬あり・マイクロチップ不明は needs_confirmation(C-10 推測しない)',
    (code) => {
      const unknown = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: 'unknown' },
      });
      const o = outcomeFor(unknown, code, 'procedure_dog_registration_transfer');
      expect(o.applicable).toBe('needs_confirmation');
      expect(o.applicabilityReason).toContain('マイクロチップ');
      // なぜ: 期限の扱いは区で異なる。中野区は公式ページが『飼い犬の所在地が変わったときは30日以内』を
      // マイクロチップ登録済み・未登録の**両方の分岐**に対して書いているため、届出先が未確定
      // (needs_confirmation)でも30日という期限自体は確定しており、算定して見せてよい。
      // 他3区は日数の記載が無いため期限を出さない。
      expect(o.dueDate, code).toBe(code === NAKANO ? '2026-08-31' : undefined);

      const chipped = profile({
        municipalityCode: code,
        flags: { hasDog: true, dogHasMicrochip: true },
      });
      expect(outcomeFor(chipped, code, 'procedure_dog_registration_transfer').applicable).toBe(
        'not_applicable',
      );
    },
  );

  it('期限計算の境界: 月末・年末・うるう年を跨いでも暦日で算定する(中野の転入届14日)', () => {
    const at = (moveDate: string) => {
      const p: Profile = { ...profile({ municipalityCode: NAKANO }), moveDate };
      return outcomeFor(p, NAKANO, 'procedure_resident_registration').dueDate;
    };
    expect(at('2026-08-25')).toBe('2026-09-08'); // 月跨ぎ
    expect(at('2026-12-25')).toBe('2027-01-08'); // 年跨ぎ
    expect(at('2028-02-20')).toBe('2028-03-05'); // うるう年(2月29日を含む)
  });
});

describe('Batch7 — provenance integrity & scope safety', () => {
  const registryRows = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0);
  const registryIds = new Set(registryRows.map((l) => l.slice(0, l.indexOf(','))));

  it.each(BATCH7)(
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

  it.each(BATCH7)(
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

  it.each(BATCH7)('%s: 出典スナップショットが存在し content_hash と一致する', async (code) => {
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

  it('北区の出典URLは全件が移行後の新ドメイン(city.kita.lg.jp)である', () => {
    const rows = registryRows.filter((l) => l.startsWith(`src-${KITA}-`));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const url = row.split(',')[5] as string;
      expect(url, row.slice(0, 40)).toContain('www.city.kita.lg.jp');
      expect(url, row.slice(0, 40)).not.toContain('city.kita.tokyo.jp');
    }
  });

  it('越境: 各区のプロフィールを他区のルールセットで評価すると必ず例外', () => {
    for (const code of BATCH7) {
      for (const other of BATCH7) {
        if (other === code) continue;
        expect(() =>
          evaluate(profile({ municipalityCode: code }), RULE_SETS[other] as RuleSet),
        ).toThrow(MunicipalityScopeMismatchError);
      }
    }
  });

  it.each(BATCH7)('%s: 決定論 — 同一入力で同一結果 + スナップショット(回帰ガード)', (code) => {
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
