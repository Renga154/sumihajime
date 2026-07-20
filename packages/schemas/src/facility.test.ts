import { describe, expect, it } from 'vitest';
import { facilitySchema, wasteAreaSchema, wasteScheduleSchema } from './facility.js';

describe('facilitySchema', () => {
  it('parses a valid facility without lat/lng (ADR-005: distance calc not done)', () => {
    const result = facilitySchema.safeParse({
      facilityId: 'facility_setagaya_kuyakusho',
      municipalityCode: '13112',
      name: '世田谷区役所',
      category: 'city_office',
      address: '東京都世田谷区世田谷4-21-27',
      sourceId: 'source_setagaya_facilities',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range latitude (boundary)', () => {
    const result = facilitySchema.safeParse({
      facilityId: 'facility_x',
      municipalityCode: '13112',
      name: 'x',
      category: 'city_office',
      address: 'x',
      lat: 200,
      sourceId: 'source_x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field sourceId', () => {
    const result = facilitySchema.safeParse({
      facilityId: 'facility_x',
      municipalityCode: '13112',
      name: 'x',
      category: 'city_office',
      address: 'x',
    });
    expect(result.success).toBe(false);
  });
});

describe('wasteAreaSchema / wasteScheduleSchema', () => {
  it('parses a valid waste area', () => {
    expect(
      wasteAreaSchema.safeParse({
        areaId: 'area_1',
        municipalityCode: '13112',
        areaLabel: '世田谷1丁目',
      }).success,
    ).toBe(true);
  });

  it('parses a valid waste schedule with a required effectiveFrom (C-9)', () => {
    const result = wasteScheduleSchema.safeParse({
      areaId: 'area_1',
      wasteType: 'burnable',
      weekday: 'monday',
      sourceId: 'source_setagaya_waste',
      effectiveFrom: '2026-04-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a waste schedule missing effectiveFrom (year-based data must have a validity period)', () => {
    const result = wasteScheduleSchema.safeParse({
      areaId: 'area_1',
      wasteType: 'burnable',
      weekday: 'monday',
      sourceId: 'source_setagaya_waste',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid weekday enum value', () => {
    const result = wasteScheduleSchema.safeParse({
      areaId: 'area_1',
      wasteType: 'burnable',
      weekday: 'someday',
      sourceId: 'source_setagaya_waste',
      effectiveFrom: '2026-04-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects weekOfMonth = 0 (boundary)', () => {
    const result = wasteScheduleSchema.safeParse({
      areaId: 'area_1',
      wasteType: 'oversized',
      weekday: 'monday',
      weekOfMonth: [0],
      sourceId: 'source_setagaya_waste',
      effectiveFrom: '2026-04-01',
    });
    expect(result.success).toBe(false);
  });
});
