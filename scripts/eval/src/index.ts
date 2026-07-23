// @tmn/rag-eval — RAG評価ハーネス(T-014)。純ロジック(採点/集計/レポート/データセット読込)を
// 再利用・テスト用にエクスポートする。run.ts が本番エンドポイントへ直列実行するCLIエントリ。

export { parseDataset, assertDatasetShape } from './cases.js';
export {
  scoreCase,
  summarize,
  decideRelease,
  extractDeadlineExpressions,
  reviewFlagsFor,
  contaminatingSourceIds,
  type Summary,
  type ReleaseDecision,
} from './scoring.js';
export { renderReport, groupFailuresByRootCause } from './report.js';
export type {
  EvalCase,
  EvalDataset,
  ApiOutcome,
  CaseResult,
  CaseStatus,
  CheckResults,
  RunMeta,
  EvalReportData,
} from './types.js';
