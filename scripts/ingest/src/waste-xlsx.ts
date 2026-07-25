/**
 * なぜ: Step5-B 大田区(13111)の収集曜日は、世田谷/江東の「1行1町名CSV」や新宿の「HTML表」とも
 * 異なり、**結合セルを多用したXLSX**(opendata.metro `131113_shigengomiyoubi.xlsx`)でのみ
 * 配信される。第4のデータ形式(XLSX)を共通スキーマ(WasteArea/WasteSchedule)へ決定論的に
 * 正規化するための、SheetJS(`xlsx`)を用いた読み取り + 依存のない純関数パーサ。
 *
 * 対象シートの構造(2026-07-25 スナップショットで確認, シート名「R07全域」=令和7年度):
 *  - 範囲 A1:H88(ヘッダ1行 + データ87行)、結合セル118個。
 *  - 列: [A=町丁目名の頭文字(あ行等), B=町丁目名, C=丁目・番地区分, D=プラ, E=資源,
 *    F=可燃ごみ, G=不燃ごみ, H=管轄の清掃事務所]。
 *  - A/B/H は縦方向の結合セルで、同一グループの2行目以降は空欄(結合開始セルの値を継承)。
 *  - C(丁目・番地区分)は結合されず1行1区分(=正規化の最小地区単位)。
 *  - D プラ / E 資源: 週1回・単一曜日(例「水曜」)。※大田は「曜日」ではなく「曜」表記。
 *  - F 可燃ごみ: 週2回・改行区切りの複数曜日(例「月曜\n木曜」)。
 *  - G 不燃ごみ: 月2回・「第N第M(改行)曜日」(例「第2第4\n金曜」)→ weekOfMonth [N,M] + 曜日。
 *    大田は第何週かを明示するため、江東の「(隔週)・週不明」とは異なり weekOfMonth を確定できる。
 *
 * 設計方針(テスト容易性・決定論):
 *  - `fillMerges` / `parseSingleWeekday` / `parseWeekdayList` / `parseMetalSchedule` /
 *    `buildOtaWaste` は **SheetJSに一切依存しない純関数**とし、合成fixture(結合パターン)で
 *    単体テストする。SheetJS依存は `readOtaWasteSheet`(ファイル→grid+merges)のみに閉じ込める。
 *  - **曜日が確定できないセルは出力しない**(推測禁止・CLAUDE.md原則3)。該当セルは Schedule を
 *    生成せず `excluded`(理由付き)へ記録する。地区(WasteArea)自体は生成する。
 */

import type { Weekday, WasteArea, WasteSchedule } from '@tmn/schemas';

/** 「月〜日」→ Weekday。大田は「水曜」(曜のみ)、他区の「水曜日」(曜日)の両表記に耐える。 */
const WEEKDAY_BY_JP: Record<string, Weekday> = {
  月: 'monday',
  火: 'tuesday',
  水: 'wednesday',
  木: 'thursday',
  金: 'friday',
  土: 'saturday',
  日: 'sunday',
};

const WEEKDAY_RE = /([月火水木金土日])曜/g;

/** 単一曜日を取り出す(最初の「X曜」)。無ければ null(呼び出し側でスキップ)。 */
export function parseSingleWeekday(cell: string): Weekday | null {
  const m = cell.match(/([月火水木金土日])曜/);
  const key = m?.[1];
  if (key === undefined) return null;
  return WEEKDAY_BY_JP[key] ?? null;
}

/**
 * 複数曜日を出現順に取り出す(可燃ごみの「月曜\n木曜」等)。改行・中黒・読点いずれの区切りにも
 * 依存せず「X曜」を全走査するため、結合セル内の改行表記に頑健。重複は除去する。
 */
export function parseWeekdayList(cell: string): Weekday[] {
  const out: Weekday[] = [];
  for (const m of cell.matchAll(WEEKDAY_RE)) {
    const key = m[1];
    const wd = key === undefined ? undefined : WEEKDAY_BY_JP[key];
    if (wd !== undefined && !out.includes(wd)) out.push(wd);
  }
  return out;
}

export interface MetalSchedule {
  /** 第N第M週(昇順・重複排除・1〜5のみ)。 */
  weekOfMonth: number[];
  weekday: Weekday;
}

/**
 * 不燃ごみの「第2第4(改行)金曜」→ { weekOfMonth: [2,4], weekday: friday }。
 * 「第N」の序数(半角/全角)と「X曜」の曜日の**両方**が揃ったときのみ確定。
 * どちらか欠ければ null(推測しない)。
 */
export function parseMetalSchedule(cell: string): MetalSchedule | null {
  const weekday = parseSingleWeekday(cell);
  if (weekday === null) return null;
  const nums: number[] = [];
  for (const m of cell.matchAll(/第\s*([1-5１-５])/g)) {
    const ch = m[1];
    if (ch === undefined) continue;
    const code = ch.charCodeAt(0);
    // 全角数字(０xff10-ff19)も許容(表記ゆれ耐性)。
    nums.push(code >= 0xff10 && code <= 0xff19 ? code - 0xff10 : Number(ch));
  }
  const weekOfMonth = [...new Set(nums)].filter((n) => n >= 1 && n <= 5).sort((a, b) => a - b);
  if (weekOfMonth.length === 0) return null;
  return { weekOfMonth, weekday };
}

export type CellGrid = string[][];

/** SheetJS `!merges` と同形の結合セル範囲(0始まり行列)。 */
export interface Merge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** セルの改行・空白・実体参照を落として素のテキストにする(A/B/H の表示名やC区分の整形用)。 */
export function cellText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\s*\n\s*/g, '／')
    .trim();
}

