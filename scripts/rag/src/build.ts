import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedText } from '@tmn/rag';
import {
  RAG_MUNICIPALITY,
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
const DB_NAME = 'tokyo-move-navi';
const INDEX_NAME = 'tokyo-move-navi-rag';

/** OPENAI_API_KEY を env → apps/api/.dev.vars の順で探す(値はechoしない)。 */
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

  const manifest = buildChunkManifest(repoRoot);
  console.log(
    `[rag-index] built ${manifest.chunkCount} chunks from ${manifest.sourceCount} approved HTML sources (municipality ${RAG_MUNICIPALITY}).`,
  );

  const outDir = resolve(repoRoot, `data/rag/${RAG_MUNICIPALITY}`);
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

  console.log(`[rag-index] seeding D1 rag_chunks (${dbTarget})…`);
  execFileSync(wranglerBin, ['d1', 'execute', DB_NAME, dbTarget, '--file', sqlPath], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  // Vectorize は常にリモート(ローカル模擬なし)。upsert で冪等に差し替える。
  console.log('[rag-index] upserting vectors into Vectorize (remote)…');
  execFileSync(wranglerBin, ['vectorize', 'upsert', INDEX_NAME, '--file', ndjsonPath], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  console.log('[rag-index] done. Vectors are queryable after ~5-10s.');
}

main().catch((err) => {
  console.error('[rag-index] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
