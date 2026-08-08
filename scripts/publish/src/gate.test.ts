import { describe, expect, it } from 'vitest';
import {
  assertPublishGate,
  findGateViolations,
  PublishGateError,
  type PublishGateInput,
} from './gate.js';
import { buildSeed } from './seed.js';
import { loadPublishData } from './load.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * なぜ: 2026-08-06 に追加した自治体以外(ライフライン等)の4手続きは、出典が registry.csv で
 * review_status=pending のため dataStatus=partial(ADR-007 の staging)である。よって
 * 全対応区で「区の10手続きは公開・この4件は必ず除外」が正しい期待値になる。承認されるまで
 * この4件が公開(D1シード)へ載らないことを、区別のdescribeで恒久的に固定する(ADR-009)。
 */
const NON_MUNICIPAL_STAGED_IDS = [
  'procedure_water_supply',
  'procedure_postal_forwarding',
  'procedure_utilities_contact',
  'procedure_driver_license_change',
];

function stagedIdsFor(
  data: ReturnType<typeof loadPublishData>,
  municipalityCode: string,
): string[] {
  return data.excludedProcedures
    .filter((p) => p.municipalityCode === municipalityCode)
    .map((p) => p.id)
    .sort();
}

describe('publish gate — approved-only enforcement (FR-022〜024)', () => {
  it('passes when every referenced source is approved', () => {
    const input: PublishGateInput = {
      approvedSourceIds: new Set(['src-a', 'src-b']),
      references: [
        { owner: 'procedure_x', sourceIds: ['src-a'] },
        { owner: 'rule_y', sourceIds: ['src-a', 'src-b'] },
      ],
    };
    expect(findGateViolations(input)).toEqual([]);
    expect(() => assertPublishGate(input)).not.toThrow();
  });

  it('FAILS (throws) when a published procedure references a NON-approved source', () => {
    // なぜ: これが最重要のfixture。candidate/pending のソースを参照する手続きが
    // 混ざったら publish を必ず止める(人手レビュー未了データの公開を構造的に防ぐ)。
    const input: PublishGateInput = {
      approvedSourceIds: new Set(['src-approved']),
      references: [
        { owner: 'procedure_ok', sourceIds: ['src-approved'] },
        { owner: 'procedure_bad', sourceIds: ['src-candidate-not-approved'] },
      ],
    };
    const violations = findGateViolations(input);
    expect(violations).toEqual([
      { owner: 'procedure_bad', sourceId: 'src-candidate-not-approved', reason: 'not_approved' },
    ]);
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
    try {
      assertPublishGate(input);
    } catch (e) {
      expect(e).toBeInstanceOf(PublishGateError);
      expect((e as PublishGateError).violations).toHaveLength(1);
      expect((e as Error).message).toContain('src-candidate-not-approved');
    }
  });

  it('collects ALL violations across procedures and rules before throwing', () => {
    const input: PublishGateInput = {
      approvedSourceIds: new Set(['ok']),
      references: [
        { owner: 'procedure_a', sourceIds: ['ok', 'bad1'] },
        { owner: 'rule_b', sourceIds: ['bad2'] },
      ],
    };
    expect(findGateViolations(input)).toHaveLength(2);
  });
});

