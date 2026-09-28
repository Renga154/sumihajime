import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasSourceSnapshots } from '@tmn/test-fixtures/source-snapshots';
import { wasteAreaSchema, wasteScheduleSchema, weekdaySchema } from '@tmn/schemas';
import {
  buildOtaWaste,
  cellText,
  fillMerges,
  parseMetalSchedule,
  parseSingleWeekday,
  parseWeekdayList,
  type CellGrid,
  type Merge,
} from './waste-xlsx.js';
import { readOtaWasteSheet, type SheetData } from './waste-xlsx-read.js';

/**
 * なぜ: Step5-B。大田区(13111)収集曜日XLSX(結合セル・丁目/番地単位)の決定論パーサを
 * (a) 純関数(曜日/第N第M/結合セル展開)の合成fixtureで、(b) 実スナップショットXLSXの
 * 構造(87地区/435レコード/除外0/管轄3事務所)で、機械検証する。
 * 「曜日が確定できないセルは出力しない(推測禁止・CLAUDE.md原則3)」ことを除外fixtureで固定する。
 */

const OPTS = {
  municipalityCode: '13111',
  sourceId: 'src-13111-waste_schedule-001',
  effectiveFrom: '2025-04-01',
  effectiveTo: '2026-03-31',
} as const;

describe('waste-xlsx — 曜日パース(純関数)', () => {
  it('parseSingleWeekday: 大田表記「水曜」(曜のみ)と他区表記「水曜日」の両方を解釈', () => {
    expect(parseSingleWeekday('水曜')).toBe('wednesday');
    expect(parseSingleWeekday('水曜日')).toBe('wednesday');
    expect(parseSingleWeekday('月曜')).toBe('monday');
    expect(parseSingleWeekday('日曜')).toBe('sunday');
  });

  it('parseSingleWeekday: 非曜日(「*」「全域」空欄)は null(推測しない)', () => {
    expect(parseSingleWeekday('*')).toBeNull();
    expect(parseSingleWeekday('全域')).toBeNull();
    expect(parseSingleWeekday('')).toBeNull();
  });

  it('parseWeekdayList: 可燃ごみの「月曜(改行)木曜」を出現順に複数曜日へ、重複は排除', () => {
    expect(parseWeekdayList('月曜\r\n木曜')).toEqual(['monday', 'thursday']);
    expect(parseWeekdayList('火曜・金曜')).toEqual(['tuesday', 'friday']);
    expect(parseWeekdayList('月曜\n月曜')).toEqual(['monday']); // 重複排除
    expect(parseWeekdayList('*')).toEqual([]);
  });

  it('parseMetalSchedule: 不燃ごみ「第2第4(改行)金曜」→ weekOfMonth[2,4]+金曜', () => {
    expect(parseMetalSchedule('第2第4\r\n金曜')).toEqual({
      weekOfMonth: [2, 4],
      weekday: 'friday',
    });
    expect(parseMetalSchedule('第1第3\n火曜')).toEqual({ weekOfMonth: [1, 3], weekday: 'tuesday' });
    // 全角序数も許容。
    expect(parseMetalSchedule('第１第３ 水曜')).toEqual({
      weekOfMonth: [1, 3],
      weekday: 'wednesday',
    });
  });

  it('parseMetalSchedule: 序数のみ/曜日のみ/空欄は null(両方揃わなければ確定しない)', () => {
    expect(parseMetalSchedule('第2第4')).toBeNull(); // 曜日なし
    expect(parseMetalSchedule('金曜')).toBeNull(); // 序数なし
    expect(parseMetalSchedule('*')).toBeNull();
  });

  it('cellText: 改行を「／」に畳み、余分な空白を除去する', () => {
    expect(cellText('3丁目・5丁目\r\n6丁目\r\n8丁目')).toBe('3丁目・5丁目／6丁目／8丁目');
    expect(cellText('  池上 ')).toBe('池上');
  });
});

