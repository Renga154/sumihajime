import { z } from 'zod';
import { municipalityCodeSchema } from './municipality.js';

/**
 * なぜ: REQUIREMENTS §13.1 Facility/WasteArea/WasteSchedule + 計画§8.1
 * facilities / waste_areas / waste_schedules テーブル。ADR-005により地図はP1・
 * 距離計算はしない(FR-013)ため、座標は任意、一覧表示に必要な情報のみ必須とする。
 */

/**
 * なぜ: 計画§8.1 facilities(facility_id, municipality_code, name, category,
 * address, lat/lng nullable, hours, source_id)。lat/lngはnullable(未整備の
 * 施設もある)。
 */
export const facilitySchema = z.strictObject({
  facilityId: z.string().min(1),
  municipalityCode: municipalityCodeSchema,
  name: z.string().min(1),
  category: z.string().min(1),
  address: z.string().min(1),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  hours: z.string().optional(),
  sourceId: z.string().min(1),
});
export type Facility = z.infer<typeof facilitySchema>;

/** なぜ: 計画§8.1 waste_areas/waste_schedules の weekday 列。 */
export const weekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
export type Weekday = z.infer<typeof weekdaySchema>;

/**
 * なぜ: 計画§8.1 waste_areas(area_id, municipality_code, area_label)。
 * ごみ収集地区は町丁目選択式(ADR-005)のため、area_labelで利用者向け表示名を保持する。
 */
export const wasteAreaSchema = z.strictObject({
  areaId: z.string().min(1),
  municipalityCode: municipalityCodeSchema,
  areaLabel: z.string().min(1),
});
export type WasteArea = z.infer<typeof wasteAreaSchema>;

/**
 * なぜ: 計画§8.1 waste_schedules(area_id, waste_type, weekday, week_of_month,
 * source_id, effective_from/to)。C-9: 通年の曜日パターンのみを扱い、祝日・年末年始
 * 等の例外日展開はしない(誤案内防止)ため、effectiveFrom/Toで有効期間を必須管理する。
 */
export const wasteScheduleSchema = z.strictObject({
  areaId: z.string().min(1),
  wasteType: z.string().min(1),
  weekday: weekdaySchema,
  weekOfMonth: z.array(z.int().min(1).max(5)).optional(),
  sourceId: z.string().min(1),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
});
export type WasteSchedule = z.infer<typeof wasteScheduleSchema>;

/**
 * なぜ: Wave1-B(ごみ分別辞書)。世田谷/江東/新宿の「ごみ分別方法」CSV
 * (自治体標準オープンデータセット準拠: 品目/分別区分/注意点/料金種別/料金/料金備考/備考)を
 * 正規化した品目単位のレコード。CLAUDE.md原則3(推測禁止)によりCSVの記載内容のみを保持し、
 * 読み仮名(reading)・注意/料金の付帯情報(notes/feeNote)は出典CSVに値がある場合のみ設定する
 * (3区とも「料金」「料金備考」「注意点」列は全行空欄のため、feeNoteは「料金種別」
 * (無料/有料)、notesは実データを持つ「備考」列を採用する。scripts/ingest/src/waste-sorting.ts
 * 参照)。itemId は出典CSVのID列をそのまま採用し、(municipalityCode, itemId) で一意。
 */
export const wasteSortingItemSchema = z.strictObject({
  itemId: z.string().min(1),
  municipalityCode: municipalityCodeSchema,
  name: z.string().min(1),
  reading: z.string().optional(),
  category: z.string().min(1),
  notes: z.string().optional(),
  feeNote: z.string().optional(),
  sourceId: z.string().min(1),
});
export type WasteSortingItem = z.infer<typeof wasteSortingItemSchema>;