describe('publish gate — real repository data (13112)', () => {
  it('the real approved dataset passes the gate and builds seed statements', () => {
    // なぜ: 実データ(世田谷)の公開物 sourceId が全て approved 台帳を指すことを機械検証。
    const { data, statements } = buildSeed(repoRoot);
    expect(data.approvedSources.length).toBeGreaterThan(0);
    // 2026-08-07 人手レビュー承認(ADR-009)により世田谷は区の10手続き+ライフライン等4件の
    // 計14手続きが公開対象になった。
    expect(data.procedures.length).toBe(14);
    expect(data.ruleSets[0]?.municipalityCode).toBe('13112');
    expect(statements.length).toBeGreaterThan(0);
    // すべての手続きの sourceIds は approved 集合に含まれる。
    for (const p of data.procedures) {
      for (const sid of p.sourceIds) {
        expect(data.approvedSourceIds.has(sid)).toBe(true);
      }
    }
  });

  it('公開される rule_set の版は ruleVersion そのもの(publishedRuleVersion除去後)であり、除外は0件', () => {
    // なぜ: ADR-007 §5 / ADR-009。2026-08-06 に足したライフライン4ルールは
    // 2026-08-07 の人手レビュー承認により publishedRuleVersion(据え置き)が除去され、
    // rules.json の ruleVersion がそのまま公開版になった。
    // 2026-08-09: 前住所地の転出予定日を起算日にできるようにした改訂で 2026-08-09.1 へ更新。
    const data = loadPublishData(repoRoot);
    expect(data.ruleSets[0]?.ruleVersion).toBe('2026-08-09.1');
    expect(data.ruleSets[0]?.publishedRuleVersion).toBeUndefined();
    expect(data.ruleSets[0]?.rules).toHaveLength(14);
    // 承認によりライフライン4件も公開される rules に含まれる(除外されない)。
    const ruleIds = data.ruleSets[0]?.rules.map((r) => r.procedureId) ?? [];
    for (const id of NON_MUNICIPAL_STAGED_IDS) expect(ruleIds).toContain(id);
    expect(stagedIdsFor(data, '13112')).toEqual([]);
    expect(data.excludedRuleRefs).toEqual([]);
  });

  it('synthesizes unique facility_ids (源データの壊れたIDを機械置換)', () => {
    const data = loadPublishData(repoRoot);
    const ids = data.facilities.map((f) => f.facilityId);
    expect(new Set(ids).size).toBe(ids.length); // 一意
    expect(ids[0]).toMatch(/^13112-fac-\d{3}$/);
  });

  it('injecting a non-approved reference into the real dataset trips the gate', () => {
    const data = loadPublishData(repoRoot);
    // なぜ: 実データ(approved参照のみ)に「台帳に存在しない=決してapprovedにならない」合成ソースを
    // 1件注入するとゲートが必ず発火することを固定する。実台帳の承認状態が Step ごとに前進しても
    // (どの自治体が approved かに関係なく)壊れない恒久形にするため、実在の source_id は使わない。
    expect(data.approvedSourceIds.has('src-synthetic-never-in-registry-000')).toBe(false);
    const input: PublishGateInput = {
      approvedSourceIds: data.approvedSourceIds,
      references: [
        ...data.references,
        { owner: 'procedure_injected', sourceIds: ['src-synthetic-never-in-registry-000'] },
      ],
    };
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
  });
});

describe('publish gate — Koto (13108) after human review approval (T-015)', () => {
  // なぜ: 2026-07-22 に人手レビュー承認済み(台帳の全13108ソースがapproved)。
  // 承認前は本describeが「supported全件のbuildSeedがPublishGateErrorで止まる」ことを
  // 検証していた(承認ゲートの機械検証はfixtureベースの上記describeで恒久的に担保)。
  // 承認後は逆に、実データでの公開が両自治体で成立することを固定する。
  const SUPPORTED = ['13112', '13108'];

  it('承認後: 江東を含めた公開(supported全件)がゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後のseedは両自治体のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13108', '13112']);
  });

  it('デフォルト(世田谷のみ)の buildSeed は従来どおり成功する', () => {
    // d1-harness / CI は引数なし buildSeed を使うため、この不変条件を固定する。
    expect(() => buildSeed(repoRoot)).not.toThrow();
    const { data } = buildSeed(repoRoot);
    expect(data.ruleSets).toHaveLength(1);
    expect(data.ruleSets[0]?.municipalityCode).toBe('13112');
  });
});

describe('publish gate — Shinjuku (13104) after human review approval (T-016)', () => {
  // なぜ: 2026-07-22 に人手レビュー承認済み(台帳の全13104ソースがapproved。若松町特別
  // 出張所は公式ページから補完しsrc-13104-facilities-002として追加承認)。3自治体
  // (世田谷/江東/新宿)がそろって公開ゲートを通過することを固定する。
  const SUPPORTED = ['13112', '13108', '13104'];

  it('承認後: 新宿を含めた3自治体の公開(supported全件)がゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後のseedは3自治体分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13104', '13108', '13112']);
  });
});

