import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pickCurrentSnapshot } from '@tmn/drift';
import { municipalityCodeSchema, sourceIdSchema, sourceTypeSchema } from '@tmn/schemas';

/**
 * なぜ: 原文スナップショット(data/sources/<自治体コード>/snapshots/<sourceId>[.<YYYYMMDD>].<ext>)の
 * パスを組み立てる処理と、使う直前の改ざん検査を1か所に置く。
 *
 * - パス: 自治体コード・sourceId・種別は台帳や再監査の result.json から来る「外部入力」。
 *   スキーマで形を確かめたうえで、解決後のパスが基準ディレクトリの内側にあることを
 *   path.relative で確かめる(文字列の前方一致は `snapshots-backup` のような隣のディレクトリも
 *   通すので使わない)。既存のパスは symlink を解いた実体でも確かめる。
 * - 改ざん検査: スナップショットは不変で、台帳の content_hash(SHA-256)が承認時の原文を指す。
 *   publish と RAG 索引は原文を読んで公開物(巡回の基準日・回答の本文)を作るので、読むたびに
 *   ハッシュを照合し、食い違えば止める(fail closed)。
 *
 * ingest(書き込み)・publish(基準日)・rag(本文)の3か所が同じ関数を通る。
 */

export class PathContainmentError extends Error {
  constructor(base: string, target: string) {
    super(`Refusing path outside its base directory: ${target} (base: ${base})`);
    this.name = 'PathContainmentError';
  }
}

/** target が base の内側(base 自身は含まない)にあるか。どちらも絶対パスで渡す。 */
export function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * base の下に segments を解決し、内側に収まらなければ例外。
 * なぜ: path.resolve は `..` や絶対パスの要素をそのまま解釈する(絶対パスなら base を捨てる)ので、
 * 解決した後に包含を確かめないと境界にならない。
 */
export function resolveInside(base: string, ...segments: string[]): string {
  const absBase = resolve(base);
  const target = resolve(absBase, ...segments);
  if (!isInside(absBase, target)) throw new PathContainmentError(absBase, target);
  return target;
}

/**
 * 既存のパスについて、symlink を解いた実体どうしで包含を確かめる。
 * なぜ: path.resolve は symlink を解かない。snapshots ディレクトリやファイルが外を指す symlink に
 * 差し替えられていると、文字列上は内側でも実体は外になる。
 */
export function assertRealpathInside(base: string, target: string): void {
  const realBase = realpathSync(base);
  const realTarget = realpathSync(target);
  if (!isInside(realBase, realTarget)) throw new PathContainmentError(realBase, realTarget);
}

/** 原文スナップショット置き場(data/sources)。 */
export function sourcesRoot(repoRoot: string): string {
  return resolve(repoRoot, 'data/sources');
}

function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
  label: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
  return r.data;
}

/** 自治体のスナップショットディレクトリ(存在しなくてもパスは返す)。 */
export function snapshotDir(repoRoot: string, municipalityCode: string): string {
  const code = parseOrThrow(municipalityCodeSchema, municipalityCode, 'municipalityCode');
  const root = sourcesRoot(repoRoot);
  const dir = resolveInside(root, code, 'snapshots');
  if (existsSync(dir)) assertRealpathInside(root, dir);
  return dir;
}

const STAMP = /^\d{8}$/;

/** `<sourceId>.<ext>` または版付き `<sourceId>.<YYYYMMDD>.<ext>` のファイル名(値を検証して作る)。 */
export function snapshotFileName(sourceId: string, ext: string, stamp?: string): string {
  const id = parseOrThrow(sourceIdSchema, sourceId, 'sourceId');
  const type = parseOrThrow(sourceTypeSchema, ext, 'source type');
  if (stamp !== undefined && !STAMP.test(stamp)) {
    throw new Error(`invalid snapshot stamp: ${JSON.stringify(stamp)}`);
  }
  return stamp === undefined ? `${id}.${type}` : `${id}.${stamp}.${type}`;
}

/** 書き込み先の版付きスナップショットのパス(ingest --update / reaudit apply)。 */
export function versionedSnapshotPath(
  repoRoot: string,
  municipalityCode: string,
  sourceId: string,
  ext: string,
  stamp: string,
): string {
  const dir = snapshotDir(repoRoot, municipalityCode);
  return resolveInside(dir, snapshotFileName(sourceId, ext, stamp));
}

