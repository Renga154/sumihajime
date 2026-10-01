import { describe, expect, it } from 'vitest';
import type { SourceRef } from '@tmn/publish';
import { runValidations } from './validate-core.js';
import { validateRegistryRows, type RegistryTable } from './registry.js';

const HEADER = [
  'source_id',
  'source_title',
  'owner_organization',
  'municipality_code',
  'category',
  'source_url',
  'source_type',
  'license',
  'attribution_text',
  'fetch_method',
  'update_frequency',
  'last_fetched_at',
  'last_verified_at',
  'source_last_modified_at',
  'content_hash',
  'effective_from',
  'effective_to',
  'review_status',
  'reviewer',
  'notes',
];

/** テスト用の registry 行を最小デフォルトで作る。 */
function makeTable(rows: Array<Partial<Record<string, string>>>): RegistryTable {
  const defaults: Record<string, string> = {
    source_title: 'Title',
    owner_organization: 'Owner',
    municipality_code: '13112',
    category: 'facilities',
    source_url: 'https://www.city.setagaya.lg.jp/x.csv',
    source_type: 'csv',
    license: 'CC BY 4.0',
    attribution_text: 'Attr',
    fetch_method: 'http_get',
    update_frequency: 'annual',
    last_fetched_at: '2026-07-21',
    last_verified_at: '2026-07-21',
    review_status: 'approved',
  };
  return {
    header: HEADER,
    eol: '\n',
    rows: rows.map((r) => {
      const rec = { ...defaults, ...r };
      return HEADER.map((col) => rec[col] ?? '');
    }),
  };
}

const TODAY = '2026-07-22';

describe('runValidations — offline registry & published-data checks', () => {
  it('passes on a clean dataset with no references', () => {
    const table = makeTable([{ source_id: 'src-13112-a-001' }, { source_id: 'src-13112-b-001' }]);
    const result = runValidations({
      rows: validateRegistryRows(table),
      references: [],
      approvedSourceIds: new Set(['src-13112-a-001', 'src-13112-b-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('FAILS on expired effective_to (§12.5 stale detection) and exits non-zero', () => {
    const table = makeTable([
      { source_id: 'src-13112-old-001', effective_to: '2025-03-31', category: 'waste_schedule' },
    ]);
    const result = runValidations({
      rows: validateRegistryRows(table),
      references: [],
      approvedSourceIds: new Set(['src-13112-old-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.stats.expiredCount).toBe(1);
    expect(result.errors.join('\n')).toMatch(/EXPIRED/);
  });

  it('warns (but passes) when effective_to is within 30 days', () => {
    const table = makeTable([
      { source_id: 'src-13112-soon-001', effective_to: '2026-08-10', category: 'waste_schedule' },
    ]);
    const result = runValidations({
      rows: validateRegistryRows(table),
      references: [],
      approvedSourceIds: new Set(['src-13112-soon-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(true);
    expect(result.stats.expiringSoonCount).toBe(1);
    expect(result.warnings.join('\n')).toMatch(/expires in/);
  });

  it('FAILS when a published reference points to a non-existent sourceId', () => {
    const table = makeTable([{ source_id: 'src-13112-a-001' }]);
    const references: SourceRef[] = [
      { owner: 'procedure_p', municipalityCode: '13112', sourceIds: ['src-13112-ghost-001'] },
    ];
    const result = runValidations({
      rows: validateRegistryRows(table),
      references,
      approvedSourceIds: new Set(['src-13112-a-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/does NOT exist in registry/);
  });

  it('FAILS when a municipality cites another municipality’s source (principle 4)', () => {
    const table = makeTable([{ source_id: 'src-13112-a-001' }]);
    const references: SourceRef[] = [
      { owner: 'procedure_p', municipalityCode: '13108', sourceIds: ['src-13112-a-001'] },
    ];
    const result = runValidations({
      rows: validateRegistryRows(table),
      references,
      approvedSourceIds: new Set(['src-13112-a-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/another municipality \(13112\)/);
  });

  it('FAILS when a published reference points to a non-approved (existing) sourceId', () => {
    const table = makeTable([
      { source_id: 'src-13112-a-001' },
      { source_id: 'src-13112-cand-001', review_status: 'candidate' },
    ]);
    const references: SourceRef[] = [
      { owner: 'procedure_p', municipalityCode: '13112', sourceIds: ['src-13112-cand-001'] },
    ];
    const result = runValidations({
      rows: validateRegistryRows(table),
      references,
      approvedSourceIds: new Set(['src-13112-a-001']), // src-cand is NOT approved
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/is not approved/);
  });

  it('FAILS when last_verified_at is missing', () => {
    const table = makeTable([{ source_id: 'src-13112-a-001', last_verified_at: '' }]);
    const result = runValidations({
      rows: validateRegistryRows(table),
      references: [],
      approvedSourceIds: new Set(['src-13112-a-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.stats.missingLastVerifiedCount).toBe(1);
    expect(result.errors.join('\n')).toMatch(/last_verified_at/);
  });

  it('reports registry schema violations (bad url)', () => {
    const table = makeTable([{ source_id: 'src-13112-a-001', source_url: 'not-a-url' }]);
    const result = runValidations({
      rows: validateRegistryRows(table),
      references: [],
      approvedSourceIds: new Set(['src-13112-a-001']),
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.stats.schemaErrorCount).toBe(1);
  });
});
