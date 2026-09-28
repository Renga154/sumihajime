import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatResponseSchema } from '@tmn/schemas';
import { RAG_MUNICIPALITIES, buildChunkManifest, loadApprovedHtmlSources } from '@tmn/rag-index';
import { assertDatasetShape, parseDataset } from './cases.js';
import { scoreCase } from './scoring.js';
import { renderReport } from './report.js';
import type { ApiOutcome, CaseResult, EvalCase, EvalReportData, RunMeta } from './types.js';

/**
 * なぜ: T-014 評価ハーネスCLI。本番 /api/chat に**直列・7秒間隔**でアクセスし(レート制限
 * 10req/分の遵守)、各ケースを機械採点して JSON + Markdown を出力する。評価以外のリクエストは
 * 投げない。質問・回答は評価成果物には残るが本番ログには残らない(APIがログしない設計)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const DEFAULT_ENDPOINT = 'https://app.sumihajime.workers.dev/api/chat';
const DEFAULT_SPACING_MS = 7_000; // 10req/分=1req/6秒。余裕を見て7秒。
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = 65_000;
/** 応答が無かったケースを最後に取り直す回数(下の main 参照)。 */
const MAX_ERROR_RETRIES = 2;
// なぜ: レポート成果物名は実行日付(rag-eval-YYYY-MM-DD.md)にする。過去日で固定すると
// 再実行が歴史記録(例: 初回7/23レポート)を上書きしてしまう。EVAL_REPORT_DATE で明示上書き可。
// 日付は日本時間で取る(UTC だと深夜〜朝9時の実行が前日名になり、前日の記録を上書きした。2026-09-26)。
const REPORT_DATE =
  process.env.EVAL_REPORT_DATE ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());

/** 既にある記録を上書きしない: 同名があれば -2, -3 … を付ける。 */
function freshPath(dir: string, stem: string, ext: string): string {
  let path = resolve(dir, `${stem}${ext}`);
  for (let n = 2; existsSync(path); n++) path = resolve(dir, `${stem}-${n}${ext}`);
  return path;
}

