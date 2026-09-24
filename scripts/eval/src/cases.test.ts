import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderedQuestionCategories } from '@tmn/rag';
import { parseDataset, assertDatasetShape } from './cases.js';

/**
 * なぜ: 実データセット(data/evaluations/rag-eval-cases.json)が常に構造・配分・自治体整合を
 * 満たすことをCIで固定する。期待出典が自区の src- 接頭辞に一致することも検証する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

describe('rag-eval-cases.json', () => {
  const raw = JSON.parse(
    readFileSync(resolve(repoRoot, 'data/evaluations/rag-eval-cases.json'), 'utf-8'),
  );

  it('Zodスキーマを満たす', () => {
    expect(() => parseDataset(raw)).not.toThrow();
  });

  it('180問・正答147/保留17/越境16・自治体整合を満たす', () => {
    const dataset = parseDataset(raw);
    expect(() => assertDatasetShape(dataset)).not.toThrow();
  });

  /**
   * なぜ: v2.1.1 までの175問は**すべて単一トピック**だった。そのため「1文で2つ尋ねられ、片方に
   * 一言も触れずに200を返す」欠陥(本番実測 2026-08-08 / 世田谷「犬の登録に必要な持ち物と、
   * 粗大ごみの出し方」)を、評価が一度も踏めなかった=評価が現実より易しい問題を解いていた。
   * 同じ状態へ戻らないよう、複合質問の存在と「話題ごとに期待値を持つこと」を固定する。
   */
  it('複合質問(1文で複数の手続き)のケースを持ち、話題ごとに期待キーフレーズを持つ', () => {
    const dataset = parseDataset(raw);
    const compound = dataset.cases.filter((c) => c.id.includes('-compound-'));
    expect(compound.length).toBeGreaterThanOrEqual(4);
    for (const c of compound) {
      // 本番と同じ決定論的判定で、質問が本当に複数手続きを指していること。
      expect(orderedQuestionCategories(c.question).length, c.id).toBeGreaterThanOrEqual(2);
      // 片方の話題しか見ない期待値にしない。
      expect(c.expect.answerMustInclude.length, c.id).toBeGreaterThanOrEqual(2);
    }
    // 「片方に書類一覧が無い」形(=無言の欠落が起きていた形)を必ず含む。
    expect(compound.some((c) => c.expect.answerMustInclude.includes('ごみ'))).toBe(true);
  });

  // なぜ: v1.2.0にあった書類系4問が23区化(v2.0.0)で全て失われ、UIのプレースホルダそのものの質問
  // (「転入届に必要な持ち物は？」)が151問中1問も無い状態になっていた。回帰を二度起こさないよう固定する。
  it('全23区に必要書類(持ち物)のケースがあり、conditional の分離を検査している(ADR-010)', () => {
    const dataset = parseDataset(raw);
    for (const code of dataset.corpus.municipalities) {
      const docCases = dataset.cases.filter(
        (c) => c.municipalityCode === code && c.id.endsWith('-resident-documents'),
      );
      expect(docCases, `municipality ${code}`).toHaveLength(1);
      const c = docCases[0]!;
      expect(c.kind).toBe('positive');
      expect(c.expect.abstain).toBe(false);
      // 条件付き書類が必須欄に混ざっていないことを見る見出しを必ず期待値に含める。
      expect(c.expect.answerMustInclude).toContain('■ 場合により必要なもの（あてはまる方のみ）');
      // required の公式文言(見出し・期限トークン以外)が1件以上ある。
      const documentPhrases = c.expect.answerMustInclude.filter(
        (p) => !p.startsWith('■') && !/^\d/.test(p),
      );
      expect(documentPhrases.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('23区すべてを各区3問以上でカバーする', () => {
    const dataset = parseDataset(raw);
    expect(dataset.corpus.municipalities).toHaveLength(23);
    for (const code of dataset.corpus.municipalities) {
      const n = dataset.cases.filter((c) => c.municipalityCode === code).length;
      expect(n, `municipality ${code}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('区ごとに異なる期限を突く問題を含む(子ども医療費の遡及期限が区で異なることの回帰ガード)', () => {
    const dataset = parseDataset(raw);
    const phrases = new Set(
      dataset.cases
        .filter((c) => c.id.includes('child-medical') && c.kind === 'positive')
        .flatMap((c) => c.expect.answerMustInclude),
    );
    // 14日 / 15日 / 2か月 / 3か月 / 3ヶ月 / 3カ月 / 6か月 / 6カ月 のように複数の期限表記が並ぶ。
    const deadlinePhrases = [...phrases].filter((p) => /^\d/.test(p));
    expect(deadlinePhrases.length).toBeGreaterThanOrEqual(5);
  });

  it('原文に期限の記載が無い区は保留系に置く(他区の期限を答えたら重大な失敗)', () => {
    const dataset = parseDataset(raw);
    const noDeadlineAbstain = dataset.cases.filter(
      (c) => c.kind === 'abstain' && /no-90day|no-deadline/.test(c.id),
    );
    expect(noDeadlineAbstain.length).toBeGreaterThanOrEqual(5);
    for (const c of noDeadlineAbstain) expect(c.expect.abstain).toBe(true);
  });

  it('保留系・越境系は expectedSourceIds を持たない(機械採点の前提)', () => {
    const dataset = parseDataset(raw);
    for (const c of dataset.cases.filter((c) => c.kind !== 'positive')) {
      expect(c.expect.expectedSourceIds).toHaveLength(0);
    }
  });
});
