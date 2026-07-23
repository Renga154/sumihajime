import { describe, expect, it } from 'vitest';
import {
  facilitySchema,
  wasteAreaSchema,
  wasteScheduleSchema,
  wasteSortingItemSchema,
} from './facility.js';

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

describe('wasteSortingItemSchema', () => {
  it('parses a minimal item without optional fields (notes/feeNote/reading absent)', () => {
    const result = wasteSortingItemSchema.safeParse({
      itemId: '131121S00002',
      municipalityCode: '13112',
      name: 'アイロン',
      category: '不燃ごみ',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(result.success).toBe(true);
  });

  it('parses an item with notes and feeNote populated from CSV columns', () => {
    const result = wasteSortingItemSchema.safeParse({
      itemId: '131121S00001',
      municipalityCode: '13112',
      name: 'アイスピック',
      category: '不燃ごみ',
      notes: '新聞紙等に包んで「キケン」と表示してください',
      feeNote: '無料',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required category', () => {
    const result = wasteSortingItemSchema.safeParse({
      itemId: 'x',
      municipalityCode: '13112',
      name: 'x',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid municipalityCode (not 5 digits)', () => {
    const result = wasteSortingItemSchema.safeParse({
      itemId: 'x',
      municipalityCode: '131121',
      name: 'x',
      category: '不燃ごみ',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra fields (strictObject)', () => {
    const result = wasteSortingItemSchema.safeParse({
      itemId: 'x',
      municipalityCode: '13112',
      name: 'x',
      category: '不燃ごみ',
      sourceId: 'src-13112-waste_sorting-001',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});
