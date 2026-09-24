import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedText } from '@tmn/rag';
import {
  RAG_MUNICIPALITIES,
  buildChunkManifest,
  buildRagChunksSql,
  toVectorLine,
} from './manifest.js';

/**
 * なぜ: RAG索引構築CLI(T-013)。
 *   1. 承認済みHTMLスナップショット → チャンク化(manifest.ts)
 *   2. チャンク本文を D1 rag_chunks へ(回答時の本文参照用)
 *   3. OpenAI text-embedding-3-small で埋め込み → Vectorize へ upsert(冪等)
 * OPENAI_API_KEY(apps/api/.dev.vars または環境変数)が無ければ、1 と 2 の生成物(manifest / SQL)
 * まで作って停止する(埋め込み・Vectorize投入はスキップし、その旨を出力)。
 *
 * 使い方(apps/api の wrangler 認証が前提):
 *   pnpm --filter @tmn/rag-index build:index -- --dry-run   # ファイル生成のみ(wrangler不実行)
 *   pnpm --filter @tmn/rag-index build:index -- --remote    # 本番D1 + 本番Vectorizeへ投入
 *   pnpm --filter @tmn/rag-index build:index                # ローカルD1へrag_chunks + Vectorize(常にリモート)
 *
 * 秘密の取り扱い: OPENAI_API_KEY の値は表示・ログ・ファイル出力しない。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const apiDir = resolve(repoRoot, 'apps/api');
const wranglerBin = resolve(apiDir, 'node_modules/.bin/wrangler');
// なぜbinding名: wrangler env(--env odh のミラー等)では database_name が環境ごとに異なるが、
// binding名 "DB" は全環境で共通のため、環境非依存にD1を特定できる(ADR-008)。
const DB_NAME = 'DB';
// --env/--index で上書き可能(ミラー環境向け)。既定は個人アカウントの本番索引。
let INDEX_NAME = 'tokyo-move-navi-rag';
let ENV_ARGS: string[] = [];
// なぜ: Vectorize の upsert は非同期に処理される。処理完了前にクエリすると新チャンクがヒットせず
// 保留・誤答になる(本番でこの取りこぼしが発生)。upsert 前後で info の processedUpToMutation の変化と
// vectorCount を監視し、索引反映を保証してから終了する(詳細は upsertVectorsAndWait を参照)。
// 2026-09-25 の再構築では処理完了まで6〜8分かかり、5分で打ち切られた。余裕を持って15分待つ。
const MUTATION_WAIT_TIMEOUT_MS = 900_000;
const MUTATION_POLL_INTERVAL_MS = 5_000;

/** ブロッキングsleep(ビルドCLIは同期実行のため子プロセス的な待機で十分)。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** info --json 等の出力から先頭のJSONオブジェクトを取り出してパースする(バナー行混入に耐性)。 */
function parseLeadingJson<T>(out: string): T | undefined {
  const start = out.indexOf('{');
  if (start < 0) return undefined;
  try {
    return JSON.parse(out.slice(start)) as T;
  } catch {
    return undefined;
  }
}

interface VectorizeInfo {
  vectorCount?: number;
  processedUpToMutation?: string;
}

function vectorizeInfo(): VectorizeInfo {
  const out = execFileSync(wranglerBin, ['vectorize', 'info', INDEX_NAME, '--json', ...ENV_ARGS], {
    cwd: apiDir,
    encoding: 'utf-8',
  });
  return parseLeadingJson<VectorizeInfo>(out) ?? {};
}

/**
 * Vectorize へ upsert し、その mutation が索引へ反映される(=検索可能になる)まで待つ。
 *
 * なぜこの検出方法か: `wrangler vectorize upsert --json` は {index, count} のみ返し mutationId を返さない。
 * 反映状況は `info` の processedUpToMutation(最後に処理し終えたmutationのID)でしか観測できない。
 * そこで upsert 前の processedUpToMutation を控え、upsert 後にそれが**変化**し、かつ vectorCount が
 * 期待値(投入行数)以上になるまでポーリングする。ビルドは単一ライターなので、processedUpToMutation が
 * 前値から進めば今回の upsert が処理し終えたことを意味する。タイムアウト時は警告して続行する。
 */
