import { describe, expect, it } from 'vitest';
import {
  OPENDATA_GAPS_SOURCE_DOC,
  OPENDATA_GAP_CASES,
  opendataGapCasesSchema,
} from './opendata-gaps';

/**
 * なぜ: オープンデータ品質レポートの表示データは出典(md)の要約であり、スキーマ検証で
 * 必須項目の欠落・表記ゆれ・自治体コード形式を機械的に固定する(原則2・原則10)。
 */
describe('opendata-gaps content', () => {
  it('全事例がスキーマに適合する', () => {
    expect(opendataGapCasesSchema.safeParse(OPENDATA_GAP_CASES).success).toBe(true);
  });

  it('md に記録された2事例(新宿の施設欠落・世田谷の列スワップ)を含む', () => {
    const ids = OPENDATA_GAP_CASES.map((c) => c.id);
    expect(ids).toContain('shinjuku-facility-missing');
    expect(ids).toContain('setagaya-waste-columns');
  });

  it('各事例は自治体コード(5桁)・確認日(YYYY-MM-DD)・建設的な対処を持つ', () => {
    for (const c of OPENDATA_GAP_CASES) {
      expect(c.municipalityCode).toMatch(/^\d{5}$/);
      expect(c.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.contribution.length).toBeGreaterThan(0);
      expect(c.takeaway.length).toBeGreaterThan(0);
    }
  });

  it('出典 doc パスを明記している', () => {
    expect(OPENDATA_GAPS_SOURCE_DOC).toBe('docs/research/opendata-gaps.md');
  });
});