/**
 * そのソースの現行スナップショット(版付きがあれば最新)の絶対パス。無ければ null。
 * 自治体コードが無いソース(台帳上は全件にあるが型は optional)も null。
 */
export function findCurrentSnapshot(
  repoRoot: string,
  municipalityCode: string | undefined,
  sourceId: string,
  ext: string,
): string | null {
  if (municipalityCode === undefined) return null;
  // 名前の形を先に確かめる(pickCurrentSnapshot は前方一致でファイル名を選ぶため)。
  snapshotFileName(sourceId, ext);
  const dir = snapshotDir(repoRoot, municipalityCode);
  if (!existsSync(dir)) return null;
  const name = pickCurrentSnapshot(readdirSync(dir), sourceId, ext);
  if (!name) return null;
  const path = resolveInside(dir, name);
  assertRealpathInside(dir, path);
  return path;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class SnapshotIntegrityError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string, detail: string) {
    super(`Snapshot integrity check failed for ${sourceId}: ${detail}`);
    this.name = 'SnapshotIntegrityError';
    this.sourceId = sourceId;
  }
}

export interface KnownHashMismatch {
  /** 台帳に記録されている content_hash。 */
  recorded: string;
  /** スナップショットの実際の SHA-256。 */
  actual: string;
  why: string;
}

/**
 * 既知の食い違い(人の判断待ち)。台帳もスナップショットも変えずに publish / RAG 索引を
 * 続けられるよう、**記録値と実値の組がこのとおりのときだけ**通す。どちらかが変われば
 * (原文の差し替え・台帳の書き換え)通常どおり止まる。
 *
 * 現在は無し。2026-10-02 に見つかった千代田区の転入届(追加時から台帳のハッシュと原文が
 * 一致しなかった)は、2026-10-03 の再監査で取り直して台帳を揃えた(人手承認)。
 */
export const KNOWN_SNAPSHOT_HASH_MISMATCHES: ReadonlyMap<string, KnownHashMismatch> = new Map();

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * 原文のバイト列が台帳の content_hash と一致するか。食い違い・ハッシュ未記録・形式不正は例外。
 * knownMismatches は既定で KNOWN_SNAPSHOT_HASH_MISMATCHES(テストで差し替える)。
 */
export function verifySnapshotBytes(
  sourceId: string,
  bytes: Uint8Array,
  recordedHash: string | undefined,
  knownMismatches: ReadonlyMap<string, KnownHashMismatch> = KNOWN_SNAPSHOT_HASH_MISMATCHES,
): void {
  const recorded = (recordedHash ?? '').trim().toLowerCase();
  if (!SHA256_HEX.test(recorded)) {
    // ハッシュが無い原文は、承認時のものかどうか確かめようがない。推測で使わない。
    throw new SnapshotIntegrityError(sourceId, 'registry content_hash is missing or malformed');
  }
  const actual = sha256Hex(bytes);
  if (actual === recorded) return;
  const known = knownMismatches.get(sourceId);
  if (known && known.recorded === recorded && known.actual === actual) return;
  throw new SnapshotIntegrityError(
    sourceId,
    `sha256(snapshot)=${actual} does not match registry content_hash=${recorded}`,
  );
}

export interface SnapshotSourceRef {
  sourceId: string;
  municipalityCode: string | undefined;
  sourceType: string;
  contentHash: string | undefined;
}

/**
 * 現行スナップショットを読み、台帳のハッシュと照合してから返す。スナップショットが無ければ null
 * (公開リポジトリのように原文を置かない環境の従来動作を保つ。呼び出し側が欠落の扱いを決める)。
 */
export function readVerifiedSnapshot(
  repoRoot: string,
  source: SnapshotSourceRef,
  knownMismatches?: ReadonlyMap<string, KnownHashMismatch>,
): { path: string; bytes: Uint8Array } | null {
  const path = findCurrentSnapshot(
    repoRoot,
    source.municipalityCode,
    source.sourceId,
    source.sourceType,
  );
  if (path === null) return null;
  const bytes = new Uint8Array(readFileSync(path));
  verifySnapshotBytes(source.sourceId, bytes, source.contentHash, knownMismatches);
  return { path, bytes };
}
