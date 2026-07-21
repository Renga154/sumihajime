import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceSchema, type Source } from '@tmn/schemas';

/**
 * なぜ: registry.csv を「行×列」構造のまま読み書きするため、依存を足さずに
 * RFC4180準拠のパーサ+シリアライザを持つ(scripts/publish/src/csv.ts の流儀を踏襲)。
 * publish 側は読み取り専用だが、ingest の --update は台帳を書き戻す必要があるため
 * 列順・非対象セルを一切崩さない round-trip 可能な実装を ingest 内に持つ。
 */

const REGISTRY_REL = 'docs/data-sources/registry.csv';

export interface RegistryTable {
  header: string[];
  /** データ行(ヘッダを除く)。各行はヘッダと同じ列数。 */
  rows: string[][];
  /** 原文の改行コード。--update 書き戻し時に原文の EOL を保つ(実台帳はCRLF)。 */
  eol: string;
}

/** RFC4180準拠の最小CSVパース(ダブルクォート囲み・""エスケープ・改行含みセル)。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      rows.push(record);
      record = [];
      field = '';
    } else if (ch === '\r') {
      // CRLFのCRは無視(次の\nで確定)。
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

/** 1セルを必要なときだけクォートする(カンマ・改行・ダブルクォート含む場合)。 */
function serializeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** RegistryTable を CSV文字列へ(原文EOL・末尾改行を保存)。round-trip でセル内容を保存。 */
export function serializeRegistry(table: RegistryTable): string {
  const lines = [table.header, ...table.rows].map((row) => row.map(serializeCell).join(','));
  return lines.join(table.eol) + table.eol;
}

export function parseRegistryTable(text: string): RegistryTable {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const all = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
  const [header, ...rows] = all;
  if (!header) {
    throw new Error('registry.csv: empty or header-less file.');
  }
  for (const [i, row] of rows.entries()) {
    if (row.length !== header.length) {
      throw new Error(
        `registry.csv: row ${i + 2} has ${row.length} columns but header has ${header.length}.`,
      );
    }
  }
  return { header, rows, eol };
}

export function readRegistryTable(repoRoot: string): RegistryTable {
  return parseRegistryTable(readFileSync(resolve(repoRoot, REGISTRY_REL), 'utf-8'));
}

export function writeRegistryTable(repoRoot: string, table: RegistryTable): void {
  writeFileSync(resolve(repoRoot, REGISTRY_REL), serializeRegistry(table), 'utf-8');
}

/** ヘッダ名 → 列インデックス。存在しなければ例外(台帳スキーマ変更の早期検出)。 */
export function columnIndex(table: RegistryTable, name: string): number {
  const idx = table.header.indexOf(name);
  if (idx === -1) {
    throw new Error(`registry.csv: missing expected column "${name}".`);
  }
  return idx;
}

/** データ行 → ヘッダをキーにしたレコード。 */
export function rowToRecord(header: string[], row: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  header.forEach((key, i) => {
    rec[key] = row[i] ?? '';
  });
  return rec;
}

export function tableToRecords(table: RegistryTable): Record<string, string>[] {
  return table.rows.map((row) => rowToRecord(table.header, row));
}

function opt(v: string | undefined): string | undefined {
  return v !== undefined && v.trim().length > 0 ? v : undefined;
}

/**
 * なぜ: 台帳の監査タイムスタンプは日付粒度("2026-07-21")だが sourceSchema は
 * iso.datetime() を要求する。scripts/publish/src/load.ts と同じ正規化で、schemaを
 * 緩めずに検証する(publish時と同一基準)。registry自体は書き換えない。
 */
function toDateTime(v: string | undefined): string | undefined {
  const s = opt(v);
  if (s === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
}

/** レコード → sourceSchema入力オブジェクト(publish load.ts と同一マッピング)。 */
export function recordToSourceInput(r: Record<string, string>): Record<string, unknown> {
  return {
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    ownerOrganization: r.owner_organization,
    municipalityCode: opt(r.municipality_code),
    category: r.category,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
    license: r.license,
    attributionText: r.attribution_text,
    fetchMethod: r.fetch_method,
    updateFrequency: r.update_frequency,
    lastFetchedAt: toDateTime(r.last_fetched_at),
    lastVerifiedAt: toDateTime(r.last_verified_at),
    sourceLastModifiedAt: toDateTime(r.source_last_modified_at),
    contentHash: opt(r.content_hash),
    reviewStatus: r.review_status,
    reviewer: opt(r.reviewer),
    effectiveFrom: opt(r.effective_from),
    effectiveTo: opt(r.effective_to),
    notes: opt(r.notes),
  };
}

export interface RegistryRowResult {
  /** ヘッダを除いたデータ行の0始まりインデックス(CSVの実行番号は +2)。 */
  rowIndex: number;
  record: Record<string, string>;
  source: Source | null;
  /** schema検証エラーの人間可読メッセージ(source が null のとき設定)。 */
  schemaError?: string;
}

/** 全行を sourceSchema で検証(throwせず結果を集約。validate CLIが列挙する)。 */
export function validateRegistryRows(table: RegistryTable): RegistryRowResult[] {
  return table.rows.map((row, rowIndex) => {
    const record = rowToRecord(table.header, row);
    const parsed = sourceSchema.safeParse(recordToSourceInput(record));
    if (parsed.success) {
      return { rowIndex, record, source: parsed.data };
    }
    const msg = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { rowIndex, record, source: null, schemaError: msg };
  });
}
