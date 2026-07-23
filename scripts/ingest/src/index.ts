// @tmn/ingest — re-fetch + diff detection + offline validation pipeline (T-012).

export { detectEncoding, decodeBuffer } from './encoding.js';
export type { DetectedEncoding, EncodingDetection, DecodeResult } from './encoding.js';
export { sha256Hex } from './hash.js';
export { fetchOfficial, isOfficialHost, assertOfficialUrl, DisallowedHostError } from './http.js';
export type { FetchResult, FetchOptions } from './http.js';
export { extractTextLines, summarizeLineDiff } from './html.js';
export type { LineDiffSummary } from './html.js';
export { classify, applyUpdate } from './classify.js';
export type { Classification, FetchOutcome } from './classify.js';
export {
  parseCsv,
  parseRegistryTable,
  serializeRegistry,
  readRegistryTable,
  writeRegistryTable,
  validateRegistryRows,
  columnIndex,
  rowToRecord,
  tableToRecords,
  recordToSourceInput,
} from './registry.js';
export type { RegistryTable, RegistryRowResult } from './registry.js';
export { runValidations } from './validate-core.js';
export type { ValidateInput, ValidateResult } from './validate-core.js';
export { tokyoToday, daysBetween } from './dates.js';
export {
  parseWeekday,
  parseWeekdayList,
  parseWeekOfMonthWeekday,
  extractGreenTableRows,
  buildShinjukuWaste,
} from './waste-table.js';
export type {
  WeekOfMonthWeekday,
  GreenTableRow,
  WasteType,
  BuildWasteOptions,
  BuiltWaste,
} from './waste-table.js';
export { parseWasteSortingCsv } from './waste-sorting.js';
export type { WasteSortingCsvOptions } from './waste-sorting.js';
