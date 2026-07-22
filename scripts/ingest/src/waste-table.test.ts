import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wasteAreaSchema, wasteScheduleSchema } from '@tmn/schemas';
import {
  parseWeekday,
  parseWeekdayList,
  parseWeekOfMonthWeekday,
  extractGreenTableRows,
  buildShinjukuWaste,
} from './waste-table.js';

/**
 * なぜ: T-016 第3のデータ形式=HTML表パースの機械検証。
 * (a) 曜日・週指定パーサの正例/境界(2・4番目→[2,4]等)
 * (b) 実スナップショット(令和8年度版)から greenTable2 表9個を抽出し
 *     共通スキーマ(WasteArea/WasteSchedule)へ正規化できること
 * (c) 「*」商業地区は日程未公表のためScheduleを生成しない(捏造禁止)ことの回帰ガード
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const html = readFileSync(
  resolve(repoRoot, 'data/sources/13104/snapshots/src-13104-waste_schedule-001.html'),
  'utf-8',
);

const OPTS = {
  municipalityCode: '13104',
  sourceId: 'src-13104-waste_schedule-001',
  effectiveFrom: '2026-04-01',
  effectiveTo: '2027-03-31',
} as const;

describe('waste-table — 曜日/週指定パーサ', () => {
  it('parseWeekday: 各曜日を Weekday enum へ、非曜日は null', () => {
    expect(parseWeekday('木曜日')).toBe('thursday');
    expect(parseWeekday('月曜日')).toBe('monday');
    expect(parseWeekday('日曜日')).toBe('sunday');
    expect(parseWeekday('*')).toBeNull();
    expect(parseWeekday('')).toBeNull();
  });

  it('parseWeekdayList: 「火曜日・金曜日」→ [tuesday, friday]、非曜日は空配列', () => {
    expect(parseWeekdayList('火曜日・金曜日')).toEqual(['tuesday', 'friday']);
    expect(parseWeekdayList('月曜日・木曜日')).toEqual(['monday', 'thursday']);
    expect(parseWeekdayList('*')).toEqual([]);
  });

  it('parseWeekOfMonthWeekday: 「2・4番目の土曜日」→ {[2,4], saturday}、番目の直前の序数を取りこぼさない', () => {
    expect(parseWeekOfMonthWeekday('2・4番目の土曜日')).toEqual({
      weekOfMonth: [2, 4],
      weekday: 'saturday',
    });
    expect(parseWeekOfMonthWeekday('1・3番目の水曜日')).toEqual({
      weekOfMonth: [1, 3],
      weekday: 'wednesday',
    });
    // 「*」や序数なしは null(捏造しない)。
    expect(parseWeekOfMonthWeekday('*')).toBeNull();
    expect(parseWeekOfMonthWeekday('水曜日')).toBeNull();
  });
});

describe('waste-table — 実スナップショット(令和8年度版)からの正規化', () => {
  it('greenTable2 表9個から171データ行を抽出(callCenter表・thead行は除外)', () => {
    const rows = extractGreenTableRows(html);
    expect(rows.length).toBe(171);
    // 先頭行は「あ行」の愛住町。
    expect(rows[0]?.town).toBe('愛住町');
    expect(rows[0]?.recyclable).toBe('木曜日');
    expect(rows[0]?.burnable).toBe('火曜日・金曜日');
    expect(rows[0]?.metalGlass).toBe('2・4番目の土曜日');
  });

  it('buildShinjukuWaste: 171地区 / 665収集レコード / 「*」商業地区5件', () => {
    const { wasteAreas, wasteSchedules, starDistricts } = buildShinjukuWaste(html, OPTS);
    expect(wasteAreas.length).toBe(171);
    // 資源167(週1) + 燃やす332(週2×166) + 金属166(月2×166) = 665。
    expect(wasteSchedules.length).toBe(665);
    expect(starDistricts).toEqual([
      '歌舞伎町1・2丁目',
      '新宿3丁目',
      '新宿4丁目',
      '新宿5丁目（17番、18番）',
      '西新宿1丁目',
    ]);

    // 全レコードが @tmn/schemas でparseできる(共通スキーマ適合の実証)。
    for (const a of wasteAreas) expect(() => wasteAreaSchema.parse(a)).not.toThrow();
    for (const s of wasteSchedules) expect(() => wasteScheduleSchema.parse(s)).not.toThrow();

    // 有効期間は令和8年度(effectiveTo を明示できる=江東CSVとの差)。
    for (const s of wasteSchedules) {
      expect(s.effectiveFrom).toBe('2026-04-01');
      expect(s.effectiveTo).toBe('2027-03-31');
      expect(s.sourceId).toBe('src-13104-waste_schedule-001');
    }
  });

  it('愛住町(area-001)の4レコード: 資源=木 / 燃やす=火・金 / 金属=土[2,4]', () => {
    const { wasteAreas, wasteSchedules } = buildShinjukuWaste(html, OPTS);
    expect(wasteAreas[0]).toEqual({
      areaId: 'area-13104-001',
      municipalityCode: '13104',
      areaLabel: '愛住町',
    });
    const s = wasteSchedules.filter((x) => x.areaId === 'area-13104-001');
    expect(s).toEqual([
      {
        areaId: 'area-13104-001',
        sourceId: 'src-13104-waste_schedule-001',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
        wasteType: '資源',
        weekday: 'thursday',
      },
      {
        areaId: 'area-13104-001',
        sourceId: 'src-13104-waste_schedule-001',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
        wasteType: '燃やすごみ',
        weekday: 'tuesday',
      },
      {
        areaId: 'area-13104-001',
        sourceId: 'src-13104-waste_schedule-001',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
        wasteType: '燃やすごみ',
        weekday: 'friday',
      },
      {
        areaId: 'area-13104-001',
        sourceId: 'src-13104-waste_schedule-001',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
        wasteType: '金属・陶器・ガラスごみ',
        weekday: 'saturday',
        weekOfMonth: [2, 4],
      },
    ]);
  });

  it('「*」地区(歌舞伎町1・2丁目)はScheduleを生成しない(捏造禁止)が、地区自体は選択肢として残す', () => {
    const { wasteAreas, wasteSchedules } = buildShinjukuWaste(html, OPTS);
    const kabuki = wasteAreas.find((a) => a.areaLabel === '歌舞伎町1・2丁目');
    expect(kabuki).toBeDefined();
    const schedules = wasteSchedules.filter((s) => s.areaId === kabuki?.areaId);
    expect(schedules).toEqual([]);
    // 部分「*」の新宿4丁目は資源(金曜)のみ生成し、燃やす/金属は生成しない。
    const shinjuku4 = wasteAreas.find((a) => a.areaLabel === '新宿4丁目');
    const s4 = wasteSchedules.filter((s) => s.areaId === shinjuku4?.areaId);
    expect(s4).toHaveLength(1);
    expect(s4[0]?.wasteType).toBe('資源');
    expect(s4[0]?.weekday).toBe('friday');
  });

  it('金属・陶器・ガラスごみは weekOfMonth [1,3] または [2,4] のみ(第5週なし)', () => {
    const { wasteSchedules } = buildShinjukuWaste(html, OPTS);
    const metal = wasteSchedules.filter((s) => s.wasteType === '金属・陶器・ガラスごみ');
    expect(metal.length).toBe(166);
    for (const s of metal) {
      expect(s.weekOfMonth).toBeDefined();
      const key = s.weekOfMonth?.join(',');
      expect(key === '1,3' || key === '2,4').toBe(true);
    }
    // 決定論: 同じ入力で同じ出力。
    const again = buildShinjukuWaste(html, OPTS);
    expect(again.wasteSchedules).toEqual(wasteSchedules);
  });
});
