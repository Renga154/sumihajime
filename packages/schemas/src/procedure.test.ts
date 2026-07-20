import { describe, expect, it } from 'vitest';
import { procedureVersionSchema } from './procedure.js';

const validProcedureVersion = {
  id: 'procedure_resident_registration',
  version: '2026-08-20.1',
  municipalityCode: '13112',
  canonicalType: 'resident_registration',
  title: '転入届を提出する',
  shortDescription: '転入日から14日以内に住民登録窓口へ転入届を提出します。',
  applicabilityReason: '東京都外からこの自治体へ転入するため',
  priority: 'urgent' as const,
  dueDate: '2026-08-29',
  requiredDocuments: [{ label: '本人確認書類', status: 'required' as const }],
  channels: ['counter' as const],
  sourceIds: ['source_setagaya_juuminidou'],
  lastVerifiedAt: '2026-08-20T00:00:00Z',
  dataStatus: 'verified' as const,
};

describe('procedureVersionSchema (§10)', () => {
  it('parses a valid procedure version (normal case)', () => {
    expect(procedureVersionSchema.safeParse(validProcedureVersion).success).toBe(true);
  });

  it('accepts requiredDocuments with an unknown status (未知なら未知と明示)', () => {
    const result = procedureVersionSchema.safeParse({
      ...validProcedureVersion,
      requiredDocuments: [{ label: '追加書類（要確認）', status: 'unknown' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourceIds array (boundary)', () => {
    expect(
      procedureVersionSchema.safeParse({ ...validProcedureVersion, sourceIds: [] }).success,
    ).toBe(false);
  });

  it('rejects an invalid channels enum value', () => {
    expect(
      procedureVersionSchema.safeParse({ ...validProcedureVersion, channels: ['fax'] }).success,
    ).toBe(false);
  });

  it('rejects missing required field requiredDocuments', () => {
    const { requiredDocuments: _requiredDocuments, ...rest } = validProcedureVersion;
    expect(procedureVersionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid dataStatus enum value', () => {
    expect(
      procedureVersionSchema.safeParse({ ...validProcedureVersion, dataStatus: 'unknown' }).success,
    ).toBe(false);
  });
});
