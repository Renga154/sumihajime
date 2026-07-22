/**
 * なぜ: T-016 新宿区(13104)の収集曜日は、世田谷/江東の「1自治体1CSV」とは異なり
 * **HTML表**(city.shinjuku.lg.jp/seikatsu/file09_01_00001.html)で提供される。
 * 第3のデータ形式(HTML表)でも共通スキーマ(WasteArea/WasteSchedule)へ正規化できることを
 * 実証するための、依存を足さない正規表現ベースのHTML表パーサ。
 *
 * 対象ページの構造(2026-07-22 スナップショットで確認):
 *  - `<table class="greenTable2">` が9個(あ/か/さ/た/な/は/ま/や/わ行)。町名×収集日の本体表。
 *  - `<table class="callCenter">` が2個(問い合わせ窓口。データではないので対象外)。
 *  - 各本体表の列: [町名の頭文字, 集積所の住所(町名), 資源の回収日, 燃やすごみの収集日,
 *    金属・陶器・ガラスごみの収集日, 管轄, カレンダー(PDFリンク)]
 *  - 資源: 週1回・単一曜日(例「木曜日」)。
 *  - 燃やすごみ: 週2回・「曜日・曜日」(例「火曜日・金曜日」)。
 *  - 金属・陶器・ガラスごみ: 月2回・「1・3番目の各曜日」または「2・4番目の各曜日」
 *    (公式注記「月の5番目の曜日に収集はありません」)→ weekOfMonth を [1,3] または [2,4] で保持。
 *  - 回収日/収集日欄が「*」の地域(歌舞伎町等の商業地区)は公式が
 *    「管轄の清掃事務所へ問い合わせ」としており日程を公表していない → 曜日を捏造せず
 *    当該セルのScheduleは生成しない(推測禁止・CLAUDE.md原則3)。
 */

import type { Weekday, WasteArea, WasteSchedule } from '@tmn/schemas';

/** 「月〜日曜日」→ Weekday。未知文字列は null(呼び出し側でスキップ)。 */
const WEEKDAY_BY_JP: Record<string, Weekday> = {
  月: 'monday',
  火: 'tuesday',
  水: 'wednesday',
  木: 'thursday',
  金: 'friday',
  土: 'saturday',
  日: 'sunday',
};

export function parseWeekday(jp: string): Weekday | null {
  const m = jp.match(/([月火水木金土日])曜日/);
  const key = m?.[1];
  if (key === undefined) return null;
  return WEEKDAY_BY_JP[key] ?? null;
}

/** 「火曜日・金曜日」→ [tuesday, friday]。「*」等の非曜日は空配列。 */
export function parseWeekdayList(cell: string): Weekday[] {
  return cell
    .split(/[・、,]/)
    .map((part) => parseWeekday(part.trim()))
    .filter((w): w is Weekday => w !== null);
}

export interface WeekOfMonthWeekday {
  weekOfMonth: number[];
  weekday: Weekday;
}

/**
 * 「2・4番目の土曜日」→ { weekOfMonth: [2,4], weekday: saturday }。
 * 「1・3番目の水曜日」→ { weekOfMonth: [1,3], weekday: wednesday }。
 * パターン外(「*」等)は null。
 */
export function parseWeekOfMonthWeekday(cell: string): WeekOfMonthWeekday | null {
  const weekday = parseWeekday(cell);
  if (weekday === null) return null;
  // 「2・4番目」「1・3番目」のように、番目の直前に「N・M」形式で複数の序数が並ぶ。
  // 「…番目」の直前に連なる序数列(・区切り)をまとめて取り出す。
  const ordinalGroup = cell.match(/([1-5１-５](?:[・･、,][1-5１-５])*)\s*番目/);
  const ordinals = ordinalGroup?.[1];
  if (ordinals === undefined) return null;
  const nums = [...ordinals.matchAll(/[1-5１-５]/g)].map((m) => {
    const code = m[0].charCodeAt(0);
    // 全角数字も許容(表記ゆれ耐性)。
    return code >= 0xff10 && code <= 0xff19 ? code - 0xff10 : Number(m[0]);
  });
  const weekOfMonth = [...new Set(nums)].filter((n) => n >= 1 && n <= 5).sort((a, b) => a - b);
  if (weekOfMonth.length === 0) return null;
  return { weekOfMonth, weekday };
}

/** セルの中身からタグ・改行・空白・実体参照を落として素のテキストにする。 */
function cellText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')
    .trim();
}

