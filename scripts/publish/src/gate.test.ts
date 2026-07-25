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
    expect(data.procedures.length).toBe(8);
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

describe('publish gate — ADR-007 verified-only publish unit (Step3 世田谷 pending追加)', () => {
  // なぜ: Step3 で公開済みの世田谷(13112, 既定シード対象)に学校転入・保育の2手続きを
  // dataStatus=partial(pending)で追加した。ADR-007により公開単位=verified手続きのみとし、
  // partial手続きとその参照ソース(pending)は seed(公開)とゲート検査の対象から除外(staging)する。
  // ゲートの不変条件(公開対象=verifiedが非approvedソースを参照したら全停止)は維持する。
  const STAGED_IDS = ['procedure_childcare_application', 'procedure_school_transfer'];
  const PENDING_SOURCES = [
    'src-13112-school_transfer-001',
    'src-13112-school_transfer-002',
    'src-13112-childcare-001',
    'src-13112-childcare-002',
  ];

  it('(a) partial手続き+pendingソースは公開から除外され、pending参照はゲート対象外→既定buildSeedは通過する', () => {
    const data = loadPublishData(repoRoot); // 既定=13112のみ
    // 公開対象は verified 8手続きのみ(pending 2手続きは seed に載らない)。
    expect(data.procedures.length).toBe(8);
    expect(data.procedures.every((p) => p.dataStatus === 'verified')).toBe(true);
    // 除外された手続き・ルールが報告される(publish CLI が件数をログ出力する根拠)。
    expect(data.excludedProcedures.map((p) => p.id).sort()).toEqual(STAGED_IDS);
    expect([...new Set(data.excludedRuleRefs.map((r) => r.procedureId))].sort()).toEqual(
      STAGED_IDS,
    );
    // pending ソースは registry には実在するが approved ではなく、公開参照(references)にも含まれない。
    const referenced = new Set(data.references.flatMap((r) => r.sourceIds));
    for (const sid of PENDING_SOURCES) {
      expect(data.approvedSourceIds.has(sid)).toBe(false);
      expect(referenced.has(sid)).toBe(false);
    }
    // よってゲートは通過し、既定シード(統合テストが使う)は緑を保つ。
    expect(() => buildSeed(repoRoot)).not.toThrow();
  });

  it('(b) 回帰ガード: 公開対象(verified)が pendingソースを参照したら従来どおり PublishGateError で全停止する', () => {
    const data = loadPublishData(repoRoot);
    // なぜ: 「pendingは除外される」だけを緩めた設計ではないことの証明。もし verified 手続き/ルールが
    // pending ソースを参照する状態になれば、ゲートは必ず発火する(不変条件は強化のまま維持)。
    const input: PublishGateInput = {
      approvedSourceIds: data.approvedSourceIds,
      references: [
        ...data.references,
        {
          owner: 'procedure_version (hypothetical verified referencing pending)',
          sourceIds: ['src-13112-school_transfer-001'],
        },
      ],
    };
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
  });
});