interface Args {
  endpoint: string;
  spacingMs: number;
  dry: boolean;
  outMd: string;
  outJson: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  return {
    endpoint: get('--endpoint') ?? process.env.EVAL_ENDPOINT ?? DEFAULT_ENDPOINT,
    spacingMs: Number(get('--spacing') ?? process.env.EVAL_SPACING_MS ?? DEFAULT_SPACING_MS),
    dry: argv.includes('--dry-run'),
    outMd:
      get('--out') ??
      freshPath(resolve(repoRoot, 'docs/research'), `rag-eval-${REPORT_DATE}`, '.md'),
    outJson:
      get('--out-json') ??
      freshPath(resolve(repoRoot, 'docs/research'), `rag-eval-${REPORT_DATE}`, '.result.json'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 生成した成果物を prettier で整形(best-effort。解決できなければ警告のみで継続)。 */
function formatOutputs(paths: string[]): void {
  const bin = resolve(repoRoot, 'node_modules/.bin/prettier');
  if (!existsSync(bin)) return;
  try {
    execFileSync(bin, ['--write', ...paths], { stdio: 'ignore' });
  } catch (err) {
    console.warn(`  prettier整形をスキップ(手動で pnpm format を実行してください): ${String(err)}`);
  }
}

/** 1ケースを1回POSTして生の結果を返す(429時は1回だけ長めのバックオフ後に再試行)。 */
async function callChat(endpoint: string, c: EvalCase, allowRetry = true): Promise<ApiOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ municipalityCode: c.municipalityCode, question: c.question }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    const status = res.status;
    let bodyJson: unknown;
    try {
      bodyJson = await res.json();
    } catch {
      bodyJson = undefined;
    }

    if (status === 429 && allowRetry) {
      clearTimeout(timer);
      console.warn(
        `  [${c.id}] 429 rate limited — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s and retrying once`,
      );
      await sleep(RATE_LIMIT_BACKOFF_MS);
      return callChat(endpoint, c, false);
    }

    if (status === 200) {
      const parsed = chatResponseSchema.safeParse(bodyJson);
      if (parsed.success) {
        return { httpStatus: status, latencyMs, response: parsed.data };
      }
      return {
        httpStatus: status,
        latencyMs,
        networkError: `200 but response failed schema: ${parsed.error.message.slice(0, 200)}`,
      };
    }

    // 非200: 構造化エラー(error.code)を拾う。
    const code =
      typeof bodyJson === 'object' && bodyJson !== null && 'error' in bodyJson
        ? (bodyJson as { error?: { code?: string } }).error?.code
        : undefined;
    return { httpStatus: status, latencyMs, errorCode: code };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      httpStatus: 0,
      latencyMs,
      networkError: aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function readRuleVersions(): string | null {
  const versions: string[] = [];
  // なぜ RAG_MUNICIPALITIES を使うか: 索引対象自治体が増えたときに列挙の更新漏れで
  // レポートのバージョン欄が実態とずれるのを防ぐ(23区化でハードコード5区が陳腐化した)。
  for (const code of RAG_MUNICIPALITIES) {
    const p = resolve(repoRoot, `packages/rules/data/${code}/rules.json`);
    if (!existsSync(p)) continue;
    try {
      const v = (JSON.parse(readFileSync(p, 'utf-8')) as { ruleVersion?: string }).ruleVersion;
      if (v) versions.push(`${code}:${v}`);
    } catch {
      /* best effort */
    }
  }
  return versions.length > 0 ? versions.join(' / ') : null;
}

function buildMeta(endpoint: string, spacingMs: number): RunMeta {
  const approvedHtmlSources: Record<string, number> = {};
  let approvedHtmlSourceTotal = 0;
  let indexedVectorCount: number | null = null;
  try {
    const sources = loadApprovedHtmlSources(repoRoot);
    for (const s of sources) {
      approvedHtmlSources[s.municipalityCode] = (approvedHtmlSources[s.municipalityCode] ?? 0) + 1;
    }
    approvedHtmlSourceTotal = sources.length;
    indexedVectorCount = buildChunkManifest(repoRoot).chunkCount;
  } catch (err) {
    console.warn(`  corpus meta 算出に失敗(レポートはN/Aで継続): ${String(err)}`);
  }
  return {
    endpoint,
    ranAt: new Date().toISOString(),
    spacingMs,
    timeoutMs: REQUEST_TIMEOUT_MS,
    approvedHtmlSources,
    approvedHtmlSourceTotal,
    indexedVectorCount,
    ruleVersion: readRuleVersions(),
    promptVersion: 'SYSTEM_PROMPT (packages/rag/src/prompt.ts, fixed)',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = resolve(repoRoot, 'data/evaluations/rag-eval-cases.json');
  const dataset = parseDataset(JSON.parse(readFileSync(datasetPath, 'utf-8')));
  assertDatasetShape(dataset);

  const meta = buildMeta(args.endpoint, args.spacingMs);
  console.log(`RAG eval — ${dataset.cases.length} cases against ${args.endpoint}`);
  console.log(
    `corpus: ${meta.approvedHtmlSourceTotal} approved-html sources, ${meta.indexedVectorCount ?? 'N/A'} vectors`,
  );
  console.log(`spacing: ${args.spacingMs / 1000}s serial (rate-limit 10req/min)\n`);

  if (args.dry) {
    console.log('--dry-run: dataset validated + corpus meta computed. No network calls made.');
    return;
  }

  const results: CaseResult[] = [];
  for (let idx = 0; idx < dataset.cases.length; idx++) {
    const c = dataset.cases[idx]!;
    const outcome = await callChat(args.endpoint, c);
    const result = scoreCase(c, outcome);
    results.push(result);
    const tag =
      result.status === 'pass'
        ? 'PASS'
        : result.status === 'needs_human_review'
          ? 'REVIEW'
          : result.status.toUpperCase();
    console.log(
      `[${idx + 1}/${dataset.cases.length}] ${c.id} (${c.municipalityCode}) → ${tag} ` +
        `abstained=${result.abstained} cites=${result.citationSourceIds.length} ${result.latencyMs}ms` +
        (result.failReasons.length ? `\n    ! ${result.failReasons.join('; ')}` : '') +
        (result.reviewFlags.length ? `\n    ~ review: ${result.reviewFlags.join(', ')}` : ''),
    );
    if (idx < dataset.cases.length - 1) await sleep(args.spacingMs);
  }

  // なぜ: 応答そのものが得られなかったケース(error)だけを、最後にまとめて再試行する。
  // 2026-09-26〜27 の実行では、実行端末がスリープしてタイマーが止まり、数分〜17分止まった
  // 要求が大量に error になった(本番は健全だった)。これは評価の対象ではなく計測側の失敗なので
  // 取り直す。fail / 要レビューは答えが返ってきた結果なので、再試行で上書きしない。
  for (let round = 1; round <= MAX_ERROR_RETRIES; round++) {
    const pending = results.flatMap((r, i) => (r.status === 'error' ? [i] : []));
    if (pending.length === 0) break;
    console.log(
      `\n[retry ${round}/${MAX_ERROR_RETRIES}] ${pending.length} case(s) got no response; retrying…`,
    );
    for (const i of pending) {
      await sleep(args.spacingMs);
      const c = dataset.cases[i]!;
      const retried = scoreCase(c, await callChat(args.endpoint, c));
      results[i] = retried;
      console.log(`  ${c.id} → ${retried.status.toUpperCase()} ${retried.latencyMs}ms`);
    }
  }

  const reportData: EvalReportData = { dataset, meta, results };
  const md = renderReport(reportData);
  writeFileSync(args.outMd, md, 'utf-8');
  writeFileSync(args.outJson, JSON.stringify(reportData, null, 2), 'utf-8');

  // なぜ: 生成物は docs/ 配下でCIの format:check 対象。書き出し後に整形して常にゲート適合に保つ
  // (renderReport/JSON.stringify は prettier 準拠を保証しないため)。prettier未解決でも致命ではない。
  formatOutputs([args.outMd, args.outJson]);

  console.log(`\nMarkdown report: ${args.outMd}`);
  console.log(`JSON result:     ${args.outJson}`);

  const fails = results.filter((r) => r.status === 'fail').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const contamination = results.reduce((n, r) => n + r.contaminationCount, 0);
  console.log(`\nfail=${fails} error=${errors} contamination=${contamination}`);
  // 非0終了は「重大障害」(混入>0)のみ。fail/reviewは正常終了(レポートに集約)。
  process.exitCode = contamination > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('eval run failed:', err);
  process.exitCode = 2;
});
