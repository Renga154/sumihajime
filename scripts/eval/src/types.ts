import type { ChatResponse } from '@tmn/schemas';

/**
 * なぜ: T-014 評価データセット/採点/レポートで共有する型。UI・APIとは独立した評価専用の
 * 契約(dataset JSON の形状 と 機械採点の結果 と 実行メタ)をここに集約する。
 */

export type CaseKind = 'positive' | 'abstain' | 'cross';

/** true=保留必須, false=非保留必須, 'either'=越境で「保留 or 自区限定の回答」どちらも可。 */
export type AbstainExpectation = boolean | 'either';

export interface CaseExpect {
  abstain: AbstainExpectation;
  /** いずれか1つ以上が citations に現れれば retrieval hit(正答系のみ)。 */
  expectedSourceIds: string[];
  /** 回答本文に全て含まれるべき公式文言由来のキーフレーズ(正答系のみ)。 */
  answerMustInclude: string[];
  /** これらの接頭辞で始まる sourceId を引用したら自治体混入(越境系で明示)。 */
  forbiddenSourcePrefixes: string[];
}

export interface EvalCase {
  id: string;
  kind: CaseKind;
  municipalityCode: string;
  question: string;
  expect: CaseExpect;
  rationale: string;
}

export interface EvalDataset {
  datasetVersion: string;
  generatedFor: string;
  description: string;
  corpus: {
    municipalities: string[];
    indexedSourceType: string;
    note: string;
  };
  scoring: Record<string, string>;
  cases: EvalCase[];
}

/**
 * 1ケースを本番 /api/chat へ投げた生の結果。response は 200(ChatResponse)時のみ。
 * 非2xx時は errorCode を、ネットワーク失敗時は networkError を持つ。
 */
export interface ApiOutcome {
  httpStatus: number;
  latencyMs: number;
  response?: ChatResponse;
  errorCode?: string;
  networkError?: string;
  /** 応答が名乗った回答モデル(API が返したときだけ。model.ts の extractModel)。 */
  model?: string | null;
}

export interface CheckResults {
  /** JSON応答に到達したか(200 ChatResponse または構造化エラー)。false=ネットワーク/インフラ障害。 */
  reachedApi: boolean;
  /** 保留期待との一致(該当しない場合 null)。 */
  abstainMatch: boolean | null;
  /** expectedSourceIds のいずれかが引用されたか(正答系のみ、else null)。 */
  retrievalHit: boolean | null;
  /** answerMustInclude を全て含むか(非保留の正答系のみ、else null)。 */
  answerIncludes: boolean | null;
  /** 非保留応答の citations が完全(title/url/lastVerifiedAt 充足・件数≥1)か(else null)。 */
  citationCompleteness: boolean | null;
  /** 非保留なのに citations=0(根拠なし断定)でないか(else null)。 */
  noUnsupportedClaim: boolean | null;
  /** 全 citation が src-{municipalityCode}- で始まる(自治体分離)か。常に適用。 */
  isolationOk: boolean;
}

export type CaseStatus = 'pass' | 'fail' | 'error' | 'needs_human_review';

export interface CaseResult {
  id: string;
  kind: CaseKind;
  municipalityCode: string;
  question: string;
  httpStatus: number;
  latencyMs: number;
  abstained: boolean | null;
  answer: string | null;
  citationSourceIds: string[];
  checks: CheckResults;
  /** src-{municipalityCode}- 以外を引用した件数(=自治体混入数)。 */
  contaminationCount: number;
  /** answerMustInclude に無い日数・期限表現(要人手レビュー)。 */
  reviewFlags: string[];
  status: CaseStatus;
  failReasons: string[];
  /** 回答したモデル(API が返したときだけ。返さなければ null)。古い結果 JSON には無い。 */
  model?: string | null;
}

export interface RunMeta {
  endpoint: string;
  ranAt: string;
  spacingMs: number;
  timeoutMs: number;
  /** registry.csv の承認済みHTMLソース数(自治体別)。 */
  approvedHtmlSources: Record<string, number>;
  approvedHtmlSourceTotal: number;
  /** 実際に索引されるチャンク(=Vectorizeベクトル)数。manifestから算出。 */
  indexedVectorCount: number | null;
  ruleVersion: string | null;
  promptVersion: string | null;
  /**
   * 実行中に API の応答が名乗った回答モデル(重複なし)。空なら API が model を返していない。
   * なぜ: モデルの差し替え・既定値の変更(モデルドリフト)で結果が動いたときに切り分けるため。
   */
  models?: string[];
}

export interface EvalReportData {
  dataset: EvalDataset;
  meta: RunMeta;
  results: CaseResult[];
}
