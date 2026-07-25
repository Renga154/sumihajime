/**
 * なぜ: `waste-xlsx.ts` の純関数を SheetJS(`xlsx`)へ結合させないため、XLSXファイル読み取りだけを
 * 分離した薄いアダプタ。ここだけが `xlsx` に依存する。純関数側は grid + merges を受け取るため、
 * SheetJSを使わない合成fixtureで決定論的に単体テストできる(依存の局所化)。
 *
 * `xlsx` は `scripts/ingest` の devDependency。本モジュールは ingest の公開エントリ(index.ts)から
 * export しない(他パッケージが実行時に `xlsx` を要求しないようにするため)。
 */

import XLSX from 'xlsx';
import type { CellGrid, Merge } from './waste-xlsx.js';

export interface SheetData {
  sheetName: string;
  grid: CellGrid;
  merges: Merge[];
}

/** XLSXの先頭シートを「文字列グリッド + 結合範囲」へ。SheetJSのセル値は文字列化する。 */
export function readOtaWasteSheet(filePath: string): SheetData {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (sheetName === undefined) throw new Error(`no sheets in workbook: ${filePath}`);
  const ws = wb.Sheets[sheetName];
  if (ws === undefined || ws['!ref'] === undefined) {
    throw new Error(`empty worksheet: ${filePath}`);
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid: CellGrid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell !== undefined && cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
    }
    grid.push(row);
  }
  const merges: Merge[] = (ws['!merges'] ?? []).map((m) => ({
    s: { r: m.s.r, c: m.s.c },
    e: { r: m.e.r, c: m.e.c },
  }));
  return { sheetName, grid, merges };
}
