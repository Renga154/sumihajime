import { describe, expect, it } from 'vitest';
import { chatResponseSchema } from '@tmn/schemas';
import { extractModel, modelsSeen } from './model.js';
import { renderReport } from './report.js';
import { scoreCase } from './scoring.js';
import type { ApiOutcome, EvalCase, RunMeta } from './types.js';

/**
 * なぜ: 評価レポートは「どのモデルの回答を採点したか」が分からないと、モデルの差し替え・
 * 既定値の変更(モデルドリフト)で正答率が動いても原因を追えない。API の応答に model が
 * あればケースごとに記録する。実 API は呼ばない(応答 JSON の偽物で確かめる)。
 */
describe('extractModel', () => {
  const base = { answer: '14日以内です。', citations: [], confidence: 'low', abstained: false };

  it('応答に model があれば取り出し、残りは厳格スキーマで読める形で返す', () => {
    const { model, body } = extractModel({ ...base, model: 'gpt-4o-mini-2024-07-18' });
    expect(model).toBe('gpt-4o-mini-2024-07-18');
    expect(chatResponseSchema.safeParse(body).success).toBe(true);
  });

  it('model が無ければ null(現行 API。記録は「不明」になる)', () => {
    const { model, body } = extractModel(base);
    expect(model).toBeNull();
    expect(body).toEqual(base);
  });

  it.each([
    ['長すぎる', 'x'.repeat(101)],
    ['改行入り(レポートの Markdown を崩す)', 'gpt\n# injected'],
    ['HTML', '<img src=x onerror=alert(1)>'],
    ['文字列でない', 42],
  ])('model が %s 値なら記録しない(null)', (_label, value) => {
    expect(extractModel({ ...base, model: value }).model).toBeNull();
  });

  it('オブジェクトでない応答はそのまま返す', () => {
    expect(extractModel(undefined)).toEqual({ model: null, body: undefined });
    expect(extractModel('x')).toEqual({ model: null, body: 'x' });
  });
});

describe('scoreCase / renderReport — model の記録', () => {
  const evalCase: EvalCase = {
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
  const outcome = (model: string | null): ApiOutcome => ({
    httpStatus: 200,
    latencyMs: 1000,
    model,
    response: {
      answer: '14日以内です。',
      citations: [
        {
          sourceId: 'src-13112-resident_registration-001',
          title: '転入届',
          ownerOrganization: '世田谷区',
          url: 'https://www.city.setagaya.lg.jp/x',
          lastVerifiedAt: '2026-07-21T00:00:00Z',
        },
      ],
      confidence: 'high',
      abstained: false,
    },
  });
  const dataset = {
    datasetVersion: 'v',
    generatedFor: 'test',
    description: 'd',
    corpus: { municipalities: ['13112'], indexedSourceType: 'html', note: '' },
    scoring: {},
    cases: [evalCase],
  };
  const meta: RunMeta = {
    endpoint: 'https://example.invalid/api/chat',
    ranAt: '2026-10-02T00:00:00Z',
    spacingMs: 0,
    timeoutMs: 0,
    approvedHtmlSources: {},
    approvedHtmlSourceTotal: 0,
    indexedVectorCount: null,
    ruleVersion: null,
    promptVersion: null,
  };

  it('ケース結果に model を持ち越し、レポートに出す', () => {
    const r = scoreCase(evalCase, outcome('gpt-4o-mini'));
    expect(r.model).toBe('gpt-4o-mini');
    const md = renderReport({ dataset, meta: { ...meta, models: modelsSeen([r]) }, results: [r] });
    expect(md).toContain('回答モデル(API 応答の model): gpt-4o-mini');
  });

  it('API が model を返さなければ「不明」と書く(推測で埋めない)', () => {
    const r = scoreCase(evalCase, outcome(null));
    expect(r.model).toBeNull();
    const md = renderReport({ dataset, meta: { ...meta, models: modelsSeen([r]) }, results: [r] });
    expect(md).toContain('不明(API が model を返さない)');
  });
});

describe('modelsSeen', () => {
  it('ケースの model を重複なく出現順に並べる(null は除く)', () => {
    expect(
      modelsSeen([{ model: 'a' }, { model: null }, { model: 'b' }, { model: 'a' }, {}]),
    ).toEqual(['a', 'b']);
  });
});