describe('publish gate — Setagaya school-transfer & childcare after human review approval (Step3)', () => {
  // なぜ: Step3 で追加した世田谷(13112)の学校転入・保育の2手続きは、
  // 2026-07-25 人手レビュー承認(ユーザー決裁)により registry.csv の4ソースがapproved化、
  // procedures.jsonのdataStatusがpartial→verifiedへ更新され、区の10手続きが公開版になった。
  // 承認前は本describeが「partial手続き+pendingソースはseed/ゲート対象から除外される」ことを
  // 検証していた(除外ロジック自体の機械検証はfixtureベースの先頭describeで恒久的に担保)。
  // 承認後は逆に、世田谷の区の全10手続きで公開ゲートが通過することを固定する。
  // 2026-08-06 に追加したライフライン4件は 2026-08-07 の人手レビュー承認(ADR-009)により
  // publishedRuleVersion(据え置き)が除去され、区の10件と合わせて計14件が公開対象になった。
  const APPROVED_STEP3_IDS = ['procedure_childcare_application', 'procedure_school_transfer'];
  const APPROVED_SOURCES = [
    'src-13112-school_transfer-001',
    'src-13112-school_transfer-002',
    'src-13112-childcare-001',
    'src-13112-childcare-002',
  ];

  it('(a) 承認後: 世田谷の区の10手続き+ライフライン等4件の計14件が公開対象、既定buildSeedは通過する', () => {
    const data = loadPublishData(repoRoot); // 既定=13112のみ
    // 公開対象は verified 14手続き全件(区の10件 + ライフライン等4件。ADR-009)。
    expect(data.procedures.length).toBe(14);
    expect(data.procedures.every((p) => p.dataStatus === 'verified')).toBe(true);
    expect(APPROVED_STEP3_IDS.every((id) => data.procedures.some((p) => p.id === id))).toBe(true);
    // 2026-08-07 承認によりライフライン4件の除外(staging)は無くなった(ADR-009)。
    expect(stagedIdsFor(data, '13112')).toEqual([]);
    expect(data.excludedRuleRefs).toEqual([]);
    // Step3で承認した4ソースは approved 集合に含まれ、公開参照(references)にも含まれる。
    const referenced = new Set(data.references.flatMap((r) => r.sourceIds));
    for (const sid of APPROVED_SOURCES) {
      expect(data.approvedSourceIds.has(sid)).toBe(true);
      expect(referenced.has(sid)).toBe(true);
    }
    // ゲートは通過し、既定シード(統合テストが使う)は緑を保つ。
    expect(() => buildSeed(repoRoot)).not.toThrow();
  });

  it('(b) 回帰ガード: 公開対象(verified)が非approvedソースを参照したら従来どおり PublishGateError で全停止する', () => {
    const data = loadPublishData(repoRoot);
    // なぜ: 承認によりゲートが無条件で緑になったわけではないことの証明。もし verified 手続き/ルールが
    // 非approvedソースを参照する状態になれば、ゲートは必ず発火する(不変条件は維持)。
    // なぜ: 実台帳に存在しない合成ソースを使う。どの自治体が承認済みかに依存しない恒久形
    // (実在の source_id を使うと、その自治体が後の Step で承認された瞬間に本テストが壊れる連鎖が続く)。
    expect(data.approvedSourceIds.has('src-synthetic-never-in-registry-000')).toBe(false);
    const input: PublishGateInput = {
      approvedSourceIds: data.approvedSourceIds,
      references: [
        ...data.references,
        {
          owner: 'procedure_version (hypothetical verified referencing non-approved)',
          sourceIds: ['src-synthetic-never-in-registry-000'],
        },
      ],
    };
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
  });
});

