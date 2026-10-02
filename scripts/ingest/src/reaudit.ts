import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPageUpdatedOn } from '@tmn/drift';
import { findCurrentSnapshot, resolveInside, snapshotFileName } from '@tmn/publish';
import { parseIdList, parseReauditArgs, planApply } from './reaudit-apply.js';
import { decodeBuffer } from './encoding.js';
import { fetchOfficial } from './http.js';
import { extractTextLines } from './html.js';
import { checkFacts, isDateOnlyLine, type FactPresence } from './reaudit-core.js';
import {
  columnIndex,
  readRegistryTable,
  rowToRecord,
  tableToRecords,
  writeRegistryTable,
} from './registry.js';
import { tokyoToday } from './dates.js';

/**
 * 再監査(ADR-014 で「再確認中」になったソースを人が確かめ直す)の道具。手順は docs/ops/reaudit.md。
 *
 *   report: 指定ソースを再取得し、承認時の原文との差分・公開文言の数の事実の有無・引用している
 *           手続きをまとめた報告(Markdown)と、apply 用の結果(JSON)を --out に書く。
 *           リポジトリには何も書かない(取得した原文も --out に置くだけ)。
 *   apply:  人が承認したソースだけ、report で取得した**そのバイト列**を版付きスナップショットとして
 *           保存し、台帳(ハッシュ・ページ更新日・取得日・最終確認日・注記)を更新する。
 *           レビューしたものと保存するものが食い違わないよう、再取得はしない。
 *
 * 使い方:
 *   pnpm --filter @tmn/ingest reaudit report --ids src-a,src-b --out <dir>
 *   pnpm --filter @tmn/ingest reaudit apply --result <dir>/result.json --ids src-a,src-b --approval "<承認の出どころ>"
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const DIFF_LINE_CAP = 40;

interface SourceResult {
  sourceId: string;
  municipalityCode: string;
  sourceType: string;
  url: string;
  fetched: boolean;
  error?: string;
  status?: number;
  /** 転送を辿った後に本文を読んだ URL(台帳の URL と違えば、人が転送先を確かめる材料)。 */
  finalUrl?: string;
  newFile?: string;
  newSha256?: string;
  oldPageUpdatedOn?: string | null;
  newPageUpdatedOn?: string | null;
  removed: string[];
  added: string[];
  dateOnlyChanges: number;
  facts: FactPresence[];
  citedBy: string[];
  suggestion: 'unchanged' | 'date-only' | 'no-fact-loss' | 'fact-lost' | 'fetch-failed';
}

interface Citation {
  label: string;
  texts: string[];
}

/** そのソースを根拠に持つ手続き(正規化データ)とルールの、利用者に見える文言を集める。 */
function collectCitations(sourceId: string): Citation[] {
  const out: Citation[] = [];
  const normDir = resolve(repoRoot, 'data/normalized');
  for (const muni of readdirSync(normDir)) {
    const p = resolve(normDir, muni, 'procedures.json');
    if (!existsSync(p)) continue;
    const doc = JSON.parse(readFileSync(p, 'utf-8')) as { procedures: Record<string, unknown>[] };
    for (const proc of doc.procedures) {
      if (!(proc.sourceIds as string[] | undefined)?.includes(sourceId)) continue;
      const texts = [
        proc.title,
        proc.shortDescription,
        proc.applicabilityReason,
        proc.dueDescription,
        ...((proc.requiredDocuments as { label: string }[] | undefined) ?? []).map((d) => d.label),
        ...((proc.cautions as string[] | undefined) ?? []),
      ].filter((t): t is string => typeof t === 'string' && t.length > 0);
      out.push({ label: `${muni}/${String(proc.id)}`, texts });
    }
    const r = resolve(repoRoot, 'packages/rules/data', muni, 'rules.json');
    if (!existsSync(r)) continue;
    const rules = JSON.parse(readFileSync(r, 'utf-8')) as { rules: Record<string, unknown>[] };
    for (const rule of rules.rules) {
      if (!(rule.sourceIds as string[] | undefined)?.includes(sourceId)) continue;
      const due = rule.dueRule as Record<string, unknown> | undefined;
      const texts = [rule.dueDescription, rule.applicabilityReasonTemplate].filter(
        (t): t is string => typeof t === 'string' && t.length > 0,
      );
      // 期限ルールの日数も事実として照合する(日付を出している根拠そのもの)。
      if (due && typeof due.days === 'number') texts.push(`${due.days}日`);
      out.push({ label: `${muni}/rule:${String(rule.procedureId)}`, texts });
    }
  }
  return out;
}

