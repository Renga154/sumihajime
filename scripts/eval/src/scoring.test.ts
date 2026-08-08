import { describe, it, expect } from 'vitest';
import type { ChatCitation, ChatResponse } from '@tmn/schemas';
import {
  renderVerifiedDocumentAnswers,
  type UnresolvedTopic,
  type VerifiedProcedureFacts,
} from '@tmn/rag';
import {
  scoreCase,
  summarize,
  decideRelease,
  extractDeadlineExpressions,
  reviewFlagsFor,
  contaminatingSourceIds,
} from './scoring.js';
import type { ApiOutcome, EvalCase } from './types.js';

/**
 * なぜ: 採点は本番アクセスを伴わない純ロジックなので、fixtureで正例/負例/境界(混入・保留・
 * 期限表現の要レビュー)を固定検証する(T-014。§12「機械採点可能」の担保)。
 */

function citation(sourceId: string, partial: Partial<ChatCitation> = {}): ChatCitation {
  return {
    sourceId,
    title: partial.title ?? 'タイトル',
    ownerOrganization: partial.ownerOrganization ?? '世田谷区',
    url: partial.url ?? 'https://www.city.setagaya.lg.jp/x',
    lastVerifiedAt: partial.lastVerifiedAt ?? '2026-07-21T00:00:00Z',
  };
}

function answered(
  answer: string,
  sourceIds: string[],
  extra: Partial<ChatResponse> = {},
): ApiOutcome {
  const response: ChatResponse = {
    answer,
    citations: sourceIds.map((s) => citation(s)),
    confidence: extra.confidence ?? 'high',
    abstained: false,
  };
  return { httpStatus: 200, latencyMs: 1200, response };
}

function abstained(): ApiOutcome {
  return {
    httpStatus: 200,
    latencyMs: 800,
    response: {
      answer: '確認できませんでした。',
      citations: [],
      confidence: 'unknown',
      abstained: true,
    },
  };
}

const positive: EvalCase = {
  id: 'P01-x',
  kind: 'positive',
  municipalityCode: '13112',
  question: 'q',
  expect: {
    abstain: false,
    expectedSourceIds: ['src-13112-resident_registration-001'],
    answerMustInclude: ['14日'],
    forbiddenSourcePrefixes: [],
  },
  rationale: 'r',
};

describe('extractDeadlineExpressions', () => {
  it('日数・月数・週間表現を抽出する', () => {
    const got = extractDeadlineExpressions('14日以内に。30日、3か月、2週間。');
    expect(got).toContain('14日以内');
    expect(got).toContain('30日');
    expect(got).toContain('3か月');
    expect(got).toContain('2週間');
  });
});

describe('reviewFlagsFor', () => {
  it('answerMustInclude で説明される表現はフラグしない', () => {
    expect(reviewFlagsFor('14日以内に届出。', ['14日'])).toEqual([]);
  });
  it('未説明の期限表現をフラグする', () => {
    expect(reviewFlagsFor('14日以内、ただし30日以内の例外。', ['14日'])).toEqual(['30日以内']);
  });
});

describe('contaminatingSourceIds', () => {
  it('自区以外の sourceId を混入として返す', () => {
    expect(contaminatingSourceIds(['src-13112-a', 'src-13108-b'], '13112')).toEqual([
      'src-13108-b',
    ]);
  });
});

/**
 * なぜここで @tmn/rag の描画関数を直接呼ぶか:
 *
 * 回答本文へ文を足すと、この採点器の期限抽出が新しい表現を「根拠なき期限の断定」候補として
 * 拾う危険がある。実際 packages/rag/src/documents.ts の isoDatePart は、最終確認日を
 * 日本語表記(YYYY年M月D日)にすると `\d+年` に一致してしまうため、意図的に 'YYYY-MM-DD' を
 * 選んでいる(同ファイルのコメント参照)。
 *
 * 「回答へ落選の注記を足す」変更も同じ罠を踏み得るので、文面をコピーした固定文字列ではなく
 * **実際の描画関数の出力**に対して不変条件を張る。こうしておけば、将来だれかが注記へ
 * 「〇日以内」のような表現を入れた瞬間にこのテストが落ちる(コピーだと静かに乖離する)。
 */