function upsertVectorsAndWait(ndjsonPath: string, expectedCount: number): void {
  const before = vectorizeInfo().processedUpToMutation;
  const upsertOut = execFileSync(
    wranglerBin,
    ['vectorize', 'upsert', INDEX_NAME, '--file', ndjsonPath, '--json', ...ENV_ARGS],
    { cwd: apiDir, encoding: 'utf-8' },
  );
  const enqueued = parseLeadingJson<{ count?: number }>(upsertOut)?.count;
  console.log(
    `[rag-index] enqueued ${enqueued ?? '?'} vectors (prev processedUpToMutation=${before ?? 'none'}). Waiting for processing…`,
  );
  const deadline = Date.now() + MUTATION_WAIT_TIMEOUT_MS;
  for (;;) {
    const info = vectorizeInfo();
    const advanced =
      info.processedUpToMutation !== undefined && info.processedUpToMutation !== before;
    const countOk = (info.vectorCount ?? 0) >= expectedCount;
    if (advanced && countOk) {
      console.log(
        `[rag-index] Vectorize finished processing (processedUpToMutation=${info.processedUpToMutation}, vectorCount=${info.vectorCount}).`,
      );
      return;
    }
    if (Date.now() > deadline) {
      console.warn(
        `[rag-index] timed out (${Math.round(MUTATION_WAIT_TIMEOUT_MS / 1000)}s) waiting for the upsert to process ` +
          `(processedUpToMutation=${info.processedUpToMutation ?? 'unknown'}, vectorCount=${info.vectorCount ?? '?'}/${expectedCount}). ` +
          'Re-check with `wrangler vectorize info` before evaluating.',
      );
      return;
    }
    console.log(
      `[rag-index] …still processing (processedUpToMutation=${info.processedUpToMutation ?? 'unknown'}, vectorCount=${info.vectorCount ?? '?'}/${expectedCount}); retry in ${
        MUTATION_POLL_INTERVAL_MS / 1000
      }s`,
    );
    sleepSync(MUTATION_POLL_INTERVAL_MS);
  }
}

/** OPENAI_API_KEY を env → apps/api/.dev.vars の順で探す(値はechoしない)。 */
/**
 * いま D1 にある rag_chunks の chunk_id(= 索引に入っているはずのベクトルID)。
 * なぜ: upsert は上書きしかしない。再監査で本文が短くなったページは末尾のチャンクIDが消えるが、
 * そのベクトルは古い本文の埋め込みのまま索引に残り、検索枠を奪う(2026-09-25 に14件発生)。
 * 差し替え前の一覧と新しい一覧の差を取り、消えたIDを索引から削除するために使う。
 */
function currentChunkIds(dbTarget: string): string[] {
  const out = execFileSync(
    wranglerBin,
    [
      'd1',
      'execute',
      DB_NAME,
      dbTarget,
      '--json',
      '--command',
      'SELECT chunk_id FROM rag_chunks',
      ...ENV_ARGS,
    ],
    { cwd: apiDir, encoding: 'utf-8' },
  );
  const start = out.indexOf('[');
  if (start < 0) return [];
  const parsed = JSON.parse(out.slice(start)) as { results?: { chunk_id: string }[] }[];
  return (parsed[0]?.results ?? []).map((r) => r.chunk_id);
}

/** 新しい一覧に無いIDを索引から消す(削除は非同期。ID は1回100件ずつ渡す)。 */
function deleteOrphanVectors(orphans: readonly string[]): void {
  if (orphans.length === 0) {
    console.log('[rag-index] no orphan vectors.');
    return;
  }
  for (let i = 0; i < orphans.length; i += 100) {
    execFileSync(
      wranglerBin,
      [
        'vectorize',
        'delete-vectors',
        INDEX_NAME,
        '--ids',
        ...orphans.slice(i, i + 100),
        ...ENV_ARGS,
      ],
      { cwd: apiDir, stdio: 'inherit' },
    );
  }
  console.log(`[rag-index] enqueued deletion of ${orphans.length} orphan vector(s).`);
}

