import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CliArgError,
  assertRealpathInside,
  resolveInside,
  snapshotFileName,
  versionedSnapshotPath,
} from '@tmn/publish';
import { sourceIdSchema } from '@tmn/schemas';
import { columnIndex, rowToRecord, type RegistryTable } from './registry.js';

/**
 * なぜ: 再監査 CLI(reaudit.ts)のうち、外部から来る値(CLI 引数と、report が書いて人が受け渡す
 * result.json)を検証する部分を純粋に近い形で切り出す(ファイルを読むが書かない)。
 * apply は「全件の検証が通ってから書き込む」ので、ここで書き込み計画を作り切る。
 */

/**
 * `--flag value` を読む。値が無い・「-」で始まる(次のフラグを値として飲み込んだ)ときは例外。
 * 以前は `--ids --out x` で ids="--out" になっていた。
 */
export function parseReauditArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('-')) {
      throw new CliArgError(`${a}: missing value (got ${JSON.stringify(value ?? null)})`);
    }
    out[a.slice(2)] = value;
    i += 1;
  }
  return out;
}

/** `--ids a,b` → 台帳の形の ID 配列。1件でも形が違えば例外(パス・引数に使うため)。 */
export function parseIdList(raw: string | undefined): string[] {
  const ids = (raw ?? '').split(',').filter((s) => s.length > 0);
  if (ids.length === 0) throw new CliArgError('--ids: at least one source id is required');
  for (const id of ids) {
    if (!sourceIdSchema.safeParse(id).success) {
      throw new CliArgError(`--ids: invalid source id ${JSON.stringify(id)}`);
    }
  }
  return ids;
}

export interface ApplyPlanItem {
  sourceId: string;
  /** 保存するバイト列(レビュー時のハッシュと一致を確認済み)。 */
  bytes: Uint8Array;
  /** 保存先(data/sources/<台帳の自治体コード>/snapshots/<id>.<stamp>.<台帳の種別>)。 */
  outPath: string;
  newSha256: string;
  newPageUpdatedOn: string | null;
}

interface ResultEntry {
  sourceId?: unknown;
  municipalityCode?: unknown;
  sourceType?: unknown;
  fetched?: unknown;
  newFile?: unknown;
  newSha256?: unknown;
  newPageUpdatedOn?: unknown;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * result.json と台帳から書き込み計画を作る。1件でも不整合があれば例外(何も書かない)。
 *
 * なぜ result.json の値で保存元・保存先を決めないか: result.json は人が受け渡すファイルで、
 * newFile に任意のパス(結果ディレクトリ外・外を指す symlink)や別の自治体コード・種別が
 * 書かれていると、それを公式原文として data/sources へ取り込んでしまう。保存元は
 * 「result.json と同じディレクトリの <id>.<台帳の種別>」、保存先は台帳の自治体コードから
 * 組み立て直し、result.json の値は一致するかの照合にだけ使う。
 */
export function planApply(opts: {
  repoRoot: string;
  resultPath: string;
  ids: readonly string[];
  registry: RegistryTable;
  stamp: string;
}): ApplyPlanItem[] {
  const resultPath = resolve(opts.resultPath);
  const resultDir = dirname(resultPath);
  const parsed: unknown = JSON.parse(readFileSync(resultPath, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error('result.json: expected an array');
  const entries = parsed as ResultEntry[];

  const records = new Map(
    opts.registry.rows.map((row) => {
      const rec = rowToRecord(opts.registry.header, row);
      return [rec.source_id ?? '', rec] as const;
    }),
  );
  // 列が無ければここで気づく(台帳スキーマ変更の早期検出)。
  columnIndex(opts.registry, 'municipality_code');
  columnIndex(opts.registry, 'source_type');

  const plan: ApplyPlanItem[] = [];
  for (const id of opts.ids) {
    const rec = records.get(id);
    if (!rec) throw new Error(`${id}: not in the registry`);
    const matches = entries.filter((e) => e.sourceId === id);
    if (matches.length !== 1) {
      throw new Error(`${id}: expected exactly one entry in result.json (found ${matches.length})`);
    }
    const r = matches[0]!;
    const muni = rec.municipality_code ?? '';
    const type = rec.source_type ?? '';
    if (r.municipalityCode !== muni || r.sourceType !== type) {
      throw new Error(
        `${id}: result.json municipalityCode/sourceType (${JSON.stringify(r.municipalityCode)}/` +
          `${JSON.stringify(r.sourceType)}) does not match the registry (${muni}/${type})`,
      );
    }
    if (r.fetched !== true || typeof r.newSha256 !== 'string' || !SHA256_HEX.test(r.newSha256)) {
      throw new Error(`${id}: 取得できていない(または newSha256 が不正な)ので apply できない`);
    }
    const expectedFile = resolveInside(resultDir, snapshotFileName(id, type));
    if (typeof r.newFile !== 'string' || resolve(resultDir, r.newFile) !== expectedFile) {
      throw new Error(
        `${id}: newFile must be ${expectedFile} (got ${JSON.stringify(r.newFile ?? null)})`,
      );
    }
    // symlink で結果ディレクトリの外を指していないか(実体で確かめる)。
    assertRealpathInside(resultDir, expectedFile);
    const bytes = new Uint8Array(readFileSync(expectedFile));
    // レビューしたバイト列と同一であることを確かめる(途中で差し替わっていないか)。
    if (createHash('sha256').update(bytes).digest('hex') !== r.newSha256) {
      throw new Error(`${id}: 取得後にファイルが変わっている(sha256 不一致)`);
    }
    const updated = r.newPageUpdatedOn;
    if (
      updated !== undefined &&
      updated !== null &&
      !(typeof updated === 'string' && ISO_DATE.test(updated))
    ) {
      throw new Error(`${id}: newPageUpdatedOn must be YYYY-MM-DD or null`);
    }
    plan.push({
      sourceId: id,
      bytes,
      outPath: versionedSnapshotPath(opts.repoRoot, muni, id, type, opts.stamp),
      newSha256: r.newSha256,
      newPageUpdatedOn: typeof updated === 'string' ? updated : null,
    });
  }
  return plan;
}
