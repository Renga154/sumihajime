import type { ApiOutcome, CaseResult, CheckResults, EvalCase } from './types.js';

/**
 * なぜ: 機械採点は純関数に閉じ込め、fixtureで検証可能にする(T-014。rag-evalスキル「個別例に
 * チューニングしない」ため、判定ロジックはケース非依存の一般規則で書く)。ネットワークI/Oは
 * run.ts が持ち、ここには持ち込まない。
 */

/** 越境で out-of-scope とみなせるエラーコード(未対応/未登録自治体)。 */
const OUT_OF_SCOPE_ERROR_CODES = new Set(['municipality_not_supported', 'municipality_unknown']);

/**
 * 回答本文から「日数・期限・期間」表現を抽出する。answerMustInclude で説明されない表現が
 * 出た場合、根拠なし断定の疑い(=要人手レビュー)として拾うための補助。
 */
export function extractDeadlineExpressions(answer: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\d+\s*日(以内|以降|まで|後|前|間)?/g,
    /\d+\s*(か月|ヶ月|カ月|箇月)(以内|以降|まで|後)?/g,
    /\d+\s*週間(以内|以降|まで|後)?/g,
    /\d+\s*年(以内|以降|まで|後|度)?/g,
  ];
  for (const re of patterns) {
    for (const m of answer.matchAll(re)) out.add(m[0].replace(/\s+/g, ''));
  }
  return [...out];
}

/**
 * 期限表現のうち answerMustInclude で説明されない(=キーフレーズに含まれない)ものを返す。
 * 例: answerMustInclude=['14日'] で本文に '14日以内' と '30日' があれば '30日' のみフラグ。
 */
export function reviewFlagsFor(answer: string, answerMustInclude: string[]): string[] {
  const exprs = extractDeadlineExpressions(answer);
  return exprs.filter((ex) => !answerMustInclude.some((k) => k.length > 0 && ex.includes(k)));
}

/** citation.sourceId が自区(src-{code}-)以外なら混入。混入した sourceId 一覧を返す。 */
export function contaminatingSourceIds(
  citationSourceIds: string[],
  municipalityCode: string,
): string[] {
  const prefix = `src-${municipalityCode}-`;
  return citationSourceIds.filter((id) => !id.startsWith(prefix));
}

interface Interpreted {
  reachedApi: boolean;
  abstained: boolean | null;
  answer: string | null;
  citationSourceIds: string[];
  citationsComplete: boolean;
  outOfScopeError: boolean;
}

function interpret(outcome: ApiOutcome): Interpreted {
  if (outcome.response) {
    const r = outcome.response;
    const citationSourceIds = r.citations.map((c) => c.sourceId);
    const citationsComplete =
      r.citations.length > 0 &&
      r.citations.every(
        (c) =>
          c.sourceId.length > 0 &&
          c.title.length > 0 &&
          /^https?:\/\//.test(c.url) &&
          c.lastVerifiedAt.length > 0 &&
          c.ownerOrganization.length > 0,
      );
    return {
      reachedApi: true,
      abstained: r.abstained,
      answer: r.answer,
      citationSourceIds,
      citationsComplete,
      outOfScopeError: false,
    };
  }
  const outOfScopeError =
    outcome.errorCode !== undefined && OUT_OF_SCOPE_ERROR_CODES.has(outcome.errorCode);
  return {
    reachedApi: outOfScopeError, // 構造化された out-of-scope エラーは「到達」とみなす
    abstained: outOfScopeError ? true : null,
    answer: null,
    citationSourceIds: [],
    citationsComplete: false,
    outOfScopeError,
  };
}