describe('waste-xlsx — fillMerges(結合セル展開・純関数)', () => {
  it('縦結合の開始セル値を範囲内へ複写し、入力は不変', () => {
    const grid: CellGrid = [
      ['A', 'B'],
      ['', 'x'],
      ['', 'y'],
    ];
    const merges: Merge[] = [{ s: { r: 0, c: 0 }, e: { r: 2, c: 0 } }];
    const filled = fillMerges(grid, merges);
    expect(filled.map((r) => r[0])).toEqual(['A', 'A', 'A']);
    expect(grid[1]?.[0]).toBe(''); // 入力不変
  });
});

/**
 * なぜ: 実XLSXの 池上ブロックを模した合成fixture。A(頭文字)/B(町丁目名)/D(プラ)/E(資源)/
 * F(可燃)/H(管轄)を2行縦結合し、G(不燃)のみ行ごとに異なる(=丁目・番地で第N週が入れ替わる)
 * 実構造を再現する。結合展開後、2行目が親の曜日を継承しつつ不燃だけ独自週になることを固定する。
 */
describe('waste-xlsx — buildOtaWaste(合成fixture: 結合展開の正しさ)', () => {
  const header = ['', '', '', 'プラ', '資源', '可燃ごみ', '不燃ごみ', '管轄'];
  const grid: CellGrid = [
    header,
    ['て', 'テスト町', '1丁目', '水曜', '土曜', '月曜\r\n木曜', '第2第4\r\n金曜', '大森'],
    ['', '', '2丁目', '', '', '', '第1第3\r\n金曜', ''],
  ];
  const merges: Merge[] = [
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 2, c: 4 } },
    { s: { r: 1, c: 5 }, e: { r: 2, c: 5 } },
    { s: { r: 1, c: 7 }, e: { r: 2, c: 7 } },
  ];

  it('2地区・10レコード・除外0。2行目はプラ/資源/可燃を継承し不燃のみ独自週', () => {
    const built = buildOtaWaste(grid, merges, OPTS);
    expect(built.wasteAreas.map((a) => a.areaLabel)).toEqual(['テスト町 1丁目', 'テスト町 2丁目']);
    expect(built.excluded).toEqual([]);
    expect(built.offices).toEqual(['大森']);

    const forArea = (areaId: string) => built.wasteSchedules.filter((s) => s.areaId === areaId);
    const a1 = forArea('area-13111-001');
    const a2 = forArea('area-13111-002');
    // 継承: 両地区ともプラ水/資源土/可燃月木。
    for (const a of [a1, a2]) {
      expect(a.find((s) => s.wasteType === 'プラスチック')?.weekday).toBe('wednesday');
      expect(a.find((s) => s.wasteType === '資源')?.weekday).toBe('saturday');
      expect(a.filter((s) => s.wasteType === '可燃ごみ').map((s) => s.weekday)).toEqual([
        'monday',
        'thursday',
      ]);
    }
    // 不燃のみ丁目で異なる(第2第4 vs 第1第3)。
    expect(a1.find((s) => s.wasteType === '不燃ごみ')?.weekOfMonth).toEqual([2, 4]);
    expect(a2.find((s) => s.wasteType === '不燃ごみ')?.weekOfMonth).toEqual([1, 3]);
    expect(built.wasteSchedules.length).toBe(10);
  });
});

describe('waste-xlsx — buildOtaWaste(除外: 推測禁止)', () => {
  it('曜日を確定できないセル(「*」/空欄)は Schedule を作らず excluded に理由付きで記録。地区は生成', () => {
    const grid: CellGrid = [
      ['', '', '', 'プラ', '資源', '可燃ごみ', '不燃ごみ', '管轄'],
      ['ん', '未定町', '全域', '*', '土曜', '月曜', '', '調布'],
    ];
    const built = buildOtaWaste(grid, [], OPTS);
    // 地区は生成される。
    expect(built.wasteAreas.map((a) => a.areaLabel)).toEqual(['未定町 全域']);
    // 確定できた資源・可燃のみ出力。
    expect(built.wasteSchedules.map((s) => `${s.wasteType}:${s.weekday}`).sort()).toEqual([
      '可燃ごみ:monday',
      '資源:saturday',
    ]);
    // プラ(「*」)と不燃(空欄)は除外(推測しない)。
    expect(built.excluded.map((e) => e.wasteType).sort()).toEqual(['プラスチック', '不燃ごみ']);
    for (const e of built.excluded) expect(e.reason).toContain('推測');
  });
});

