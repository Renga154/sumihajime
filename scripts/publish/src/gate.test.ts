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
    // 2026-07-25 人手レビュー承認(Step3)により世田谷は全10手続きが公開対象。
    expect(data.procedures.length).toBe(10);
    expect(data.ruleSets[0]?.municipalityCode).toBe('13112');
    expect(statements.length).toBeGreaterThan(0);
    // すべての手続きの sourceIds は approved 集合に含まれる。
    for (const p of data.procedures) {
      for (const sid of p.sourceIds) {
        expect(data.approvedSourceIds.has(sid)).toBe(true);
      }
    }
  });

  it('synthesizes unique facility_ids (源データの壊れたIDを機械置換)', () => {
    const data = loadPublishData(repoRoot);
    const ids = data.facilities.map((f) => f.facilityId);
    expect(new Set(ids).size).toBe(ids.length); // 一意
    expect(ids[0]).toMatch(/^13112-fac-\d{3}$/);
  });

  it('injecting a non-approved reference into the real dataset trips the gate', () => {
    const data = loadPublishData(repoRoot);
    const input: PublishGateInput = {
      approvedSourceIds: data.approvedSourceIds,
      references: [
        ...data.references,
        // なぜ: 江東(13108)・新宿(13104)は2026-07-22承認済みのため、未承認ソースの
        // fixtureとして杉並(13115、未整備・candidateのまま)の登録行を使う。
        { owner: 'procedure_injected', sourceIds: ['src-13115-facilities-001'] }, // candidate
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
  // procedures.jsonのdataStatusがpartial→verifiedへ、rules.jsonのpublishedRuleVersionが除去
  // され ruleVersion(2026-07-25.1)がそのまま公開版になった。
  // 承認前は本describeが「partial手続き+pendingソースはseed/ゲート対象から除外される」ことを
  // 検証していた(除外ロジック自体の機械検証はfixtureベースの先頭describeで恒久的に担保)。
  // 承認後は逆に、世田谷の全10手続き・除外0件で公開ゲートが通過することを固定する。
  const APPROVED_STEP3_IDS = ['procedure_childcare_application', 'procedure_school_transfer'];
  const APPROVED_SOURCES = [
    'src-13112-school_transfer-001',
    'src-13112-school_transfer-002',
    'src-13112-childcare-001',
    'src-13112-childcare-002',
  ];

  it('(a) 承認後: 世田谷の全10手続きが公開対象(除外0件)、既定buildSeedは通過する', () => {
    const data = loadPublishData(repoRoot); // 既定=13112のみ
    // 公開対象は verified 10手続き全件(除外なし)。
    expect(data.procedures.length).toBe(10);
    expect(data.procedures.every((p) => p.dataStatus === 'verified')).toBe(true);
    expect(APPROVED_STEP3_IDS.every((id) => data.procedures.some((p) => p.id === id))).toBe(true);
    // 除外(staging)は発生しない。
    expect(data.excludedProcedures).toEqual([]);
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
    const input: PublishGateInput = {
      approvedSourceIds: data.approvedSourceIds,
      references: [
        ...data.references,
        {
          owner: 'procedure_version (hypothetical verified referencing non-approved)',
          sourceIds: ['src-13115-facilities-001'], // 杉並(13115)はStep4-Aで pending のまま(非approved)
        },
      ],
    };
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
  });
});

describe('publish gate — Suginami (13115) pending inclusion (ADR-007 new behavior, Step4-A)', () => {
  // なぜ: Step4-Aで杉並を supported=true にしたため、publish CLI(supported全件)は 13115 を
  // 公開対象に含める。杉並の全ソースは pending(非approved)・全手続きは partial のため、ADR-007の
  // 精緻化(手続きは dataStatus、施設・ごみはソースapproved で公開可否を判断)により、杉並の全項目が
  // 「除外(staging)」扱いになりゲートは通過する(旧T-015/T-016の『pending自治体はゲートで全停止』
  // からの挙動変化)。承認(全ソースapproved化+partial解除)と同時にマージすれば公開へ切り替わる。
  const SUPPORTED = ['13112', '13108', '13104', '13115'];

  it('supported全件(杉並含む)の buildSeed はゲートを通過する(杉並は全除外)', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations).toEqual([]);
  });

  it('杉並の手続き・ルール・非手続きソースは公開されず、全て除外(staging)として報告される', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    // 公開物(seed)に 13115 は一切含まれない。
    expect(data.procedures.some((p) => p.municipalityCode === '13115')).toBe(false);
    expect(data.ruleSets.some((rs) => rs.municipalityCode === '13115')).toBe(false);
    expect(data.facilities.some((f) => f.municipalityCode === '13115')).toBe(false);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === '13115')).toBe(false);
    // 除外(staging)側に 13115 の手続き10件・非手続きソース(施設001/002・分別辞書)が報告される。
    expect(data.excludedProcedures.filter((p) => p.municipalityCode === '13115')).toHaveLength(10);
    const excludedNonProc = data.excludedNonProcedureSources
      .filter((s) => s.municipalityCode === '13115')
      .map((s) => s.sourceId)
      .sort();
    expect(excludedNonProc).toEqual(
      [
        'src-13115-facilities-001',
        'src-13115-facilities-002',
        'src-13115-waste_sorting-001',
      ].sort(),
    );
    // 公開ビューの municipalities では 13115 は supported=false のまま(承認まで対応済みに見せない)。
    const suginami = data.municipalities.find((m) => m.code === '13115');
    expect(suginami?.supported).toBe(false);
  });

  it('欠落する waste.json(収集曜日を作らない)でも load は失敗しない', () => {
    // なぜ: 杉並は waste.json を作らない(誠実縮退)。loadPublishData がファイル欠落で例外に
    // ならず、13115 の収集曜日は seed に0件で通ることを固定する。
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(data.wasteAreas.some((a) => a.municipalityCode === '13115')).toBe(false);
    expect(data.wasteDatasets.some((d) => d.municipalityCode === '13115')).toBe(false);
  });

  it('既存3区(世田谷/江東/新宿)の公開は不変: seedに3区のルールセットが載る', () => {
    const { data } = buildSeed(repoRoot, SUPPORTED);
    const codes = data.ruleSets.map((rs) => rs.municipalityCode).sort();
    expect(codes).toEqual(['13104', '13108', '13112']);
  });
});
