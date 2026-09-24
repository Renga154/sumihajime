import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGateViolations } from './gate.js';
import { loadPublishData } from './load.js';
import { MUNICIPALITIES } from './municipalities.js';
import { buildSeed } from './seed.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * なぜ: 八王子市(13201)は 2026-09-25 に人手レビュー承認された(承認前は本ファイルが
 * hachioji-pending.test.ts として「対象に含めても全件が除外(staging)される」ことを検証していた)。
 * 承認後は逆に、CLI の publish 対象(supported 全件)に八王子市が入り、14手続き・14ルール・窓口14件が
 * 除外0件で公開され、ゲートを通過することを固定する(ADR-007: 公開単位は verified の手続き・approved の出典)。
 */
const HACHIOJI = '13201';
const SUPPORTED = MUNICIPALITIES.filter((m) => m.supported).map((m) => m.code);

describe('publish — 八王子市(13201)は承認後に公開される', () => {
  it('静的マスタで supported=true(CLI の publish 対象に入る)', () => {
    const m = MUNICIPALITIES.find((x) => x.code === HACHIOJI);
    expect(m?.name).toBe('八王子市');
    expect(m?.supported).toBe(true);
    expect(SUPPORTED).toContain(HACHIOJI);
  });

  it('supported 全件の buildSeed はゲートを通過し、除外(staging)は0件', () => {
    expect(() => buildSeed(repoRoot, SUPPORTED)).not.toThrow();
    const data = loadPublishData(repoRoot, SUPPORTED);
    expect(
      findGateViolations({
        approvedSourceIds: data.approvedSourceIds,
        references: data.references,
      }),
    ).toEqual([]);
    expect(data.excludedProcedures).toEqual([]);
    expect(data.excludedRuleRefs).toEqual([]);
    expect(data.excludedNonProcedureSources.filter((s) => s.municipalityCode === HACHIOJI)).toEqual(
      [],
    );
  });

  it('14手続き(市の10件+自治体以外の4件)・14ルール・窓口14件がすべて公開対象', () => {
    const data = loadPublishData(repoRoot, SUPPORTED);
    const procs = data.procedures.filter((p) => p.municipalityCode === HACHIOJI);
    expect(procs).toHaveLength(14);
    expect(procs.every((p) => p.dataStatus === 'verified')).toBe(true);
    const rs = data.ruleSets.find((r) => r.municipalityCode === HACHIOJI);
    expect(rs?.rules).toHaveLength(14);
    expect(data.facilities.filter((f) => f.municipalityCode === HACHIOJI)).toHaveLength(14);
    // 収集曜日・分別辞書は作っていないため公開物0件のまま(承認後も非公開)。
    expect(data.wasteDatasets.some((d) => d.municipalityCode === HACHIOJI)).toBe(false);
    expect(data.wasteSortingItems.some((i) => i.municipalityCode === HACHIOJI)).toBe(false);
  });

  it('公開ビューの自治体マスタでも supported=true、出典24件(八王子市23+東京都水道局1)が seed に載る', () => {
    const { data, statements } = buildSeed(repoRoot, SUPPORTED);
    expect(data.municipalities.find((m) => m.code === HACHIOJI)?.supported).toBe(true);
    expect(data.approvedSources.filter((s) => s.municipalityCode === HACHIOJI)).toHaveLength(23);
    expect(data.approvedSourceIds.has('src-13000-water_supply-002')).toBe(true);
    expect(statements.some((s) => s.includes('src-13201-'))).toBe(true);
  });
});
