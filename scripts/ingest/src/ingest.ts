import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pickCurrentSnapshot } from '@tmn/drift';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBuffer } from './encoding.js';
import { sha256Hex } from './hash.js';
import { fetchOfficial } from './http.js';
import { summarizeLineDiff } from './html.js';
import { applyUpdate, classify, type Classification, type FetchOutcome } from './classify.js';
import {
  columnIndex,
  readRegistryTable,
  rowToRecord,
  writeRegistryTable,
  type RegistryTable,
} from './registry.js';
import { tokyoToday } from './dates.js';

/**
 * 再取得+差分検知CLI(T-012)。
 *
 * 使い方:
 *   pnpm --filter @tmn/ingest ingest -- --municipality 13112            # read-only(既定)
 *   pnpm --filter @tmn/ingest ingest -- --municipality 13112 --update   # 台帳/スナップショット更新
 *   pnpm --filter @tmn/ingest ingest -- --municipality 13112 --timeout 30000
 *
 * 既定は完全 read-only(ネットワーク取得と分類レポートのみ。ファイル書き込み一切なし)。
 * --update 指定時のみ:
 *   - changed のソースの新スナップショットを版付き名で保存(既存は不変=上書きしない)
 *   - registry.csv を書き戻し(last_fetched_at更新 / changed行は content_hash更新 + review_status=pending降格)
 * REQUIREMENTS §12.5「差分が検出されても自動公開せず、原則レビュー待ち」に従い、changed は pending へ降格する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

interface Args {
  municipality: string;
  update: boolean;
  timeoutMs: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { municipality: '', update: false, timeoutMs: 20_000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--municipality' || a === '-m') {
      args.municipality = argv[++i] ?? '';
    } else if (a === '--update') {
      args.update = true;
    } else if (a === '--timeout') {
      args.timeoutMs = Number(argv[++i] ?? '20000');
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

const HELP = `ingest — re-fetch official sources, detect diffs by SHA-256, and (optionally) update the registry.

Usage:
  ingest --municipality <code> [--update] [--timeout <ms>]

Options:
  --municipality, -m   Municipality code to re-fetch (e.g. 13112). Required.
  --update             Write changes: save versioned snapshots for changed sources and
                       rewrite registry.csv (last_fetched_at; changed rows -> content_hash +
                       review_status=pending). Omit for a completely READ-ONLY run (default).
  --timeout <ms>       Per-request timeout in milliseconds (default 20000). One retry is attempted.
  --help, -h           Show this help.

Default is fully READ-ONLY: it fetches and prints a classification report but writes nothing.`;

const SNAP_EXT: Record<string, string> = { html: 'html', csv: 'csv', json: 'json', pdf: 'pdf' };

/**
 * 現行スナップショットの中身を返す(diff用)。無ければ undefined。
 * 版はファイル名の日付で選ぶ(@tmn/drift pickCurrentSnapshot)。以前は mtime で選んでいたが、
 * mtime は git checkout で変わるため環境によって別の版を「最新」と見なしていた。
 */
function readLatestSnapshot(
  snapDir: string,
  sourceId: string,
  ext: string,
): Uint8Array | undefined {
  if (!existsSync(snapDir)) return undefined;
  const file = pickCurrentSnapshot(readdirSync(snapDir), sourceId, ext);
  return file ? new Uint8Array(readFileSync(resolve(snapDir, file))) : undefined;
}

interface RowReport {
  sourceId: string;
  sourceType: string;
  url: string;
  classification: Classification;
  encoding?: string;
  hadBom?: boolean;
  storedHash?: string;
  newHash?: string;
  bytes?: number;
  error?: string;
  addedLines?: number;
  removedLines?: number;
  /** 差分詳細(表示専用)。 */
  _diff?: ReturnType<typeof summarizeLineDiff>;
}

