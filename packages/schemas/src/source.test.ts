import { describe, expect, it } from 'vitest';
import { sourceSchema, sourceSnapshotSchema } from './source.js';

const validSource = {
  sourceId: 'source_setagaya_juuminidou',
  sourceTitle: '転入届 - 世田谷区公式サイト',
  ownerOrganization: '世田谷区',
  municipalityCode: '13112',
  category: 'resident_registration',
  sourceUrl: 'https://www.city.setagaya.lg.jp/example/',
  sourceType: 'html' as const,
  license: 'CC BY 4.0',
  attributionText: '世田谷区公式サイトより',
  fetchMethod: 'scripts/ingest html fetch',
  updateFrequency: 'as-needed',
  reviewStatus: 'approved' as const,
};

describe('sourceSchema (§12.3 registry)', () => {
  it('parses a valid registry entry (normal case)', () => {
    expect(sourceSchema.safeParse(validSource).success).toBe(true);
  });

  it('rejects missing required field sourceUrl', () => {
    const { sourceUrl: _sourceUrl, ...rest } = validSource;
    expect(sourceSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid sourceType enum value', () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceType: 'blog' }).success).toBe(false);
  });

  it("accepts sourceType 'xlsx' (Step5-B: 大田区の収集曜日オープンデータはXLSX配信)", () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceType: 'xlsx' }).success).toBe(true);
  });

  it('rejects an invalid reviewStatus enum value', () => {
    expect(sourceSchema.safeParse({ ...validSource, reviewStatus: 'unofficial' }).success).toBe(
      false,
    );
  });

  it('rejects a non-URL sourceUrl', () => {
    expect(sourceSchema.safeParse({ ...validSource, sourceUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects extra unexpected properties (strict)', () => {
    expect(sourceSchema.safeParse({ ...validSource, extraField: 1 }).success).toBe(false);
  });
});

describe('sourceSnapshotSchema', () => {
  it('parses a valid snapshot record', () => {
    const result = sourceSnapshotSchema.safeParse({
      id: 'snap_1',
      sourceId: 'source_setagaya_juuminidou',
      storageKey: 'r2://snapshots/source_setagaya_juuminidou/2026-08-20.html',
      contentHash: 'sha256:abcdef',
      fetchedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing contentHash', () => {
    const result = sourceSnapshotSchema.safeParse({
      id: 'snap_1',
      sourceId: 'source_setagaya_juuminidou',
      storageKey: 'r2://x',
      fetchedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});