describe('publish gate — Suginami (13115) after human review approval (Step4-A)', () => {
  // なぜ: 2026-07-25 に杉並(13115)が人手レビュー承認(ユーザー決裁「2区とも承認」)。
  // registry.csvの全14ソースがapproved化、procedures.jsonの全10手続きがdataStatus=verifiedへ、
  // facilities.jsonのreviewStatusがapprovedへ更新された。承認前は本describeが「杉並の全項目が
  // 除外(staging)扱いでゲートを通過する」ことを検証していた(除外ロジック自体の機械検証は
  // fixtureベースの先頭describeで恒久的に担保)。承認後は逆に、杉並を含む4区の公開が
  // 除外0件で成立することを固定する(waste_scheduleは第三者SaaS依存の恒久的誠実縮退のため
  // waste.json自体を作らず、収集曜日のみ引き続き0件)。
  const SUPPORTED = ['13112', '13108', '13104', '13115'];

  it('supported全件(杉並含む)の buildSeed はゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後: 杉並の全14手続き(区の10件+ライフライン等4件)・施設・ごみ分別辞書が公開対象(除外0件)', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    const suginamiProcs = data.procedures.filter((p) => p.municipalityCode === '13115');
    expect(suginamiProcs).toHaveLength(14);
    expect(suginamiProcs.every((p) => p.dataStatus === 'verified')).toBe(true);
    expect(data.ruleSets.some((rs) => rs.municipalityCode === '13115')).toBe(true);
    expect(data.facilities.some((f) => f.municipalityCode === '13115')).toBe(true);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13115')).toBe(true);
    // 除外(staging)は発生しない(waste_scheduleはwaste.json自体が存在しないため対象外)。
    // 2026-08-07 承認によりライフライン4件の除外(staging)も無くなった(ADR-009)。
    expect(stagedIdsFor(data, '13115')).toEqual([]);
    expect(data.excludedNonProcedureSources.filter((s) => s.municipalityCode === '13115')).toEqual(
      [],
    );
    // 公開ビューの municipalities で 13115 は supported=true になる(承認済み)。
    const suginami = data.municipalities.find((m) => m.code === '13115');
    expect(suginami?.supported).toBe(true);
  });

  it('欠落する waste.json(収集曜日を作らない)でも load は失敗しない(waste_scheduleは恒久的誠実縮退)', () => {
    // なぜ: 杉並は waste.json を作らない(第三者SaaSのJSウィジェット依存で機械取得不可の
    // 恒久的な誠実縮退)。loadPublishData がファイル欠落で例外にならず、13115 の収集曜日は
    // 承認後も seed に0件で通ることを固定する。
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteAreas.some((a) => a.municipalityCode === '13115')).toBe(false);
    expect(data.wasteDatasets.some((d) => d.municipalityCode === '13115')).toBe(false);
  });

  it('承認後のseedは4区分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13104', '13108', '13112', '13115']);
  });
});

describe('publish gate — Chiyoda (13101) after human review approval (Step4-B)', () => {
  // なぜ: 2026-07-25 に人手レビュー承認済み(台帳の全13101ソースがapproved。収集曜日は公式PDF
  // のみで機械判読可能データが無いため waste.json を作らない「誠実縮退」= waste_schedule は
  // 非公開のまま)。世田谷/江東/新宿/千代田の4自治体がそろって公開ゲートを通過することを固定する。
  const SUPPORTED = ['13112', '13108', '13104', '13101'];

  it('承認後: 千代田を含めた4自治体の公開(supported全件)がゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後のseedは4自治体分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13101', '13104', '13108', '13112']);
  });

  it('誠実縮退: 千代田は waste.json 不在のため収集曜日の公開物(wasteDataset)を持たない', () => {
    // なぜ: waste_schedule を「未対応」として正しく非公開に留めることの回帰ガード
    // (公式PDFのみ=機械判読データ無しにつき推測で曜日を作らない)。
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteDatasets.some((d) => d.municipalityCode === '13101')).toBe(false);
  });
});

describe('publish gate — Shinagawa (13109) after human review approval (Step5-A)', () => {
  // なぜ: 2026-07-26 に品川(13109)が人手レビュー承認(ユーザー決裁「2区とも承認」)。
  // registry.csvの全12ソースがapproved化、procedures.jsonの全10手続きがdataStatus=verifiedへ、
  // facilities.jsonのreviewStatusがapprovedへ更新された。承認前は本describeが「品川の全項目が
  // 除外(staging)扱いでゲートを通過する」ことを検証していた(除外ロジック自体の機械検証は
  // fixtureベースの先頭describeで恒久的に担保)。承認後は逆に、品川を含む区の公開が
  // 除外0件で成立することを固定する(waste_scheduleは収集日CSVの鮮度未確認による恒久的
  // 誠実縮退のため waste.json自体を作らず、収集曜日のみ引き続き0件)。
  const SUPPORTED = ['13112', '13108', '13104', '13115', '13101', '13109'];

  it('supported全件(品川含む)の buildSeed はゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後: 品川の全14手続き(区の10件+ライフライン等4件)・施設・ごみ分別辞書が公開対象(除外0件)', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    const shinagawaProcs = data.procedures.filter((p) => p.municipalityCode === '13109');
    expect(shinagawaProcs).toHaveLength(14);
    expect(shinagawaProcs.every((p) => p.dataStatus === 'verified')).toBe(true);
    expect(data.ruleSets.some((rs) => rs.municipalityCode === '13109')).toBe(true);
    expect(data.facilities.some((f) => f.municipalityCode === '13109')).toBe(true);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13109')).toBe(true);
    // 除外(staging)は発生しない(waste_scheduleはwaste.json自体が存在しないため対象外)。
    // 2026-08-07 承認によりライフライン4件の除外(staging)も無くなった(ADR-009)。
    expect(stagedIdsFor(data, '13109')).toEqual([]);
    expect(data.excludedNonProcedureSources.filter((s) => s.municipalityCode === '13109')).toEqual(
      [],
    );
    // 公開ビューの municipalities で 13109 は supported=true になる(承認済み)。
    const shinagawa = data.municipalities.find((m) => m.code === '13109');
    expect(shinagawa?.supported).toBe(true);
  });

  it('欠落する waste.json(収集曜日を作らない)でも load は失敗しない(waste_scheduleは恒久的誠実縮退)', () => {
    // なぜ: 品川は waste.json を作らない(収集日CSVが2017年更新のままで現行年度と確認できない
    // 恒久的な誠実縮退)。loadPublishData がファイル欠落で例外にならず、13109 の収集曜日は
    // 承認後も seed に0件で通ることを固定する。
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteAreas.some((a) => a.municipalityCode === '13109')).toBe(false);
    expect(data.wasteDatasets.some((d) => d.municipalityCode === '13109')).toBe(false);
  });

  it('承認後のseedは6区分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13101', '13104', '13108', '13109', '13112', '13115']);
  });
});