/** 1ケースの機械採点。 */
export function scoreCase(evalCase: EvalCase, outcome: ApiOutcome): CaseResult {
  const i = interpret(outcome);
  const { municipalityCode, kind, expect } = evalCase;
  const nonAbstainAnswered = i.reachedApi && i.abstained === false;

  const contaminated = contaminatingSourceIds(i.citationSourceIds, municipalityCode);
  const isolationOk = contaminated.length === 0;

  const reviewFlags =
    nonAbstainAnswered && i.answer ? reviewFlagsFor(i.answer, expect.answerMustInclude) : [];

  // 各チェック(該当しないものは null)。
  const checks: CheckResults = {
    reachedApi: i.reachedApi,
    abstainMatch: null,
    retrievalHit: null,
    answerIncludes: null,
    citationCompleteness: null,
    noUnsupportedClaim: null,
    isolationOk,
  };

  const failReasons: string[] = [];

  if (!i.reachedApi) {
    // インフラ/ネットワーク障害。採点対象外(error)。
    return {
      id: evalCase.id,
      kind,
      municipalityCode,
      question: evalCase.question,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
      abstained: i.abstained,
      answer: i.answer,
      citationSourceIds: i.citationSourceIds,
      checks,
      contaminationCount: contaminated.length,
      reviewFlags,
      status: 'error',
      failReasons: [
        outcome.networkError ??
          `api_error(status=${outcome.httpStatus}, code=${outcome.errorCode ?? 'unknown'})`,
      ],
    };
  }

  // 自治体混入は種別を問わず最優先の重大fail。
  if (!isolationOk) {
    failReasons.push(`municipality_contamination: ${contaminated.join(', ')}`);
  }

  if (kind === 'positive') {
    checks.abstainMatch = i.abstained === false;
    checks.noUnsupportedClaim = !(i.abstained === false && i.citationSourceIds.length === 0);
    checks.citationCompleteness = i.abstained === false ? i.citationsComplete : null;
    checks.retrievalHit =
      i.abstained === false
        ? expect.expectedSourceIds.some((id) => i.citationSourceIds.includes(id))
        : false;
    checks.answerIncludes =
      i.abstained === false && i.answer
        ? expect.answerMustInclude.every((s) => i.answer!.includes(s))
        : false;

    if (checks.abstainMatch !== true) failReasons.push('expected non-abstain answer but abstained');
    if (checks.noUnsupportedClaim === false)
      failReasons.push('unsupported_claim: non-abstain answer with 0 citations');
    if (checks.retrievalHit !== true)
      failReasons.push(
        `retrieval_miss: none of [${expect.expectedSourceIds.join(', ')}] cited (got [${i.citationSourceIds.join(', ')}])`,
      );
    if (checks.answerIncludes !== true)
      failReasons.push(
        `answer_missing_phrase: expected all of [${expect.answerMustInclude.join(', ')}]`,
      );
    if (checks.citationCompleteness === false)
      failReasons.push('citation_incomplete: missing title/url/lastVerifiedAt/owner');
  } else if (kind === 'abstain') {
    checks.abstainMatch = i.abstained === true;
    if (checks.abstainMatch !== true) failReasons.push('expected abstain but system answered');
  } else {
    // cross
    if (expect.abstain === true) {
      // 未対応自治体など: 保留(or out-of-scope エラー)必須。
      checks.abstainMatch = i.abstained === true || i.outOfScopeError;
      if (checks.abstainMatch !== true)
        failReasons.push('expected out-of-scope abstain but system answered');
    } else {
      // 'either': 保留 or 自区限定の回答。混入0が本丸。
      if (i.abstained === true) {
        checks.abstainMatch = true;
      } else {
        // 回答したなら citations>0 かつ 自区限定(isolationで担保)。
        checks.abstainMatch = null;
        checks.noUnsupportedClaim = i.citationSourceIds.length > 0;
        checks.citationCompleteness = i.citationsComplete;
        if (checks.noUnsupportedClaim === false)
          failReasons.push('unsupported_claim: cross answer with 0 citations');
        if (checks.citationCompleteness === false)
          failReasons.push('citation_incomplete on cross answer');
      }
    }
    // 明示 forbidden 接頭辞(冗長だが仕様どおり検査)。
    const forbiddenHit = i.citationSourceIds.filter((id) =>
      expect.forbiddenSourcePrefixes.some((p) => id.startsWith(p)),
    );
    if (forbiddenHit.length > 0)
      failReasons.push(`forbidden_source_prefix: ${forbiddenHit.join(', ')}`);
  }

  const status: CaseResult['status'] =
    failReasons.length > 0 ? 'fail' : reviewFlags.length > 0 ? 'needs_human_review' : 'pass';

  return {
    id: evalCase.id,
    kind,
    municipalityCode,
    question: evalCase.question,
    httpStatus: outcome.httpStatus,
    latencyMs: outcome.latencyMs,
    abstained: i.abstained,
    answer: i.answer,
    citationSourceIds: i.citationSourceIds,
    checks,
    contaminationCount: contaminated.length,
    reviewFlags,
    status,
    failReasons,
  };
}