describe('落選注記が期限抽出へ影響しないこと(@tmn/rag の実出力に対する不変条件)', () => {
  const facts: VerifiedProcedureFacts = {
    title: '転入届(区外から本区へ引越した方)',
    requiredDocuments: [{ label: '本人確認できるもの', status: 'required' }],
    dueDescription: '住みはじめた日から14日以内です。',
    lastVerifiedAt: '2026-07-21T11:44:00Z',
  };

  // 数字を含むURL・数字を含むcategoryを持つ落選(抽出の誤爆を誘いやすい形)を全理由ぶん並べる。
  const unresolved: UnresolvedTopic[] = [
    {
      category: 'waste_schedule',
      reason: 'no_verified_record',
      sourceIds: ['src-13112-waste_guide-001'],
      officialUrl: 'https://www.city.setagaya.lg.jp/02241/416.html',
    },
    { category: 'childcare', reason: 'ambiguous_records', sourceIds: [] },
    {
      category: 'national_health_insurance',
      reason: 'limit_reached',
      sourceIds: ['src-13112-national_health_insurance-001'],
      officialUrl: 'https://www.city.setagaya.lg.jp/02180/2026.html',
    },
  ];

  const without = renderVerifiedDocumentAnswers('世田谷区', [facts]);
  const withNotice = renderVerifiedDocumentAnswers('世田谷区', [facts], unresolved);

  it('注記が実際に本文へ現れている(テスト自体の有効性=サニティチェック)', () => {
    expect(withNotice.length).toBeGreaterThan(without.length);
    expect(withNotice).toContain('ごみ・資源の出し方と収集日');
    expect(without).not.toContain('ごみ・資源の出し方と収集日');
  });

  it('注記を足しても抽出される期限表現が1つも増えない', () => {
    expect(new Set(extractDeadlineExpressions(withNotice))).toEqual(
      new Set(extractDeadlineExpressions(without)),
    );
  });

  it('注記だけを取り出しても期限表現を含まない(数字入りURLで誤爆しない)', () => {
    const notice = withNotice.slice(withNotice.indexOf('■ この回答でご案内できなかったこと'));
    expect(extractDeadlineExpressions(notice)).toEqual([]);
  });

  it('要人手レビューのフラグが増えない(既存ケースが REVIEW へ退行しない)', () => {
    expect(reviewFlagsFor(withNotice, ['14日'])).toEqual(reviewFlagsFor(without, ['14日']));
    expect(reviewFlagsFor(withNotice, ['14日'])).toEqual([]);
  });

  it('注記を足しても answerMustInclude の判定を壊さない(本文は増えるだけ)', () => {
    for (const phrase of ['本人確認できるもの', '14日以内']) {
      expect(without.includes(phrase)).toBe(true);
      expect(withNotice.includes(phrase)).toBe(true);
    }
  });
});

describe('scoreCase — positive', () => {
  it('正しい出典・キーフレーズ → pass', () => {
    const r = scoreCase(
      positive,
      answered('引越しから14日以内に。', ['src-13112-resident_registration-001']),
    );
    expect(r.status).toBe('pass');
    expect(r.checks.retrievalHit).toBe(true);
    expect(r.checks.answerIncludes).toBe(true);
    expect(r.checks.isolationOk).toBe(true);
    expect(r.contaminationCount).toBe(0);
  });

  it('期待出典が引用されない → fail(retrieval_miss)', () => {
    const r = scoreCase(positive, answered('14日以内。', ['src-13112-child_benefits-001']));
    expect(r.status).toBe('fail');
    expect(r.checks.retrievalHit).toBe(false);
    expect(r.failReasons.join()).toMatch(/retrieval_miss/);
  });

  it('キーフレーズ欠落 → fail(answer_missing_phrase)', () => {
    const r = scoreCase(
      positive,
      answered('お早めに届け出てください。', ['src-13112-resident_registration-001']),
    );
    expect(r.status).toBe('fail');
    expect(r.checks.answerIncludes).toBe(false);
    expect(r.failReasons.join()).toMatch(/answer_missing_phrase/);
  });

  it('非保留のはずが保留 → fail', () => {
    const r = scoreCase(positive, abstained());
    expect(r.status).toBe('fail');
    expect(r.checks.abstainMatch).toBe(false);
  });

  it('citation不完全(url不正) → fail(citation_incomplete)', () => {
    const bad = answered('14日以内。', []);
    bad.response!.citations = [
      citation('src-13112-resident_registration-001', { url: 'not-a-url' }),
    ];
    const r = scoreCase(positive, bad);
    expect(r.checks.citationCompleteness).toBe(false);
    expect(r.failReasons.join()).toMatch(/citation_incomplete/);
  });

  it('非保留なのにcitations=0 → 根拠なし断定fail', () => {
    const r = scoreCase(positive, answered('14日以内。', []));
    expect(r.checks.noUnsupportedClaim).toBe(false);
    expect(r.status).toBe('fail');
  });

  it('未説明の期限表現があると needs_human_review(他checkがpassのとき)', () => {
    const r = scoreCase(
      positive,
      answered('14日以内。なお別件は60日以内。', ['src-13112-resident_registration-001']),
    );
    expect(r.status).toBe('needs_human_review');
    expect(r.reviewFlags).toContain('60日以内');
  });
});

describe('scoreCase — abstain', () => {
  const abstainCase: EvalCase = {
    id: 'A01-x',
    kind: 'abstain',
    municipalityCode: '13108',
    question: 'q',
    expect: {
      abstain: true,
      expectedSourceIds: [],
      answerMustInclude: [],
      forbiddenSourcePrefixes: [],
    },
    rationale: 'r',
  };
  it('保留 → pass', () => {
    expect(scoreCase(abstainCase, abstained()).status).toBe('pass');
  });
  it('回答してしまう → fail', () => {
    const r = scoreCase(abstainCase, answered('空いています。', ['src-13108-childcare-001']));
    expect(r.status).toBe('fail');
    expect(r.checks.abstainMatch).toBe(false);
  });
});

