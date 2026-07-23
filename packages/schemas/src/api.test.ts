import { describe, expect, it } from 'vitest';
import {
  checklistRequestSchema,
  checklistResponseSchema,
  chatRequestSchema,
  chatResponseSchema,
  errorResponseSchema,
  wasteSortingSearchResponseSchema,
  wasteSortingSummaryResponseSchema,
} from './api.js';

const profile141Fixture = {
  destination: { municipalityCode: '13112', postalCode: '0000000', town: '例町' },
  moveDate: '2026-08-15',
  originType: 'outside_tokyo',
  household: { memberCount: 3, ageBands: ['adult', 'adult', 'age3_5'] },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: false,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: true,
    hasDog: false,
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
  },
};

describe('checklistRequestSchema (= Profile, §14.1)', () => {
  it('parses the §14.1 example as-is', () => {
    expect(checklistRequestSchema.safeParse(profile141Fixture).success).toBe(true);
  });
});

describe('checklistResponseSchema', () => {
  it('parses a valid empty-tasks response (normal case)', () => {
    const result = checklistResponseSchema.safeParse({
      tasks: [],
      ruleVersion: '2026-08-20.1',
      generatedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing ruleVersion', () => {
    const result = checklistResponseSchema.safeParse({
      tasks: [],
      generatedAt: '2026-08-20T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-datetime generatedAt', () => {
    const result = checklistResponseSchema.safeParse({
      tasks: [],
      ruleVersion: '2026-08-20.1',
      generatedAt: '2026-08-20',
    });
    expect(result.success).toBe(false);
  });
});

describe('chatRequestSchema (§11.3 scope)', () => {
  it('parses a minimal valid chat request', () => {
    expect(
      chatRequestSchema.safeParse({ municipalityCode: '13112', question: 'ごみの分別方法は？' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty question (boundary)', () => {
    expect(chatRequestSchema.safeParse({ municipalityCode: '13112', question: '' }).success).toBe(
      false,
    );
  });

  it('rejects a request without municipalityCode (scope isolation required)', () => {
    expect(chatRequestSchema.safeParse({ question: 'x' }).success).toBe(false);
  });
});

describe('chatResponseSchema (§11.4/§11.5)', () => {
  it('parses an abstained response with no citations (根拠が見つからない場合)', () => {
    const result = chatResponseSchema.safeParse({
      answer: '確認できません。窓口へお問い合わせください。',
      citations: [],
      confidence: 'unknown',
      abstained: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid confidence enum value', () => {
    const result = chatResponseSchema.safeParse({
      answer: 'x',
      citations: [],
      confidence: 'super-high',
      abstained: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('parses a valid error response', () => {
    const result = errorResponseSchema.safeParse({
      error: { code: 'municipality_not_supported', message: '対応していない自治体です。' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an error object missing code', () => {
    const result = errorResponseSchema.safeParse({ error: { message: 'x' } });
    expect(result.success).toBe(false);
  });
});

describe('wasteSortingSearchResponseSchema / wasteSortingSummaryResponseSchema', () => {
  it('parses a search response with items + total', () => {
    const result = wasteSortingSearchResponseSchema.safeParse({
      municipalityCode: '13112',
      query: 'アイロン',
      items: [
        {
          itemId: '131121S00002',
          municipalityCode: '13112',
          name: 'アイロン',
          category: '不燃ごみ',
          feeNote: '無料',
          sourceId: 'src-13112-waste_sorting-001',
        },
      ],
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 30 items (search cap)', () => {
    const item = {
      itemId: 'x',
      municipalityCode: '13112',
      name: 'x',
      category: '不燃ごみ',
      sourceId: 'src-13112-waste_sorting-001',
    };
    const result = wasteSortingSearchResponseSchema.safeParse({
      municipalityCode: '13112',
      query: 'x',
      items: Array.from({ length: 31 }, () => item),
      total: 31,
    });
    expect(result.success).toBe(false);
  });

  it('parses a category summary response', () => {
    const result = wasteSortingSummaryResponseSchema.safeParse({
      municipalityCode: '13112',
      categories: [
        { category: '不燃ごみ', count: 100 },
        { category: '可燃ごみ', count: 200 },
      ],
      total: 300,
    });
    expect(result.success).toBe(true);
  });
});