async function report(args: Record<string, string>): Promise<void> {
  if (!args.out) throw new Error('report: --ids と --out が必要です');
  const ids = parseIdList(args.ids);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const records = new Map(
    tableToRecords(readRegistryTable(repoRoot)).map((r) => [r.source_id!, r]),
  );

  const results: SourceResult[] = [];
  for (const sourceId of ids) {
    const rec = records.get(sourceId);
    if (!rec) throw new Error(`registry に無いソース: ${sourceId}`);
    const muni = rec.municipality_code ?? '';
    const type = rec.source_type ?? 'html';
    const citations = collectCitations(sourceId);
    const base: SourceResult = {
      sourceId,
      municipalityCode: muni,
      sourceType: type,
      url: rec.source_url ?? '',
      fetched: false,
      removed: [],
      added: [],
      dateOnlyChanges: 0,
      facts: [],
      citedBy: citations.map((c) => c.label),
      suggestion: 'fetch-failed',
    };

    // 台帳の自治体コード・種別・ID からパスを組み立てる(値の形と基準ディレクトリ内に
    // 収まることを snapshot-files が確かめる)。
    const oldPath = findCurrentSnapshot(repoRoot, muni, sourceId, type);
    const oldBytes = oldPath ? new Uint8Array(readFileSync(oldPath)) : new Uint8Array();

    let res;
    try {
      res = await fetchOfficial(base.url, { timeoutMs: 30_000 });
    } catch (err) {
      results.push({ ...base, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (res.status !== 200) {
      results.push({ ...base, status: res.status, error: `HTTP ${res.status}` });
      continue;
    }
    const newFile = resolveInside(outDir, snapshotFileName(sourceId, type));
    writeFileSync(newFile, res.bytes);
    const sha = createHash('sha256').update(res.bytes).digest('hex');

    const oldText = decodeBuffer(oldBytes).text;
    const newText = decodeBuffer(res.bytes).text;
    const oldLines = type === 'html' ? extractTextLines(oldText) : oldText.split(/\r?\n/);
    const newLines = type === 'html' ? extractTextLines(newText) : newText.split(/\r?\n/);
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removedAll = [...new Set(oldLines.filter((l) => !newSet.has(l)))];
    const addedAll = [...new Set(newLines.filter((l) => !oldSet.has(l)))];
    const isDate = (l: string) => isDateOnlyLine(l);
    const dateOnlyChanges = removedAll.filter(isDate).length + addedAll.filter(isDate).length;
    const removed = removedAll.filter((l) => !isDate(l));
    const added = addedAll.filter((l) => !isDate(l));
    const facts = checkFacts(
      citations.flatMap((c) => c.texts),
      oldLines.join('\n'),
      newLines.join('\n'),
    );
    const lost = facts.some((f) => f.inOld && !f.inNew);
    const suggestion: SourceResult['suggestion'] =
      removedAll.length + addedAll.length === 0
        ? 'unchanged'
        : removed.length + added.length === 0
          ? 'date-only'
          : lost
            ? 'fact-lost'
            : 'no-fact-loss';

    results.push({
      ...base,
      fetched: true,
      status: res.status,
      finalUrl: res.finalUrl,
      newFile,
      newSha256: sha,
      oldPageUpdatedOn: type === 'html' ? extractPageUpdatedOn(oldText) : null,
      newPageUpdatedOn: type === 'html' ? extractPageUpdatedOn(newText) : null,
      removed,
      added,
      dateOnlyChanges,
      facts,
      suggestion,
    });
    // 自治体サイトへの配慮(連続アクセスを避ける)。
    await new Promise((r) => setTimeout(r, 800));
  }

  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(results, null, 2));
  writeFileSync(resolve(outDir, 'report.md'), renderReport(results));
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.suggestion] = (acc[r.suggestion] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[reaudit] ${results.length} sources →`, counts);
  console.log(`[reaudit] report: ${resolve(outDir, 'report.md')}`);
}

function renderReport(results: SourceResult[]): string {
  const lines: string[] = ['# 再監査レポート', '', `作成: ${tokyoToday()}`, ''];
  lines.push(
    '| ソース | 機械の見立て | 更新日 | 差分(行) | 消えた事実 |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const r of results) {
    const lost = r.facts.filter((f) => f.inOld && !f.inNew).map((f) => f.fact);
    lines.push(
      `| ${r.sourceId} | ${r.suggestion} | ${r.oldPageUpdatedOn ?? '-'} → ${r.newPageUpdatedOn ?? '-'} | -${r.removed.length} +${r.added.length}（更新日のみ ${r.dateOnlyChanges}） | ${lost.join(', ') || '-'} |`,
    );
  }
  for (const r of results) {
    lines.push(
      '',
      `## ${r.sourceId}`,
      '',
      `- URL: ${r.url}`,
      ...(r.finalUrl && r.finalUrl !== r.url ? [`- 転送後のURL: ${r.finalUrl}`] : []),
      `- 引用: ${r.citedBy.join(', ') || '(なし)'}`,
    );
    if (!r.fetched) {
      lines.push(`- **取得失敗**: ${r.error ?? ''}`);
      continue;
    }
    const facts = r.facts.map(
      (f) =>
        `${f.fact}${f.inOld ? '' : '(元から原文に無い)'}${f.inOld && !f.inNew ? ' **← 消えた**' : ''}`,
    );
    lines.push(`- 公開文言の数の事実: ${facts.join(' / ') || '(なし)'}`);
    if (r.removed.length > 0) {
      lines.push('', '消えた行:');
      for (const l of r.removed.slice(0, DIFF_LINE_CAP)) lines.push(`  - ${l.slice(0, 200)}`);
      if (r.removed.length > DIFF_LINE_CAP)
        lines.push(`  - …ほか ${r.removed.length - DIFF_LINE_CAP} 行`);
    }
    if (r.added.length > 0) {
      lines.push('', '増えた行:');
      for (const l of r.added.slice(0, DIFF_LINE_CAP)) lines.push(`  + ${l.slice(0, 200)}`);
      if (r.added.length > DIFF_LINE_CAP)
        lines.push(`  + …ほか ${r.added.length - DIFF_LINE_CAP} 行`);
    }
  }
  return lines.join('\n') + '\n';
}