describe('scoreCase — cross(混入・未対応・either)', () => {
  it('混入(他区citation) → fail かつ contaminationCount>0', () => {
    const crossEither: EvalCase = {
      id: 'X02-x',
      kind: 'cross',
      municipalityCode: '13112',
      question: 'q',
      expect: {
        abstain: 'either',
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: ['src-13108-', 'src-13104-'],
      },
      rationale: 'r',
    };
    const r = scoreCase(crossEither, answered('江東区では…', ['src-13108-child_benefits-001']));
    expect(r.contaminationCount).toBe(1);
    expect(r.checks.isolationOk).toBe(false);
    expect(r.status).toBe('fail');
    expect(r.failReasons.join()).toMatch(/contamination|forbidden_source_prefix/);
  });

  it('either: 保留 → pass', () => {
    const crossEither: EvalCase = {
      id: 'X02-y',
      kind: 'cross',
      municipalityCode: '13112',
      question: 'q',
      expect: {
        abstain: 'either',
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: ['src-13108-'],
      },
      rationale: 'r',
    };
    expect(scoreCase(crossEither, abstained()).status).toBe('pass');
  });

  it('either: 自区限定の回答 → pass', () => {
    const crossEither: EvalCase = {
      id: 'X02-z',
      kind: 'cross',
      municipalityCode: '13112',
      question: 'q',
      expect: {
        abstain: 'either',
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: ['src-13108-'],
      },
      rationale: 'r',
    };
    const r = scoreCase(
      crossEither,
      answered('世田谷区については…', ['src-13112-child_benefits-001']),
    );
    expect(r.status).toBe('pass');
    expect(r.contaminationCount).toBe(0);
  });

  it('未対応自治体(abstain=true): 200保留 → pass', () => {
    const unsupported: EvalCase = {
      id: 'X01-x',
      kind: 'cross',
      municipalityCode: '13115',
      question: 'q',
      expect: {
        abstain: true,
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: ['src-13112-'],
      },
      rationale: 'r',
    };
    expect(scoreCase(unsupported, abstained()).status).toBe('pass');
  });

  it('未対応自治体: 構造化 out-of-scope エラー(404) → pass', () => {
    const unsupported: EvalCase = {
      id: 'X01-y',
      kind: 'cross',
      municipalityCode: '13115',
      question: 'q',
      expect: {
        abstain: true,
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: [],
      },
      rationale: 'r',
    };
    const outcome: ApiOutcome = {
      httpStatus: 404,
      latencyMs: 300,
      errorCode: 'municipality_not_supported',
    };
    const r = scoreCase(unsupported, outcome);
    expect(r.status).toBe('pass');
    expect(r.checks.abstainMatch).toBe(true);
  });
});

describe('scoreCase — インフラ障害', () => {
  it('ネットワーク/タイムアウト → error(採点対象外)', () => {
    const outcome: ApiOutcome = {
      httpStatus: 0,
      latencyMs: 30000,
      networkError: 'timeout after 30000ms',
    };
    const r = scoreCase(positive, outcome);
    expect(r.status).toBe('error');
    expect(r.checks.reachedApi).toBe(false);
  });
});

describe('summarize + decideRelease', () => {
  it('全pass相当 → recommendation pass', () => {
    const results = [
      scoreCase(positive, answered('14日以内。', ['src-13112-resident_registration-001'])),
    ];
    const s = summarize(results);
    expect(s.contaminationTotal).toBe(0);
    expect(s.correctMunicipalitySourceRate).toBe(1);
    expect(decideRelease(s).recommendation).toBe('pass');
  });

  it('混入があると fail', () => {
    const crossEither: EvalCase = {
      id: 'X-bad',
      kind: 'cross',
      municipalityCode: '13112',
      question: 'q',
      expect: {
        abstain: 'either',
        expectedSourceIds: [],
        answerMustInclude: [],
        forbiddenSourcePrefixes: ['src-13108-'],
      },
      rationale: 'r',
    };
    const results = [scoreCase(crossEither, answered('…', ['src-13108-child_benefits-001']))];
    const s = summarize(results);
    expect(s.contaminationTotal).toBe(1);
    expect(decideRelease(s).recommendation).toBe('fail');
  });

  it('要人手レビューのみなら conditional', () => {
    const results = [
      scoreCase(
        positive,
        answered('14日以内。別途60日以内も。', ['src-13112-resident_registration-001']),
      ),
    ];
    const s = summarize(results);
    expect(s.needsHumanReview).toBe(1);
    expect(decideRelease(s).recommendation).toBe('conditional');
  });

  it('p95 レイテンシ超過で fail', () => {
    const slow = answered('14日以内。', ['src-13112-resident_registration-001']);
    slow.latencyMs = 9000;
    const s = summarize([scoreCase(positive, slow)]);
    expect(s.latency.p95).toBe(9000);
    expect(decideRelease(s).recommendation).toBe('fail');
  });
});
