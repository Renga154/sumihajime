import type { CaseResult, EvalReportData } from './types.js';
import { decideRelease, summarize, type Summary } from './scoring.js';

/**
 * なぜ: rag-evalスキルの様式(corpus/index/prompt版・総ケース数・retrieval hit rate・citation
 * correctness・unsupported claim・自治体混入数・保留適切率・レイテンシ分布・失敗の根本原因分類・
 * release recommendation)に沿った Markdown を純関数で生成する(I/Oなし=テスト可能)。
 */

function pct(v: number | null): string {
  return v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`;
}

function statusEmoji(s: CaseResult['status']): string {
  return s === 'pass' ? '✅' : s === 'fail' ? '❌' : s === 'needs_human_review' ? '🔶' : '⚠️';
}

/** 失敗を根本原因で分類する(rag-evalスキル: 個別例でなく一般原因で束ねる)。 */
export function groupFailuresByRootCause(results: CaseResult[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const add = (cause: string, id: string) => {
    const arr = groups.get(cause) ?? [];
    arr.push(id);
    groups.set(cause, arr);
  };
  for (const r of results) {
    if (r.status !== 'fail' && r.status !== 'error') continue;
    for (const reason of r.failReasons) {
      const cause = reason.split(':')[0]!.trim();
      add(cause, r.id);
    }
  }
  return groups;
}

function summaryTable(s: Summary): string {
  const rows = [
    `| 指標 | 値 | §12閾値 |`,
    `| --- | --- | --- |`,
    `| 総ケース数 | ${s.total} | 30 |`,
    `| pass / fail / 要レビュー / error | ${s.pass} / ${s.fail} / ${s.needsHumanReview} / ${s.error} | — |`,
    `| retrieval hit rate(正答系) | ${pct(s.retrievalHitRate)} | 高いほど良 |`,
    `| 正自治体出典率(正答系・非保留) | ${pct(s.correctMunicipalitySourceRate)} | **100%** |`,
    `| citation 整合率(非保留回答) | ${pct(s.citationCorrectnessRate)} | 高いほど良 |`,
    `| unsupported claim(自動検出) | ${s.unsupportedClaimAutoCount} | **0** |`,
    `| 自治体混入数(全ケース) | ${s.contaminationTotal} | **0** |`,
    `| 保留適切率(保留系+未対応) | ${pct(s.abstentionAppropriateRate)} | 高いほど良 |`,
    `| レイテンシ p50 / p95 | ${s.latency.p50}ms / ${s.latency.p95}ms | p95 **≤8000ms** |`,
    `| レイテンシ min / max | ${s.latency.min}ms / ${s.latency.max}ms | — |`,
  ];
  return rows.join('\n');
}

export function renderReport(data: EvalReportData): string {
  const { dataset, meta, results } = data;
  const s = summarize(results);
  const release = decideRelease(s);
  const failGroups = groupFailuresByRootCause(results);

  const lines: string[] = [];
  lines.push(`# RAG評価レポート — T-014`);
  lines.push('');
  lines.push(`- 実行日時(UTC): ${meta.ranAt}`);
  lines.push(`- 対象エンドポイント: \`${meta.endpoint}\``);
  lines.push(
    `- データセット: \`data/evaluations/rag-eval-cases.json\` v${dataset.datasetVersion}(${dataset.generatedFor})`,
  );
  lines.push(
    `- 実行方式: 直列・${meta.spacingMs / 1000}秒間隔(本番レート制限10req/分の遵守)、タイムアウト${meta.timeoutMs / 1000}秒`,
  );
  lines.push('');

  lines.push(`## 1. corpus / index / prompt バージョン`);
  lines.push('');
  const MUNI_NAMES: Record<string, string> = {
    '13112': '世田谷',
    '13108': '江東',
    '13104': '新宿',
    '13115': '杉並',
    '13101': '千代田',
  };
  const muniLabel = dataset.corpus.municipalities.map((c) => MUNI_NAMES[c] ?? c).join('・');
  lines.push(`- 索引対象自治体: ${dataset.corpus.municipalities.join(' / ')}(${muniLabel})`);
  lines.push(`- 索引ソース種別: ${dataset.corpus.indexedSourceType}(CSVソースは未索引=コーパス外)`);
  const srcRows = Object.entries(meta.approvedHtmlSources)
    .map(([code, n]) => `${code}=${n}`)
    .join(' / ');
  lines.push(`- registry 承認済みHTMLソース: 計${meta.approvedHtmlSourceTotal}件(${srcRows})`);
  lines.push(
    `- 索引ベクトル数(manifestから算出): ${meta.indexedVectorCount === null ? 'N/A(算出不可)' : meta.indexedVectorCount}`,
  );
  lines.push(
    `- ruleVersion: ${meta.ruleVersion ?? 'N/A'} / promptVersion: ${meta.promptVersion ?? 'SYSTEM_PROMPT(apps/api経由・固定)'}`,
  );
  lines.push(
    `- retrieval スコープ: Vectorize \`$eq municipalityCode\` + D1 \`rag_chunks.municipality_code\` の二重強制(§11.3)`,
  );
  lines.push('');

  lines.push(`## 2. サマリ指標`);
  lines.push('');
  lines.push(summaryTable(s));
  lines.push('');
  lines.push(`### 種別別`);
  lines.push('');
  lines.push(`| 種別 | 総数 | pass | fail | 要レビュー | error |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const kind of ['positive', 'abstain', 'cross'] as const) {
    const k = s.byKind[kind]!;
    lines.push(
      `| ${kind} | ${k.total} | ${k.pass} | ${k.fail} | ${k.needsHumanReview} | ${k.error} |`,
    );
  }
  lines.push('');

  lines.push(`## 3. 自治体混入(§11.3 重大)`);
  lines.push('');
  if (s.contaminationTotal === 0) {
    lines.push(
      `**混入 0 件。** 全 citation が問い合わせ先の区の \`src-{code}-\` 接頭辞に一致(自治体分離OK)。`,
    );
  } else {
    lines.push(
      `**混入 ${s.contaminationTotal} 件(重大障害)。** 以下のケースで他区ソースが引用された:`,
    );
    for (const r of results.filter((r) => r.contaminationCount > 0)) {
      lines.push(`- ${r.id}(${r.municipalityCode}): ${r.citationSourceIds.join(', ')}`);
    }
  }
  lines.push('');

  lines.push(`## 4. 要人手レビュー(期限表現の自動フラグ)`);
  lines.push('');
  lines.push(
    `非保留回答に answerMustInclude 以外の日数・期限表現が現れたもの。自動failにはせず、公式文言との整合を人手確認する。`,
  );
  lines.push('');
  if (s.reviewItems.length === 0) {
    lines.push(`- なし`);
  } else {
    for (const item of s.reviewItems) {
      const r = results.find((x) => x.id === item.id)!;
      lines.push(
        `- ${item.id}(${r.municipalityCode}): 未説明の期限表現 = [${item.flags.join(', ')}]`,
      );
    }
  }
  lines.push('');

  lines.push(`## 5. 失敗の根本原因分類`);
  lines.push('');
  if (failGroups.size === 0) {
    lines.push(`- fail / error なし`);
  } else {
    lines.push(`| 根本原因 | 該当ケース | 件数 |`);
    lines.push(`| --- | --- | --- |`);
    for (const [cause, ids] of failGroups) {
      lines.push(`| ${cause} | ${ids.join(', ')} | ${ids.length} |`);
    }
  }
  lines.push('');

  lines.push(`## 6. 全ケース結果`);
  lines.push('');
  lines.push(`| id | 種別 | 区 | 判定 | 保留 | 引用 | latency | 備考 |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of results) {
    const note =
      r.status === 'fail' || r.status === 'error'
        ? r.failReasons.join(' / ')
        : r.reviewFlags.length > 0
          ? `review: ${r.reviewFlags.join(', ')}`
          : '';
    const cites = r.citationSourceIds.length > 0 ? r.citationSourceIds.join(' ') : '—';
    lines.push(
      `| ${r.id} | ${r.kind} | ${r.municipalityCode} | ${statusEmoji(r.status)} ${r.status} | ${r.abstained === null ? '—' : r.abstained} | ${cites} | ${r.latencyMs}ms | ${note.replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push('');

  lines.push(`## 7. リリース判定`);
  lines.push('');
  lines.push(`**recommendation: ${release.recommendation.toUpperCase()}**`);
  lines.push('');
  for (const reason of release.reasons) lines.push(`- ${reason}`);
  lines.push('');
  lines.push(`### 必須チェック(rag-evalスキル)対応`);
  lines.push('');
  lines.push(`1. 期待出典の取得 → retrieval hit rate ${pct(s.retrievalHitRate)}`);
  lines.push(
    `2. 出典が選択自治体に属する → 混入 ${s.contaminationTotal} 件 / 正自治体出典率 ${pct(s.correctMunicipalitySourceRate)}`,
  );
  lines.push(
    `3. 回答が引用に裏付けられる → citation 整合率 ${pct(s.citationCorrectnessRate)} / unsupported ${s.unsupportedClaimAutoCount} 件`,
  );
  lines.push(
    `4. 期限・書類・窓口・要件を捏造しない → 自動検出 ${s.unsupportedClaimAutoCount} 件 + 要人手レビュー ${s.reviewItems.length} 件(§4欄)`,
  );
  lines.push(`5. 根拠欠落/範囲外で保留 → 保留適切率 ${pct(s.abstentionAppropriateRate)}`);
  lines.push(
    `6. 出典に title/owner/url/lastVerified を露出 → citation 整合率で検査(${pct(s.citationCorrectnessRate)})`,
  );
  lines.push(
    `7. 抜粋内インジェクションを無視 → SYSTEM_PROMPT規則4で強制(越境系X02–X05で自区外へ踏み込まないことを併せて確認)`,
  );
  lines.push(`8. レイテンシ/コスト → p95 ${s.latency.p95}ms(閾値8000ms)`);
  lines.push('');
  lines.push(
    `> 注記: 本評価は本番エンドポイントの実測1回分。rag-evalスキルの原則に従い、失敗は個別例へのチューニングではなく根本原因(§5)単位で対処し、修正後は全${dataset.cases.length}問を再実行すること。`,
  );
  lines.push('');

  return lines.join('\n');
}