describe('publish gate — Ota (13111) after human review approval (Step5-B)', () => {
  // なぜ: 2026-07-26 に大田(13111)が人手レビュー承認(ユーザー決裁「2区とも承認」)。
  // registry.csvの全14ソースがapproved化、procedures.jsonの全10手続きがdataStatus=verifiedへ、
  // facilities.jsonのreviewStatusがapprovedへ更新された。承認後に、大田を含む公開が
  // 除外0件で成立することを固定する。収集曜日(waste_schedule)はオープンデータ(XLSX)が令和7年度
  // 版で公式サイトの令和8年度版より1年度遅れのため waste.json 自体を作らず(誠実縮退)、収集曜日データ
  // は引き続き非公開(0件)。品目別ごみ分別辞書(waste_sorting)は都カタログにCSVが無く未整備(0件)。
  // ソース src-13111-waste_schedule-001 の approved 化は来歴記録のためであり、waste.json 不在により
  // 公開経路には一切載らない。
  const SUPPORTED = ['13101', '13104', '13108', '13111', '13112', '13115'];

  it('supported全件(大田含む)の buildSeed はゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後: 大田の全14手続き(区の10件+ライフライン等4件)・施設が公開対象(除外0件)、supported=true', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    const otaProcs = data.procedures.filter((p) => p.municipalityCode === '13111');
    expect(otaProcs).toHaveLength(14);
    expect(otaProcs.every((p) => p.dataStatus === 'verified')).toBe(true);
    expect(data.ruleSets.some((rs) => rs.municipalityCode === '13111')).toBe(true);
    expect(data.facilities.some((f) => f.municipalityCode === '13111')).toBe(true);
    // 除外(staging)は発生しない(waste_schedule/waste_sortingはファイル自体が存在しないため対象外)。
    // 2026-08-07 承認によりライフライン4件の除外(staging)も無くなった(ADR-009)。
    expect(stagedIdsFor(data, '13111')).toEqual([]);
    expect(data.excludedNonProcedureSources.filter((s) => s.municipalityCode === '13111')).toEqual(
      [],
    );
    const ota = data.municipalities.find((m) => m.code === '13111');
    expect(ota?.supported).toBe(true);
  });

  it('収集曜日・分別辞書は非公開のまま: waste.json / waste-sorting.json 不在で公開物0件', () => {
    // なぜ: waste_schedule はXLSXが1年度遅れのため waste.json を作らない(誠実縮退)。
    // waste_sorting は都カタログにCSVが無く未整備。両者ともファイル欠落で load は失敗せず、
    // 大田の収集曜日・分別辞書の公開物は0件で通ることを固定する(承認後も非公開を維持)。
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteAreas.some((a) => a.municipalityCode === '13111')).toBe(false);
    expect(data.wasteDatasets.some((d) => d.municipalityCode === '13111')).toBe(false);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13111')).toBe(false);
  });

  it('承認後のseedは6区分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13101', '13104', '13108', '13111', '13112', '13115']);
  });
});