function readOpenAIKey(): string | undefined {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0) {
    return process.env.OPENAI_API_KEY.trim();
  }
  const devVars = resolve(apiDir, '.dev.vars');
  if (!existsSync(devVars)) return undefined;
  for (const line of readFileSync(devVars, 'utf-8').split(/\r?\n/)) {
    const m = /^\s*OPENAI_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[1]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.length > 0 ? v : undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const remote = process.argv.includes('--remote');
  const dbTarget = remote ? '--remote' : '--local';
  const envIdx = process.argv.indexOf('--env');
  if (envIdx >= 0 && process.argv[envIdx + 1]) {
    ENV_ARGS = ['--env', process.argv[envIdx + 1]!];
  }
  const indexIdx = process.argv.indexOf('--index');
  if (indexIdx >= 0 && process.argv[indexIdx + 1]) {
    INDEX_NAME = process.argv[indexIdx + 1]!;
  }
  if (ENV_ARGS.length > 0 || INDEX_NAME !== 'tokyo-move-navi-rag') {
    console.log(`[rag-index] target: index=${INDEX_NAME} env=${ENV_ARGS[1] ?? '(default)'}`);
  }

  const manifest = buildChunkManifest(repoRoot);
  console.log(
    `[rag-index] built ${manifest.chunkCount} chunks from ${manifest.sourceCount} approved HTML sources (municipalities ${RAG_MUNICIPALITIES.join(', ')}).`,
  );

  const outDir = resolve(repoRoot, `data/rag/index`);
  mkdirSync(outDir, { recursive: true });

  const manifestPath = resolve(outDir, 'chunks.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`[rag-index] wrote chunk manifest: ${manifestPath}`);

  const ragSql = buildRagChunksSql(manifest.chunks);
  const sqlPath = resolve(apiDir, '.wrangler', 'rag_chunks.sql');
  mkdirSync(dirname(sqlPath), { recursive: true });
  writeFileSync(sqlPath, ragSql.map((s) => `${s};`).join('\n') + '\n', 'utf-8');
  console.log(`[rag-index] wrote rag_chunks seed SQL (${ragSql.length} statements): ${sqlPath}`);

  const apiKey = readOpenAIKey();
  if (!apiKey) {
    console.log(
      '[rag-index] OPENAI_API_KEY not found (checked env and apps/api/.dev.vars). ' +
        'Skipped embeddings and Vectorize upsert. ' +
        'Create apps/api/.dev.vars with OPENAI_API_KEY, then re-run to complete the index.',
    );
    return;
  }

  if (dryRun) {
    console.log('[rag-index] --dry-run: skipped embeddings and wrangler (no network writes).');
    return;
  }

  const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
  console.log(`[rag-index] embedding ${manifest.chunkCount} chunks with ${model}…`);

  const lines: string[] = [];
  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunk = manifest.chunks[i]!;
    const values = await embedText(chunk.text, model, { apiKey, baseURL });
    lines.push(toVectorLine(chunk, values));
    if ((i + 1) % 20 === 0 || i + 1 === manifest.chunks.length) {
      console.log(`[rag-index] embedded ${i + 1}/${manifest.chunks.length}`);
    }
  }
  const ndjsonPath = resolve(outDir, 'vectors.ndjson');
  writeFileSync(ndjsonPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`[rag-index] wrote ${lines.length} vectors: ${ndjsonPath}`);

  // 差し替え前に、いま索引に入っているはずのIDを控える(消えたチャンクのベクトルを後で削除する)。
  const previousIds = currentChunkIds(dbTarget);
  const nextIds = new Set(manifest.chunks.map((c) => c.id));
  const orphans = previousIds.filter((id) => !nextIds.has(id));

  console.log(`[rag-index] seeding D1 rag_chunks (${dbTarget})…`);
  execFileSync(wranglerBin, ['d1', 'execute', DB_NAME, dbTarget, '--file', sqlPath, ...ENV_ARGS], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  // Vectorize は常にリモート(ローカル模擬なし)。upsert で冪等に差し替え、反映完了まで待つ。
  console.log('[rag-index] upserting vectors into Vectorize (remote)…');
  upsertVectorsAndWait(ndjsonPath, lines.length);
  deleteOrphanVectors(orphans);

  console.log('[rag-index] done. Index is up to date and queryable.');
}

main().catch((err) => {
  console.error('[rag-index] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
