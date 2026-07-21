import { describe, expect, it } from 'vitest';
import { municipalitySchema, coverageSchema, municipalityCodeSchema } from './municipality.js';

describe('municipalityCodeSchema', () => {
  it('accepts a 5-digit code', () => {
    expect(municipalityCodeSchema.safeParse('13112').success).toBe(true);
  });

  it('rejects a non-5-digit code', () => {
    expect(municipalityCodeSchema.safeParse('131').success).toBe(false);
    expect(municipalityCodeSchema.safeParse('131120').success).toBe(false);
    expect(municipalityCodeSchema.safeParse('1311a').success).toBe(false);
  });
});

describe('municipalitySchema', () => {
  it('parses a valid municipality (normal case)', () => {
    const result = municipalitySchema.safeParse({
      code: '13112',
      name: '世田谷区',
      supported: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required field name', () => {
    expect(municipalitySchema.safeParse({ code: '13112', supported: true }).success).toBe(false);
  });

  it('rejects unknown extra properties (strict)', () => {
    const result = municipalitySchema.safeParse({
      code: '13112',
      name: '世田谷区',
      supported: true,
      unexpected: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an optional officialUrl (FR-021 公式導線)', () => {
    const result = municipalitySchema.safeParse({
      code: '13115',
      name: '杉並区',
      supported: false,
      note: '未対応',
      officialUrl: 'https://www.city.suginami.tokyo.jp/',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-URL officialUrl', () => {
    const result = municipalitySchema.safeParse({
      code: '13115',
      name: '杉並区',
      supported: false,
      officialUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('coverageSchema', () => {
  it('rejects an enum value outside coverageStatus', () => {
    const result = coverageSchema.safeParse({
      municipalityCode: '13112',
      category: 'waste',
      status: 'not_a_status',
      lastVerifiedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid coverage record', () => {
    const result = coverageSchema.safeParse({
      municipalityCode: '13112',
      category: 'waste',
      status: 'verified',
      lastVerifiedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