describe('publish gate — seven-ward publish (Step5 integration)', () => {
  // なぜ: Step5統合後の対応7区(千代田/新宿/江東/品川/大田/世田谷/杉並)がそろって公開ゲートを
  // 通過し、7区分のルールセットが seed されることを固定する(横断の回帰ガード)。
  const SUPPORTED = ['13101', '13104', '13108', '13109', '13111', '13112', '13115'];

  it('7区の buildSeed はゲートを通過し、7区分のルールセットを含む', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13101', '13104', '13108', '13109', '13111', '13112', '13115']);
  });
});

describe('publish gate — Nerima (13120) / Itabashi (13119) after human review approval (Batch6-A)', () => {
  // なぜ: 2026-08-07 に練馬(13120)・板橋(13119)が人手レビュー承認(ユーザー決裁「2区とも承認」)。
  // registry.csvの対応23ソース(練馬11+板橋12)がapproved化、procedures.jsonの各10手続き
  // (+自治体以外のライフライン等4件をADR-009の共通テンプレートから追加)がdataStatus=verifiedへ、
  // facilities.jsonのreviewStatusがapprovedへ更新された。承認前は本describeが「2区の全項目が
  // 除外(staging)扱いでゲートを通過する」ことを検証していた(除外ロジック自体の機械検証は
  // fixtureベースの先頭describeで恒久的に担保)。承認後は逆に、2区を含む9区の公開が
  // 除外0件で成立することを固定する(waste_schedule は両区とも機械判読可能なデータが存在しない
  // ための恒久的誠実縮退。waste_sorting は練馬のみ引き続き未整備で0件、板橋は1,125品目が公開対象)。
  // 犬の登録事項変更の30日期限(狂犬病予防法第4条第4項)は板橋固有で他区(練馬含む)へは
  // 展開しないこともあわせて固定する。
  const SUPPORTED = [
    '13101',
    '13104',
    '13108',
    '13109',
    '13111',
    '13112',
    '13115',
    '13119',
    '13120',
  ];

  it('supported全件(練馬・板橋含む)の buildSeed はゲートを通過する', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('承認後: 練馬・板橋の全14手続き(区の10件+ライフライン等4件)・施設が公開対象(除外0件)、supported=true', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    for (const code of ['13119', '13120']) {
      const procs = data.procedures.filter((p) => p.municipalityCode === code);
      expect(procs).toHaveLength(14);
      expect(procs.every((p) => p.dataStatus === 'verified')).toBe(true);
      expect(data.ruleSets.some((rs) => rs.municipalityCode === code)).toBe(true);
      expect(data.facilities.some((f) => f.municipalityCode === code)).toBe(true);
      expect(stagedIdsFor(data, code)).toEqual([]);
      expect(data.excludedProcedures.filter((p) => p.municipalityCode === code)).toEqual([]);
      expect(data.excludedNonProcedureSources.filter((s) => s.municipalityCode === code)).toEqual(
        [],
      );
      const m = data.municipalities.find((x) => x.code === code);
      expect(m?.supported).toBe(true);
    }
  });

  it('板橋のごみ分別辞書(1,125品目)は公開対象。練馬・板橋とも収集曜日は引き続き非公開(誠実縮退)', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13119')).toBe(true);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13120')).toBe(false);
    for (const code of ['13119', '13120']) {
      expect(data.wasteAreas.some((a) => a.municipalityCode === code)).toBe(false);
      expect(data.wasteDatasets.some((d) => d.municipalityCode === code)).toBe(false);
    }
  });

  it('承認後のseedは9区分のルールセットを含む', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual([
      '13101',
      '13104',
      '13108',
      '13109',
      '13111',
      '13112',
      '13115',
      '13119',
      '13120',
    ]);
  });
});

describe('publish gate — nine-ward publish (Batch6-A integration)', () => {
  // なぜ: Batch6-A統合後の対応9区(千代田/新宿/江東/品川/大田/世田谷/杉並/板橋/練馬)がそろって
  // 公開ゲートを通過し、9区分のルールセットが seed されることを固定する(横断の回帰ガード)。
  const SUPPORTED = [
    '13101',
    '13104',
    '13108',
    '13109',
    '13111',
    '13112',
    '13115',
    '13119',
    '13120',
  ];

  it('9区の buildSeed はゲートを通過し、9区分のルールセットを含む', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual([
      '13101',
      '13104',
      '13108',
      '13109',
      '13111',
      '13112',
      '13115',
      '13119',
      '13120',
    ]);
  });
});
