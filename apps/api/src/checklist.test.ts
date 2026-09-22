import { describe, expect, it } from 'vitest';
import type { ProcedureVersion, RuleOutcome, Source } from '@tmn/schemas';
import { buildTasks } from './checklist.js';
import type { DriftMark } from './db.js';

/**
 * なぜ: ADR-014 の自動降格は buildTasks(純関数)で重ねる。マーク無し→不変、根拠ソースに
 * マークあり→stale と検知日、unavailable は据え置き、無関係なマークは無効果、を固定する。
 */

function source(id: string): Source {
  return {
    sourceId: id,
    sourceTitle: `title ${id}`,
    ownerOrganization: 'テスト区',
    municipalityCode: '13112',
    category: 'resident_registration',
    sourceUrl: `https://www.city.setagaya.lg.jp/${id}.html`,
    sourceType: 'html',
    license: 'test',
    attributionText: 'テスト区',
    fetchMethod: 'manual',
    updateFrequency: 'irregular',
    lastVerifiedAt: '2026-07-21T00:00:00Z',
    reviewStatus: 'approved',
  };
}

function procedure(over: Partial<ProcedureVersion> = {}): ProcedureVersion {
  return {
    id: 'procedure_resident_registration',
    version: '2026-07-21.1',
    municipalityCode: '13112',
    canonicalType: 'resident_registration',
    title: '転入届',
    shortDescription: '転入の届出',
    applicabilityReason: 'すべての方に必要です。',
    priority: 'urgent',
    requiredDocuments: [],
    channels: ['counter'],
    sourceIds: ['src-a', 'src-b'],
    lastVerifiedAt: '2026-07-21T00:00:00Z',
    dataStatus: 'verified',
    ...over,
  };
}

function outcome(): RuleOutcome {
  return {
    procedureId: 'procedure_resident_registration',
    applicable: 'applicable',
    applicabilityReason: 'すべての方に必要です。',
    priority: 'urgent',
    dueDate: '2026-08-15',
    sourceIds: ['src-a', 'src-b'],
    warnings: [],
  };
}

const sources = new Map([
  ['src-a', source('src-a')],
  ['src-b', source('src-b')],
]);

describe('buildTasks — 巡回マークの重ね合わせ(ADR-014)', () => {
  it('マークが無ければ従来どおり(dataStatus 不変・drift 項目なし)', () => {
    const [task] = buildTasks([outcome()], new Map([[procedure().id, procedure()]]), sources, 'v1');
    expect(task?.dataStatus).toBe('verified');
    for (const s of task?.sources ?? []) {
      expect(s.driftDetectedOn).toBeUndefined();
      expect(s.driftKind).toBeUndefined();
    }
  });

  it('根拠ソースの1件にマークがあれば stale になり、そのソースだけに検知日・種類が付く', () => {
    const marks = new Map<string, DriftMark>([
      ['src-b', { status: 'changed', detectedOn: '2026-09-22' }],
    ]);
    const [task] = buildTasks(
      [outcome()],
      new Map([[procedure().id, procedure()]]),
      sources,
      'v1',
      marks,
    );
    expect(task?.dataStatus).toBe('stale');
    const a = task?.sources.find((s) => s.sourceId === 'src-a');
    const b = task?.sources.find((s) => s.sourceId === 'src-b');
    expect(a?.driftKind).toBeUndefined();
    expect(b?.driftKind).toBe('changed');
    expect(b?.driftDetectedOn).toBe('2026-09-22');
    // 公式リンクは消さない(原則8)。
    expect(b?.url).toBe('https://www.city.setagaya.lg.jp/src-b.html');
  });

  it('unreachable も同様に stale へ落とす', () => {
    const marks = new Map<string, DriftMark>([
      ['src-a', { status: 'unreachable', detectedOn: '2026-09-22' }],
    ]);
    const [task] = buildTasks(
      [outcome()],
      new Map([[procedure().id, procedure()]]),
      sources,
      'v1',
      marks,
    );
    expect(task?.dataStatus).toBe('stale');
    expect(task?.sources.find((s) => s.sourceId === 'src-a')?.driftKind).toBe('unreachable');
  });

  it('unavailable の手続きは unavailable のまま(未整備をより良く見せない)', () => {
    const pv = procedure({ dataStatus: 'unavailable' });
    const marks = new Map<string, DriftMark>([
      ['src-a', { status: 'changed', detectedOn: '2026-09-22' }],
    ]);
    const [task] = buildTasks([outcome()], new Map([[pv.id, pv]]), sources, 'v1', marks);
    expect(task?.dataStatus).toBe('unavailable');
    // 検知日は根拠カード側には出す(ソース自体の状態だから)。
    expect(task?.sources.find((s) => s.sourceId === 'src-a')?.driftDetectedOn).toBe('2026-09-22');
  });

  it('この手続きが参照しないソースへのマークは何も変えない', () => {
    const marks = new Map<string, DriftMark>([
      ['src-other', { status: 'changed', detectedOn: '2026-09-22' }],
    ]);
    const [task] = buildTasks(
      [outcome()],
      new Map([[procedure().id, procedure()]]),
      sources,
      'v1',
      marks,
    );
    expect(task?.dataStatus).toBe('verified');
    for (const s of task?.sources ?? []) expect(s.driftKind).toBeUndefined();
  });
});
