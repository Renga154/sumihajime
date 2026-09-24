import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGateViolations } from './gate.js';
import { loadPublishData } from './load.js';
import { MUNICIPALITIES } from './municipalities.js';
import { buildSeed } from './seed.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * なぜ: 2026-09-25 に八王子市(13201)のデータを人手レビュー前のまま置いた(手続きは
 * dataStatus=partial、出典は review_status=pending)。municipalities.ts の supported は false
 * のままなので、CLI の publish(supported 全件が対象)は八王子市をそもそも読まない。
 * それでも「誰かが対象に含めたら公開されてしまう」状態ではないことを、八王子市を明示的に
 * 対象へ加えた load/seed で固定する(ADR-007: 公開単位は verified の手続き・approved の出典だけ)。
 */
const HACHIOJI = '13201';
const SUPPORTED = MUNICIPALITIES.filter((m) => m.supported).map((m) => m.code);
const WITH_HACHIOJI = [...SUPPORTED, HACHIOJI];

describe('publish — 八王子市(13201)は承認まで公開されない', () => {
  it('静的マスタでは未対応のまま(CLI の publish 対象に入らない)', () => {
    const m = MUNICIPALITIES.find((x) => x.code === HACHIOJI);
    expect(m?.name).toBe('八王子市');
    expect(m?.supported).toBe(false);
    expect(SUPPORTED).not.toContain(HACHIOJI);
  });

  it('対象に含めても、14手続き(市の10件+自治体以外の4件)・14ルールはすべて除外され、ゲートは通る', () => {
    expect(() => buildSeed(repoRoot, WITH_HACHIOJI)).not.toThrow();
    const data = loadPublishData(repoRoot, WITH_HACHIOJI);
    expect(
      findGateViolations({
        approvedSourceIds: data.approvedSourceIds,
        references: data.references,
      }),
    ).toEqual([]);

    const excluded = data.excludedProcedures.filter((p) => p.municipalityCode === HACHIOJI);
    expect(excluded).toHaveLength(14);
    expect(excluded.every((p) => p.dataStatus === 'partial')).toBe(true);
    expect(data.excludedRuleRefs.filter((r) => r.municipalityCode === HACHIOJI)).toHaveLength(14);

    expect(data.procedures.some((p) => p.municipalityCode === HACHIOJI)).toBe(false);
    // 公開ルールが0件の自治体は rule_set 自体を seed しない。
    expect(data.ruleSets.some((rs) => rs.municipalityCode === HACHIOJI)).toBe(false);
  });

  it('施設も出典が pending のため公開されず、除外として報告される', () => {
    const data = loadPublishData(repoRoot, WITH_HACHIOJI);
    expect(data.facilities.some((f) => f.municipalityCode === HACHIOJI)).toBe(false);
    const excludedSources = data.excludedNonProcedureSources
      .filter((s) => s.municipalityCode === HACHIOJI)
      .map((s) => s.sourceId)
      .sort();
    expect(excludedSources).toEqual([
      'src-13201-facilities-001',
      'src-13201-resident_registration-001',
    ]);
  });

  it('公開ビューの自治体マスタでも supported=false、出典も seed に載らない', () => {
    const { data, statements } = buildSeed(repoRoot, WITH_HACHIOJI);
    expect(data.municipalities.find((m) => m.code === HACHIOJI)?.supported).toBe(false);
    expect(data.approvedSources.some((s) => s.municipalityCode === HACHIOJI)).toBe(false);
    expect(statements.some((s) => s.includes('src-13201-'))).toBe(false);
  });

  it('既定の publish 対象(supported 全件)の出力は八王子市を含めても含めなくても同じ', () => {
    // なぜ: 未公開データを置いたことで、既存23区の公開物が1行も変わっていないことを確かめる。
    const base = buildSeed(repoRoot, SUPPORTED).statements;
    const withHachioji = buildSeed(repoRoot, WITH_HACHIOJI).statements;
    expect(withHachioji).toEqual(base);
  });
});