/**
 * 結合セルを展開する: 各結合範囲について、左上(開始)セルの値を範囲内の全セルへ複写した
 * **新しいグリッド**を返す(入力は不変)。これにより A/B/H の縦結合で空欄になった2行目以降にも
 * 親の値(頭文字・町丁目名・清掃事務所)が復元され、各データ行を単独で解釈できる。
 */
export function fillMerges(grid: CellGrid, merges: Merge[]): CellGrid {
  const filled: CellGrid = grid.map((row) => [...row]);
  for (const m of merges) {
    const src = filled[m.s.r]?.[m.s.c] ?? '';
    for (let r = m.s.r; r <= m.e.r; r++) {
      const row = filled[r];
      if (row === undefined) continue;
      for (let c = m.s.c; c <= m.e.c; c++) {
        row[c] = src;
      }
    }
  }
  return filled;
}

/** 大田XLSXの列インデックス(0始まり)。 */
export const OTA_COL = {
  initial: 0,
  town: 1,
  division: 2,
  plastic: 3,
  resource: 4,
  burnable: 5,
  nonburnable: 6,
  office: 7,
} as const;

/** 管轄清掃事務所の想定値(検証用。想定外はテストで検知)。 */
export const OTA_OFFICES = ['大森', '調布', '蒲田'] as const;

export interface BuildOptions {
  municipalityCode: string;
  sourceId: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

/** 曜日を確定できず出力しなかったセル(理由付き)。推測禁止の証跡。 */
export interface ExcludedCell {
  areaLabel: string;
  wasteType: string;
  rawCell: string;
  reason: string;
}

export interface BuiltWaste {
  wasteAreas: WasteArea[];
  wasteSchedules: WasteSchedule[];
  /** 曜日未確定で除外したセル(推測しない)。実データでは 0 件。 */
  excluded: ExcludedCell[];
  /** 出現した管轄清掃事務所の集合(検証用)。 */
  offices: string[];
}

const HEADER_TOKENS = new Set(['町丁目名', '集積所の住所', '丁目・番地']);
const EXCLUDE_REASON = '出典セルから曜日を一意に特定できないため出力しない(推測禁止)';

/**
 * 大田区の収集曜日グリッド(結合セル未展開)+ 結合範囲 → 共通スキーマ(WasteArea/WasteSchedule)。
 * areaId は表出現順(あ→わ)で決定論的に採番。曜日未確定セルは Schedule を作らず excluded に記録する。
 */
export function buildOtaWaste(rawGrid: CellGrid, merges: Merge[], opts: BuildOptions): BuiltWaste {
  const grid = fillMerges(rawGrid, merges);
  const wasteAreas: WasteArea[] = [];
  const wasteSchedules: WasteSchedule[] = [];
  const excluded: ExcludedCell[] = [];
  const officeSet = new Set<string>();

  let areaSeq = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row === undefined) continue;
    const division = cellText(row[OTA_COL.division] ?? '');
    // データ行はC(丁目・番地区分)が非空。空行・ヘッダ行はスキップ。
    if (division === '' || HEADER_TOKENS.has(division)) continue;

    const town = cellText(row[OTA_COL.town] ?? '');
    const office = cellText(row[OTA_COL.office] ?? '');
    if (office !== '') officeSet.add(office);

    areaSeq += 1;
    const areaId = `area-${opts.municipalityCode}-${String(areaSeq).padStart(3, '0')}`;
    const areaLabel = town === '' ? division : `${town} ${division}`;
    wasteAreas.push({ areaId, municipalityCode: opts.municipalityCode, areaLabel });

    const base = {
      areaId,
      sourceId: opts.sourceId,
      effectiveFrom: opts.effectiveFrom,
      ...(opts.effectiveTo ? { effectiveTo: opts.effectiveTo } : {}),
    };

    const record = (wasteType: string, rawCell: string): void => {
      excluded.push({ areaLabel, wasteType, rawCell: cellText(rawCell), reason: EXCLUDE_REASON });
    };

    // プラスチック(週1・単一曜日)。
    const plaRaw = row[OTA_COL.plastic] ?? '';
    const pla = parseSingleWeekday(plaRaw);
    if (pla) wasteSchedules.push({ ...base, wasteType: 'プラスチック', weekday: pla });
    else record('プラスチック', plaRaw);

    // 資源(週1・単一曜日)。
    const shiRaw = row[OTA_COL.resource] ?? '';
    const shi = parseSingleWeekday(shiRaw);
    if (shi) wasteSchedules.push({ ...base, wasteType: '資源', weekday: shi });
    else record('資源', shiRaw);

    // 可燃ごみ(週2・複数曜日)。
    const kaRaw = row[OTA_COL.burnable] ?? '';
    const ka = parseWeekdayList(kaRaw);
    if (ka.length > 0)
      for (const w of ka) wasteSchedules.push({ ...base, wasteType: '可燃ごみ', weekday: w });
    else record('可燃ごみ', kaRaw);

    // 不燃ごみ(月2・weekOfMonth付き)。
    const fuRaw = row[OTA_COL.nonburnable] ?? '';
    const fu = parseMetalSchedule(fuRaw);
    if (fu)
      wasteSchedules.push({
        ...base,
        wasteType: '不燃ごみ',
        weekday: fu.weekday,
        weekOfMonth: fu.weekOfMonth,
      });
    else record('不燃ごみ', fuRaw);
  }

  return { wasteAreas, wasteSchedules, excluded, offices: [...officeSet].sort() };
}
