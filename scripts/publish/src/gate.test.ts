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
        { owner: 'procedure_injected', sourceIds: ['src-13104-waste_schedule-001'] }, // candidate
      ],
    };
    expect(() => assertPublishGate(input)).toThrow(PublishGateError);
  });
});

describe('publish gate — Koto (13108) pending sources are rejected (T-015)', () => {
  // なぜ: 江東区データは整備済みだが全ソースが pending/candidate(人手レビュー未承認)。
  // supportedな全自治体を対象にする実運用publish(publish.ts と同じ引数)では、承認ゲートが
  // 江東の参照を拒否し buildSeed が例外になる=未レビューデータをD1へ載せない構造的関門。
  // これが本タスクの「dry-runが13108起因で失敗する挙動が正」の機械検証。
  const SUPPORTED = ['13112', '13108'];

  it('江東を含めた公開(supported全件)は PublishGateError で止まる', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).toThrow(PublishGateError);
  });

  it('違反は全て 13108 のソース(procedure/rule/facilities/waste)で、13112 由来の違反は無い', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    const violations = findGateViolations({
      approvedSourceIds: data.approvedSourceIds,
      references: data.references,
    });
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.sourceId.startsWith('src-13108-'), `unexpected violation: ${v.sourceId}`).toBe(true);
      expect(v.reason).toBe('not_approved');
    }
    // 江東の主要な pending/candidate ソースが確かに拒否されている。
    const rejected = new Set(violations.map((v) => v.sourceId));
    for (const sid of [
      'src-13108-resident_registration-001',
      'src-13108-my_number-001',
      'src-13108-school_transfer-001',
      'src-13108-facilities-001',
      'src-13108-waste_schedule-001',
    ]) {
      expect(rejected.has(sid), `expected ${sid} to be rejected by the gate`).toBe(true);
    }
  });

  it('デフォルト(世田谷のみ)の buildSeed は従来どおり成功する(江東の追加が既存公開を壊さない)', () => {
    // d1-harness / CI は引数なし buildSeed を使うため、この不変条件を固定する。
    expect(() => buildSeed(repoRoot)).not.toThrow();
    const { data } = buildSeed(repoRoot);
    expect(data.ruleSets).toHaveLength(1);
    expect(data.ruleSets[0]?.municipalityCode).toBe('13112');
  });
});