function apply(args: Record<string, string>): void {
  if (!args.result || !args.approval) {
    throw new Error('apply: --result と --ids と --approval(承認の出どころ)が必要です');
  }
  // 承認の出どころは台帳の notes(1セル)へ書く。改行・制御文字で行や列を崩させない。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(args.approval)) {
    throw new Error('apply: --approval に改行・制御文字は使えません');
  }
  const ids = parseIdList(args.ids);
  const today = tokyoToday();
  const stamp = today.replace(/-/g, '');
  const table = readRegistryTable(repoRoot);
  const col = (n: string) => columnIndex(table, n);

  // 全件を検証してから書く(途中で失敗して一部だけ取り込まれた状態を作らない)。
  const plan = planApply({ repoRoot, resultPath: args.result, ids, registry: table, stamp });
  for (const item of plan) {
    if (existsSync(item.outPath)) {
      throw new Error(`${item.outPath} は既にある(スナップショットは上書きしない)`);
    }
  }

  for (const item of plan) {
    mkdirSync(dirname(item.outPath), { recursive: true });
    // 'wx': 既存なら失敗(上書きしない)。O_EXCL なので、置かれた symlink を辿って外へ書くこともない。
    writeFileSync(item.outPath, item.bytes, { flag: 'wx' });

    const row = table.rows.find(
      (row) => rowToRecord(table.header, row).source_id === item.sourceId,
    );
    if (!row) throw new Error(`registry に無い: ${item.sourceId}`);
    row[col('content_hash')] = item.newSha256;
    row[col('last_fetched_at')] = today;
    row[col('last_verified_at')] = today;
    if (item.newPageUpdatedOn) row[col('source_last_modified_at')] = item.newPageUpdatedOn;
    const note = `${today} 再監査(公式ソースの定期巡回が検知): ${args.approval}`;
    const prev = row[col('notes')] ?? '';
    row[col('notes')] = prev ? `${prev} ${note}` : note;
    console.log(`[reaudit] applied ${item.sourceId} → ${item.outPath.replace(repoRoot + '/', '')}`);
  }
  writeRegistryTable(repoRoot, table);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseReauditArgs(rest);
if (cmd === 'report') {
  await report(args);
} else if (cmd === 'apply') {
  apply(args);
} else {
  console.log(
    'usage: reaudit report --ids a,b --out <dir> | reaudit apply --result <json> --ids a,b --approval "<text>"',
  );
  process.exitCode = 1;
}
