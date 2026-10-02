/**
 * なぜ: `waste-xlsx.ts` の純関数を SheetJS(`xlsx`)へ結合させないため、XLSXファイル読み取りだけを
 * 分離した薄いアダプタ。ここだけが `xlsx` に依存する。純関数側は grid + merges を受け取るため、
 * SheetJSを使わない合成fixtureで決定論的に単体テストできる(依存の局所化)。
 *
 * `xlsx` は `scripts/ingest` の devDependency。本モジュールは ingest の公開エントリ(index.ts)から
 * export しない(他パッケージが実行時に `xlsx` を要求しないようにするため)。
 *
 * 既知の脆弱性と残余リスクの受容(2026-10-02):
 *   xlsx@0.18.5 には CVE-2023-30533(細工したファイルの読み込みでプロトタイプ汚染。0.19.3 で修正)と
 *   CVE-2024-22363(細工したファイルで ReDoS。0.20.2 で修正)がある。修正版は npm レジストリでは
 *   配布されず(SheetJS 自身の CDN からのみ)、入手経路の変更はサプライチェーン上の判断なので人に残す。
 *   それまでの緩和策として、
 *   (1) 台帳の content_hash と一致したファイル(人が承認した公式原文のスナップショット)しか
 *       パーサへ渡さない(攻撃の前提「細工したファイルを読ませる」を、承認済みのバイト列に限る)。
 *   (2) 読む行数を sheetRows で、列数・結合セルを明示の上限で縛り、超えたら切り詰めずに拒否する
 *       (反復と結合展開の量を有限にする)。
 *   (3) Worker(本番)では使わない。scripts のローカル実行と単体テストだけで使う。
 *   よって残るのは「承認済み原文そのものが細工されていた」場合だけで、これは受け入れる。
 */

import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { verifySnapshotBytes } from '@tmn/publish';
import type { CellGrid, Merge } from './waste-xlsx.js';

/**
 * 読む行数・列数の上限。大田区の収集曜日表は 88行×8列(A1:H88)。行は年度ごとの地区の増減を
 * 見込んで十分大きく、列は表の形が変わらない前提で小さく取る。超えたら黙って切り詰めずに拒否する
 * (欠けた表から曜日を作ると推測になる。CLAUDE.md原則3)。
 */
export const MAX_SHEET_ROWS = 2000;
export const MAX_SHEET_COLS = 64;
const MAX_MERGES = 10_000;

export interface SheetData {
  sheetName: string;
  grid: CellGrid;
  merges: Merge[];
}

/**
 * XLSXの先頭シートを「文字列グリッド + 結合範囲」へ。SheetJSのセル値は文字列化する。
 * 読む前にファイルのバイト列を台帳の content_hash と照合する(食い違えば SnapshotIntegrityError)。
 */
export function readOtaWasteSheet(
  filePath: string,
  expected: { sourceId: string; contentHash: string },
): SheetData {
  const bytes = readFileSync(filePath);
  verifySnapshotBytes(expected.sourceId, new Uint8Array(bytes), expected.contentHash);

  const wb = XLSX.read(bytes, {
    type: 'buffer',
    // 上限+1行まで読む(上限を超えたかどうかを !fullref と合わせて判定するため)。
    sheetRows: MAX_SHEET_ROWS + 1,
    // 値だけが要る。数式・HTML・書式・VBA は解釈しない(読む機能を最小にする)。
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
  });
  const sheetName = wb.SheetNames[0];
  if (sheetName === undefined) throw new Error(`no sheets in workbook: ${filePath}`);
  // シート名をキーに引くので、プロトタイプ上のキーに当たらないよう自前のプロパティだけを見る。
  const ws = Object.hasOwn(wb.Sheets, sheetName) ? wb.Sheets[sheetName] : undefined;
  if (ws === undefined || ws['!ref'] === undefined) {
    throw new Error(`empty worksheet: ${filePath}`);
  }
  // sheetRows で切り詰めると !ref は切り詰め後、!fullref は本来の範囲になる。
  const full = XLSX.utils.decode_range(ws['!fullref'] ?? ws['!ref']);
  const rowCount = full.e.r - full.s.r + 1;
  const colCount = full.e.c - full.s.c + 1;
  if (rowCount > MAX_SHEET_ROWS) {
    throw new Error(`worksheet has ${rowCount} rows (> ${MAX_SHEET_ROWS}): ${filePath}`);
  }
  if (colCount > MAX_SHEET_COLS) {
    throw new Error(`worksheet has ${colCount} columns (> ${MAX_SHEET_COLS}): ${filePath}`);
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const lastRow = Math.min(range.e.r, range.s.r + MAX_SHEET_ROWS - 1);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_SHEET_COLS - 1);
  const grid: CellGrid = [];
  for (let r = range.s.r; r <= lastRow; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      row.push(cell !== undefined && cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
    }
    grid.push(row);
  }

  const rawMerges = ws['!merges'] ?? [];
  if (rawMerges.length > MAX_MERGES) {
    throw new Error(`worksheet has ${rawMerges.length} merges (> ${MAX_MERGES}): ${filePath}`);
  }
  const merges: Merge[] = rawMerges.map((m) => {
    // 結合範囲は表の内側に限る(fillMerges は範囲の全セルを書くので、外へ広がると反復が膨らむ)。
    if (
      m.s.r < range.s.r ||
      m.s.c < range.s.c ||
      m.e.r > lastRow ||
      m.e.c > lastCol ||
      m.s.r > m.e.r ||
      m.s.c > m.e.c
    ) {
      throw new Error(`merge ${XLSX.utils.encode_range(m)} is outside the sheet: ${filePath}`);
    }
    return { s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } };
  });
  return { sheetName, grid, merges };
}