// 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
// skip しても vitest は収集のため describe の本体を実行するので、読み込みは beforeAll で行う。
describe.skipIf(!hasSourceSnapshots())(
  'waste-xlsx — 実スナップショットXLSX(令和7年度 R07全域)',
  () => {
    const snapshotPath = fileURLToPath(
      new URL(
        '../../../data/sources/13111/snapshots/src-13111-waste_schedule-001.xlsx',
        import.meta.url,
      ),
    );
    let sheet: SheetData;
    let built: ReturnType<typeof buildOtaWaste>;
    beforeAll(() => {
      sheet = readOtaWasteSheet(snapshotPath);
      built = buildOtaWaste(sheet.grid, sheet.merges, OPTS);
    });

    it('シート名は「R07全域」(令和7年度)。結合セル118個・範囲A1:H88', () => {
      expect(sheet.sheetName).toBe('R07全域');
      expect(sheet.merges.length).toBe(118);
      expect(sheet.grid.length).toBe(88); // ヘッダ1 + データ87
    });

    it('87地区 / 435レコード / 除外0(全87行×プラ1+資源1+可燃2+不燃1)', () => {
      expect(built.wasteAreas.length).toBe(87);
      expect(built.wasteSchedules.length).toBe(435);
      expect(built.excluded.length).toBe(0);
      const byType: Record<string, number> = {};
      for (const s of built.wasteSchedules) byType[s.wasteType] = (byType[s.wasteType] ?? 0) + 1;
      expect(byType).toEqual({ プラスチック: 87, 資源: 87, 可燃ごみ: 174, 不燃ごみ: 87 });
    });

    it('管轄清掃事務所は大森/調布/蒲田の3事務所のみ(想定外の混入なし)', () => {
      expect(built.offices).toEqual(['大森', '蒲田', '調布']);
    });

    it('地区ラベルは一意。先頭は監査どおり「池上 1丁目・2丁目・4丁目」(プラ水/資源土/可燃月木/不燃第2第4金)', () => {
      const labels = built.wasteAreas.map((a) => a.areaLabel);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels[0]).toBe('池上 1丁目・2丁目・4丁目');
      const a1 = built.wasteSchedules.filter((s) => s.areaId === 'area-13111-001');
      expect(a1.find((s) => s.wasteType === 'プラスチック')?.weekday).toBe('wednesday');
      expect(a1.find((s) => s.wasteType === '資源')?.weekday).toBe('saturday');
      expect(a1.filter((s) => s.wasteType === '可燃ごみ').map((s) => s.weekday)).toEqual([
        'monday',
        'thursday',
      ]);
      const fu = a1.find((s) => s.wasteType === '不燃ごみ');
      expect(fu?.weekday).toBe('friday');
      expect(fu?.weekOfMonth).toEqual([2, 4]);
    });

    it('全レコードが共通スキーマ(WasteArea/WasteSchedule)でparse成功。不燃は全件weekOfMonth付き', () => {
      for (const a of built.wasteAreas) expect(() => wasteAreaSchema.parse(a)).not.toThrow();
      for (const s of built.wasteSchedules) {
        expect(() => wasteScheduleSchema.parse(s)).not.toThrow();
        expect(weekdaySchema.safeParse(s.weekday).success).toBe(true);
        expect(s.effectiveFrom).toBe('2025-04-01');
        expect(s.effectiveTo).toBe('2026-03-31'); // R07(令和7年度)の有効期間を正直に閉じる
      }
      const nonBurn = built.wasteSchedules.filter((s) => s.wasteType === '不燃ごみ');
      expect(nonBurn.every((s) => Array.isArray(s.weekOfMonth) && s.weekOfMonth.length === 2)).toBe(
        true,
      );
    });
  },
);