export interface Summary {
  total: number;
  pass: number;
  fail: number;
  needsHumanReview: number;
  error: number;
  byKind: Record<
    string,
    { total: number; pass: number; fail: number; needsHumanReview: number; error: number }
  >;
  /** 正答系: retrieval hit 率(reachedApi & 非保留のうち expectedSourceId命中)。 */
  retrievalHitRate: number | null;
  /** 正答系: 正自治体出典率(非保留回答のうち混入0)。§12閾値=100%。 */
  correctMunicipalitySourceRate: number | null;
  /** 非保留回答の citation 完全率。 */
  citationCorrectnessRate: number | null;
  /** 自治体混入 総数(全ケース)。§12閾値=0。 */
  contaminationTotal: number;
  /** 根拠なし断定(自動検出)件数。 */
  unsupportedClaimAutoCount: number;
  /** 保留系+X01 の適切保留率。 */
  abstentionAppropriateRate: number | null;
  /** 要人手レビュー(期限表現)ケースのidと表現。 */
  reviewItems: { id: string; flags: string[] }[];
  latency: { p50: number; p95: number; min: number; max: number; count: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function summarize(results: CaseResult[]): Summary {
  const emptyKind = () => ({ total: 0, pass: 0, fail: 0, needsHumanReview: 0, error: 0 });
  const byKind: Summary['byKind'] = {
    positive: emptyKind(),
    abstain: emptyKind(),
    cross: emptyKind(),
  };
  let pass = 0,
    fail = 0,
    needsHumanReview = 0,
    error = 0;
  for (const r of results) {
    const k = byKind[r.kind]!;
    k.total++;
    if (r.status === 'pass') {
      pass++;
      k.pass++;
    } else if (r.status === 'fail') {
      fail++;
      k.fail++;
    } else if (r.status === 'needs_human_review') {
      needsHumanReview++;
      k.needsHumanReview++;
    } else {
      error++;
      k.error++;
    }
  }

  const positives = results.filter((r) => r.kind === 'positive' && r.checks.reachedApi);
  const positiveAnswered = positives.filter((r) => r.abstained === false);
  const retrievalHitRate =
    positiveAnswered.length > 0
      ? positiveAnswered.filter((r) => r.checks.retrievalHit === true).length /
        positiveAnswered.length
      : positives.length > 0
        ? 0
        : null;
  const correctMunicipalitySourceRate =
    positiveAnswered.length > 0
      ? positiveAnswered.filter((r) => r.contaminationCount === 0).length / positiveAnswered.length
      : null;

  const allAnswered = results.filter((r) => r.checks.reachedApi && r.abstained === false);
  const citationCorrectnessRate =
    allAnswered.length > 0
      ? allAnswered.filter((r) => r.checks.citationCompleteness === true).length /
        allAnswered.length
      : null;

  const contaminationTotal = results.reduce((n, r) => n + r.contaminationCount, 0);
  const unsupportedClaimAutoCount = results.filter(
    (r) => r.checks.noUnsupportedClaim === false,
  ).length;

  const abstainScope = results.filter(
    (r) => (r.kind === 'abstain' || r.id.startsWith('X01')) && r.checks.reachedApi,
  );
  const abstentionAppropriateRate =
    abstainScope.length > 0
      ? abstainScope.filter((r) => r.checks.abstainMatch === true).length / abstainScope.length
      : null;

  const reviewItems = results
    .filter((r) => r.reviewFlags.length > 0)
    .map((r) => ({ id: r.id, flags: r.reviewFlags }));

  const latencies = results
    .filter((r) => r.checks.reachedApi && r.latencyMs > 0)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  const latency = {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    min: latencies[0] ?? 0,
    max: latencies[latencies.length - 1] ?? 0,
    count: latencies.length,
  };

  return {
    total: results.length,
    pass,
    fail,
    needsHumanReview,
    error,
    byKind,
    retrievalHitRate,
    correctMunicipalitySourceRate,
    citationCorrectnessRate,
    contaminationTotal,
    unsupportedClaimAutoCount,
    abstentionAppropriateRate,
    reviewItems,
    latency,
  };
}

export interface ReleaseDecision {
  recommendation: 'pass' | 'conditional' | 'fail';
  reasons: string[];
}

/**
 * §12の閾値: 正自治体出典率100% / 自治体混入0 / 保留適切率(高) / p95≤8秒 / retrieval hit 高。
 * 混入>0 または 正答系fail は fail。要人手レビューのみ・軽微な保留漏れは conditional。
 */
export function decideRelease(summary: Summary): ReleaseDecision {
  const reasons: string[] = [];
  let worstFail = false;
  let conditional = false;

  if (summary.error > 0) {
    conditional = true;
    reasons.push(
      `${summary.error} 件がインフラ/ネットワーク障害(採点不能)。再実行して確認が必要。`,
    );
  }
  if (summary.contaminationTotal > 0) {
    worstFail = true;
    reasons.push(`自治体混入 ${summary.contaminationTotal} 件(§12閾値=0)。重大障害。`);
  }
  if (summary.correctMunicipalitySourceRate !== null && summary.correctMunicipalitySourceRate < 1) {
    worstFail = true;
    reasons.push(
      `正自治体出典率 ${(summary.correctMunicipalitySourceRate * 100).toFixed(1)}%(§12閾値=100%)。`,
    );
  }
  if (summary.unsupportedClaimAutoCount > 0) {
    worstFail = true;
    reasons.push(
      `根拠なし断定(citations=0の非保留) ${summary.unsupportedClaimAutoCount} 件(§12閾値=0)。`,
    );
  }
  if (summary.byKind.positive!.fail > 0) {
    worstFail = true;
    reasons.push(
      `正答系 fail ${summary.byKind.positive!.fail} 件(retrieval/キーフレーズ/引用整合の不備)。`,
    );
  }
  if (summary.byKind.abstain!.fail > 0 || summary.byKind.cross!.fail > 0) {
    conditional = true;
    reasons.push(
      `保留/越境系 fail ${summary.byKind.abstain!.fail + summary.byKind.cross!.fail} 件(保留漏れ)。`,
    );
  }
  if (summary.latency.p95 > 8000) {
    worstFail = true;
    reasons.push(`p95 レイテンシ ${summary.latency.p95}ms(§12閾値=8000ms)。`);
  }
  if (summary.needsHumanReview > 0) {
    conditional = true;
    reasons.push(`要人手レビュー ${summary.needsHumanReview} 件(期限表現の確認)。`);
  }

  if (worstFail) return { recommendation: 'fail', reasons };
  if (conditional) return { recommendation: 'conditional', reasons };
  reasons.push('全閾値を満たしました。');
  return { recommendation: 'pass', reasons };
}