async function processRow(
  table: RegistryTable,
  row: string[],
  timeoutMs: number,
): Promise<{ report: RowReport; outcome: FetchOutcome; newBytes?: Uint8Array }> {
  const rec = rowToRecord(table.header, row);
  const sourceId = rec.source_id ?? '';
  const url = rec.source_url ?? '';
  const storedHash = rec.content_hash?.trim() || undefined;

  try {
    const { bytes, contentType } = await fetchOfficial(url, { timeoutMs, retries: 1 });
    const newHash = sha256Hex(bytes);
    const classification = classify(storedHash, newHash, true);
    const decoded = decodeBuffer(bytes);
    const report: RowReport = {
      sourceId,
      sourceType: rec.source_type ?? '',
      url,
      classification,
      encoding: `${decoded.encoding}${decoded.hadBom ? ' (BOM)' : ''}`,
      storedHash,
      newHash,
      bytes: bytes.length,
    };
    if (contentType) report.encoding = `${report.encoding} · ${contentType}`;

    if (classification === 'changed' && rec.source_type === 'html') {
      const snapDir = resolve(repoRoot, 'data/sources', rec.municipality_code ?? '', 'snapshots');
      const prev = readLatestSnapshot(snapDir, sourceId, SNAP_EXT[rec.source_type] ?? 'bin');
      if (prev) {
        const diff = summarizeLineDiff(decodeBuffer(prev).text, decoded.text);
        report.addedLines = diff.addedCount;
        report.removedLines = diff.removedCount;
        report._diff = diff;
      }
    }
    return { report, outcome: { sourceId, classification, newHash }, newBytes: bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      report: {
        sourceId,
        sourceType: rec.source_type ?? '',
        url,
        classification: 'fetch_error',
        error: message,
      },
      outcome: { sourceId, classification: 'fetch_error' },
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.municipality) {
    console.log(HELP);
    process.exitCode = args.municipality ? 0 : 1;
    return;
  }

  const table = readRegistryTable(repoRoot);
  const idMuni = columnIndex(table, 'municipality_code');
  const idType = columnIndex(table, 'source_type');
  const targetRows = table.rows.filter(
    (r) => r[idMuni] === args.municipality && ['html', 'csv'].includes(r[idType] ?? ''),
  );

  console.log(
    `[ingest] municipality=${args.municipality} sources=${targetRows.length} mode=${args.update ? 'UPDATE' : 'read-only'}`,
  );
  if (targetRows.length === 0) {
    console.log('[ingest] no html/csv sources found for this municipality.');
    return;
  }

  const results = [];
  for (const row of targetRows) {
    results.push(await processRow(table, row, args.timeoutMs));
  }

  // レポート出力。
  console.log('\n=== classification report ===');
  const counts: Record<Classification, number> = { unchanged: 0, changed: 0, fetch_error: 0 };
  for (const { report } of results) {
    counts[report.classification]++;
    const tag = report.classification.toUpperCase().padEnd(11);
    const meta =
      report.classification === 'fetch_error'
        ? `ERROR: ${report.error}`
        : `${report.bytes}B · ${report.encoding}`;
    console.log(`  ${tag} ${report.sourceId}  [${report.sourceType}]  ${meta}`);
    if (report.classification === 'changed') {
      console.log(`      stored=${report.storedHash ?? '(none)'}`);
      console.log(`      new   =${report.newHash}`);
      if (report._diff) {
        console.log(
          `      body diff: +${report._diff.addedCount} / -${report._diff.removedCount} lines`,
        );
        for (const line of report._diff.addedSample) console.log(`        + ${line}`);
        for (const line of report._diff.removedSample) console.log(`        - ${line}`);
      }
    }
  }
  console.log(
    `\n[ingest] summary: unchanged=${counts.unchanged} changed=${counts.changed} fetch_error=${counts.fetch_error}`,
  );

  if (!args.update) {
    if (counts.changed > 0) {
      console.log(
        '[ingest] read-only: detected changes are reported only. Re-run with --update to save ' +
          'versioned snapshots and demote changed rows to review_status=pending.',
      );
    }
    console.log('[ingest] read-only run: no files written.');
    return;
  }

  // --- 以下は --update 指定時のみ(書き込み) ---
  const today = tokyoToday();
  // 1. changed の新スナップショットを版付きで保存(既存は不変=上書きしない)。
  for (const { report, newBytes } of results) {
    if (report.classification !== 'changed' || !newBytes) continue;
    const rec = table.rows.find((r) => rowToRecord(table.header, r).source_id === report.sourceId);
    const muni = rec ? rowToRecord(table.header, rec).municipality_code : '';
    const ext = SNAP_EXT[report.sourceType] ?? 'bin';
    const snapDir = resolve(repoRoot, 'data/sources', muni ?? '', 'snapshots');
    mkdirSync(snapDir, { recursive: true });
    const outPath = resolve(snapDir, `${report.sourceId}.${today.replace(/-/g, '')}.${ext}`);
    if (existsSync(outPath)) {
      console.log(`[ingest] snapshot exists, not overwriting: ${outPath}`);
    } else {
      writeFileSync(outPath, newBytes);
      console.log(`[ingest] saved snapshot: ${outPath}`);
    }
  }

  // 2. registry.csv を書き戻し。
  const outcomes = results.map((r) => r.outcome);
  const updated = applyUpdate(table, outcomes, today);
  writeRegistryTable(repoRoot, updated);
  console.log(`[ingest] registry.csv updated (last_fetched_at=${today}; changed rows -> pending).`);
}

main().catch((err) => {
  console.error('[ingest] fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
