import { describe, it, expect } from 'vitest';
import {
  parseAnswer,
  validateCitations,
  confidenceFromScore,
  shouldAbstain,
  selectMatches,
} from './answer.js';
import type { VectorizeMatch } from './types.js';

describe('parseAnswer', () => {
  it('末尾 SOURCES 行を本文から分離し sourceId を抽出する', () => {
    const a =
      '転入届は14日以内です。\n注意: 郵送不可。\nSOURCES: src-13112-resident_registration-001';
    const p = parseAnswer(a);
    expect(p.body).toBe('転入届は14日以内です。\n注意: 郵送不可。');
    expect(p.citedSourceIds).toEqual(['src-13112-resident_registration-001']);
  });

  it('複数 sourceId(カンマ/読点/空白区切り)を抽出する', () => {
    const p = parseAnswer('回答。\nSOURCES: src-a, src-b、src-c src-d');
    expect(p.citedSourceIds).toEqual(['src-a', 'src-b', 'src-c', 'src-d']);
  });

  it('SOURCES 行が無い場合は空配列(=引用なし)', () => {
    const p = parseAnswer('根拠が抜粋にありませんでした。');
    expect(p.citedSourceIds).toEqual([]);
    expect(p.body).toBe('根拠が抜粋にありませんでした。');
  });

  it('全角コロンの "SOURCES:" も解析する', () => {
    const p = parseAnswer('回答\nSOURCES：src-x');
    expect(p.citedSourceIds).toEqual(['src-x']);
  });
});

describe('validateCitations', () => {
  const allowed = new Set(['src-a', 'src-b']);

  it('許可集合(検索ヒット)に含まれる引用だけを残す', () => {
    expect(validateCitations(['src-a', 'src-b'], allowed)).toEqual(['src-a', 'src-b']);
  });

  it('捏造された sourceId(検索でヒットしていない)を除外する', () => {
    expect(validateCitations(['src-a', 'src-FAKE'], allowed)).toEqual(['src-a']);
  });

  it('重複を除去し順序を保持する', () => {
    expect(validateCitations(['src-b', 'src-b', 'src-a'], allowed)).toEqual(['src-b', 'src-a']);
  });

  it('全て捏造なら空(=呼び出し側で保留へ差し替え)', () => {
    expect(validateCitations(['src-FAKE'], allowed)).toEqual([]);
  });
});

describe('confidenceFromScore', () => {
  it('スコア帯に応じたラベル', () => {
    expect(confidenceFromScore(0.6)).toBe('high');
    expect(confidenceFromScore(0.45)).toBe('medium');
    expect(confidenceFromScore(0.33)).toBe('low');
    expect(confidenceFromScore(0.1)).toBe('unknown');
    expect(confidenceFromScore(undefined)).toBe('unknown');
  });
});

describe('shouldAbstain / selectMatches', () => {
  const matches: VectorizeMatch[] = [
    { id: 'a#0', score: 0.55 },
    { id: 'b#1', score: 0.2 },
    { id: 'c#0', score: 0.41 },
  ];

  it('閾値以上のマッチが無ければ保留', () => {
    expect(shouldAbstain(matches, 0.6)).toBe(true);
    expect(shouldAbstain(matches, 0.3)).toBe(false);
    expect(shouldAbstain([], 0.3)).toBe(true);
  });

  it('閾値以上のみをスコア降順で返す', () => {
    const sel = selectMatches(matches, 0.3);
    expect(sel.map((m) => m.id)).toEqual(['a#0', 'c#0']);
  });
});
