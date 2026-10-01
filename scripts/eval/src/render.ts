import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from './report.js';
import type { EvalReportData } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/**
 * なぜ: 保存済みの実行結果(*.result.json)からMarkdownレポートだけを再生成するCLI。
 * renderReport はI/Oなしの純関数だが、これまでレポートを作り直す唯一の経路が
 * run.ts(本番 /api/chat と OpenAI を実際に叩く)しかなく、レポートの表示だけを直したいとき
 * (例: レポート様式の不具合修正)にも過去の実測を再実行する必要があった。評価対象は
 * 不変(過去の生の応答)のまま整形だけ更新できるよう、この読み取り専用パスを分離する。
 *
 * 使い方:
 *   pnpm --filter @tmn/rag-eval render -- docs/research/rag-eval-2026-09-28.result.json
 *   (既定の出力先は同名の .md。--out で明示指定も可)
 */
function parseArgs(argv: string[]): { jsonPath: string; outPath: string } {
  const jsonPath = argv[0];
  if (!jsonPath) {
    console.error('usage: render.ts <result.json> [--out <path.md>]');
    process.exit(1);
  }
  const outIdx = argv.indexOf('--out');
  const outArg = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  const outPath = outArg ?? jsonPath.replace(/\.result\.json$/, '.md');
  return { jsonPath: resolve(jsonPath), outPath: resolve(outPath) };
}

/**
 * 生成したMarkdownを prettier で整形する(best-effort)。renderReport は文字列連結のみで
 * prettier 準拠を保証しないため、docs/ 配下の format:check ゲートに通すには必要
 * (run.ts の formatOutputs と同じ理由)。
 */
function formatOutput(path: string): void {
  const bin = resolve(repoRoot, 'node_modules/.bin/prettier');
  if (!existsSync(bin)) return;
  try {
    // path は parseArgs で絶対パス化済み。念のため `--` でオプションの終わりを明示する。
    execFileSync(bin, ['--write', '--', path], { stdio: 'ignore' });
  } catch (err) {
    console.warn(`  prettier整形をスキップ(手動で pnpm format を実行してください): ${String(err)}`);
  }
}

function main(): void {
  const { jsonPath, outPath } = parseArgs(process.argv.slice(2));
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as EvalReportData;
  const md = renderReport(data);
  writeFileSync(outPath, md, 'utf-8');
  formatOutput(outPath);
  console.log(`Markdown report: ${outPath}`);
}

main();