export interface GreenTableRow {
  /** 集積所の住所(=町名。areaLabelに使う)。 */
  town: string;
  /** 資源の回収日(原文セル)。 */
  recyclable: string;
  /** 燃やすごみの収集日(原文セル)。 */
  burnable: string;
  /** 金属・陶器・ガラスごみの収集日(原文セル)。 */
  metalGlass: string;
  /** 管轄略号(新/東/歌)。 */
  district: string;
}

/**
 * `<table class="greenTable2">` の本体行だけを抽出する(thead・callCenter表・問い合わせ表は除外)。
 * ヘッダ行(「町名の頭文字」「集積所の住所」を含む)はスキップする。
 */
export function extractGreenTableRows(html: string): GreenTableRow[] {
  const rows: GreenTableRow[] = [];
  const tableRe = /<table class="greenTable2"[^>]*>([\s\S]*?)<\/table>/g;
  let t: RegExpExecArray | null;
  while ((t = tableRe.exec(html)) !== null) {
    const tableBody = t[1] ?? '';
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(tableBody)) !== null) {
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
      const cells: string[] = [];
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(r[1] ?? '')) !== null) cells.push(cellText(c[1] ?? ''));
      const [initial, town, recyclable, burnable, metalGlass, district] = cells;
      // 列不足(6列未満)の行は無視。noUncheckedIndexedAccess下でも各セルの存在を型で保証する。
      if (
        initial === undefined ||
        town === undefined ||
        recyclable === undefined ||
        burnable === undefined ||
        metalGlass === undefined ||
        district === undefined
      ) {
        continue;
      }
      if (initial === '町名の頭文字' || town === '集積所の住所') continue; // thead。
      rows.push({ town, recyclable, burnable, metalGlass, district });
    }
  }
  return rows;
}

export type WasteType = '資源' | '燃やすごみ' | '金属・陶器・ガラスごみ';

export interface BuildWasteOptions {
  municipalityCode: string;
  sourceId: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface BuiltWaste {
  wasteAreas: WasteArea[];
  wasteSchedules: WasteSchedule[];
  /** 回収日/収集日欄が「*」で日程未公表の地区(=清掃事務所へ要問い合わせ)。 */
  starDistricts: string[];
}

/**
 * 新宿区の収集曜日HTML表 → 共通スキーマ(WasteArea/WasteSchedule)。
 * 「*」セルは日程未公表(公式が問い合わせ扱い)のためScheduleを生成しない(捏造禁止)。
 * areaId は表出現順(あ→わ)で決定論的に採番する。
 */
export function buildShinjukuWaste(html: string, opts: BuildWasteOptions): BuiltWaste {
  const src = extractGreenTableRows(html);
  const wasteAreas: WasteArea[] = [];
  const wasteSchedules: WasteSchedule[] = [];
  const starDistricts: string[] = [];

  src.forEach((row, i) => {
    const areaId = `area-${opts.municipalityCode}-${String(i + 1).padStart(3, '0')}`;
    wasteAreas.push({ areaId, municipalityCode: opts.municipalityCode, areaLabel: row.town });

    const base = {
      areaId,
      sourceId: opts.sourceId,
      effectiveFrom: opts.effectiveFrom,
      ...(opts.effectiveTo ? { effectiveTo: opts.effectiveTo } : {}),
    };

    let hadStar = false;

    // 資源: 週1回・単一曜日。
    const recyc = parseWeekday(row.recyclable);
    if (recyc) {
      wasteSchedules.push({ ...base, wasteType: '資源', weekday: recyc });
    } else if (row.recyclable === '*') hadStar = true;

    // 燃やすごみ: 週2回・複数曜日。
    const burn = parseWeekdayList(row.burnable);
    if (burn.length > 0) {
      for (const w of burn) wasteSchedules.push({ ...base, wasteType: '燃やすごみ', weekday: w });
    } else if (row.burnable === '*') hadStar = true;

    // 金属・陶器・ガラスごみ: 月2回・weekOfMonth付き。
    const metal = parseWeekOfMonthWeekday(row.metalGlass);
    if (metal) {
      wasteSchedules.push({
        ...base,
        wasteType: '金属・陶器・ガラスごみ',
        weekday: metal.weekday,
        weekOfMonth: metal.weekOfMonth,
      });
    } else if (row.metalGlass === '*') hadStar = true;

    if (hadStar) starDistricts.push(row.town);
  });

  return { wasteAreas, wasteSchedules, starDistricts };
}
