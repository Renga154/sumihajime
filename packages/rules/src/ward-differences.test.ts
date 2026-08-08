import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcedureVersion, Rule } from '@tmn/schemas';
import {
  buildWardDifferences,
  extractStatedDeadline,
  WARD_DIFFERENCE_TOPICS,
  type WardDifferenceInput,
  type WardDifferenceSourceRef,
} from './ward-differences.js';

/**
 * なぜ: 比較ページ(/differences)に出る値は「実データから毎回導出する」ことが要件であり、
 * ハードコードした表であってはならない。したがってこのテストも期待値を手打ちせず、
 * リポジトリの公開データ(data/normalized/{code}/procedures.json,
 * packages/rules/data/{code}/rules.json)を読んで不変条件として検証する。
 * 区が増えれば検査対象も分布も自動的に追随する(区名・件数を一切ハードコードしない)。
 *
 * 検証する不変条件:
 *   1. 全ての対応区が、全トピックで「判定できません」に落ちずに分類される(推測ではなく判定が付く)。
 *   2. 分布(valueGroups)の合計が区数と一致し、区の取りこぼしがない。
 *   3. どのトピックも実際に2通り以上に分かれる(=比較ページとして成立している)。
 *   4. 各セルに必ず根拠(ソース+最終確認日)が付く(原則2)。
 *   5. 犬の届出は「公式文言からの抽出結果」と「ルールの dueRule」が矛盾しない(二重帳簿でない)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/** data/normalized 配下に縦切りデータがある区(区が増えれば自動的に対象へ入る)。 */
const WARD_CODES: readonly string[] = readdirSync(resolve(repoRoot, 'data/normalized'))
  .filter((name) => /^\d{5}$/.test(name))
  .filter((code) => existsSync(resolve(repoRoot, `packages/rules/data/${code}/rules.json`)))
  .sort();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf-8')) as T;
}

/**
 * リポジトリの実データから比較関数の入力を組み立てる。
 * ソースは source_id から決定論的に生成したダミー参照を使う(このテストの対象は集計ロジックであり、
 * 台帳との突き合わせ=実URL・実最終確認日の解決は apps/api の統合テストが実データで検証する)。
 */
function realWardInputs(): WardDifferenceInput[] {
  return WARD_CODES.map((code) => {
    const rules = readJson<{ rules: Rule[] }>(`packages/rules/data/${code}/rules.json`).rules;
    const procedures = readJson<{ procedures: ProcedureVersion[] }>(
      `data/normalized/${code}/procedures.json`,
    ).procedures;
    const sources = new Map<string, WardDifferenceSourceRef>();
    for (const id of [
      ...rules.flatMap((r) => r.sourceIds),
      ...procedures.flatMap((p) => p.sourceIds),
    ]) {
      sources.set(id, {
        sourceId: id,
        title: `${id} の出典`,
        url: `https://example.invalid/${id}`,
        lastVerifiedAt: '2026-08-07T00:00:00Z',
      });
    }
    return {
      municipalityCode: code,
      municipalityName: `${code}区`,
      rules,
      procedures,
      sources,
    };
  });
}

const report = buildWardDifferences(realWardInputs());

describe('extractStatedDeadline — 公式文言からの保守的な期限抽出', () => {
  it('「N日以内」「Nか月以内」を単位ごとに取り出す(表記ゆれ含む)', () => {
    expect(extractStatedDeadline('転入日から14日以内に申請してください。')).toEqual({
      kind: 'duration',
      amount: 14,
      unit: 'day',
    });
    for (const text of ['3か月以内', '3ヶ月以内', '3カ月以内', '3箇月以内']) {
      expect(extractStatedDeadline(`${text}に申請してください。`)).toEqual({
        kind: 'duration',
        amount: 3,
        unit: 'month',
      });
    }
  });

  it('同じ値が複数回出てきても1つの値として扱う', () => {
    const text = '3か月以内に申請すると遡れます。3か月を経過した場合は申請月の1日からです。';
    expect(extractStatedDeadline(text)).toEqual({ kind: 'duration', amount: 3, unit: 'month' });
  });

  it('「記載がありません」がある場合は、同じ文に別手続きの日数があっても absent を返す', () => {
    // 実データ(葛飾区の犬の登録事項変更)にある形。別手続きの30日を転入時の期限に転用しない。
    const text =
      '転入の届出について、日数の期限はこのページには記載がありません' +
      '(『犬を飼い始めてから30日以内』は、新たに犬を飼い始めたときの登録の期限です)。';
    expect(extractStatedDeadline(text)).toEqual({ kind: 'absent' });
  });

  it('期限を示す語を伴わない数値(日付・金額)は拾わない', () => {
    expect(
      extractStatedDeadline('医療証の有効期限は毎年9月30日です。手数料は1,600円です。'),
    ).toEqual({ kind: 'undetermined', reason: 'no_duration_found' });
  });

  it('異なる期間が2つ以上あって決められない場合は undetermined(推測しない)', () => {
    const text = '転入日から14日以内に届出をし、その届出日から90日以内に手続きしてください。';
    expect(extractStatedDeadline(text)).toEqual({ kind: 'undetermined', reason: 'ambiguous' });
  });
});

describe('buildWardDifferences — 実データからの集計(区が増えれば自動追随)', () => {
  it('検査対象の区が揃っている(縦切りデータのある区がすべて入力になる)', () => {
    expect(WARD_CODES.length).toBeGreaterThanOrEqual(13);
    expect(report.municipalities.map((m) => m.code)).toEqual([...WARD_CODES]);
  });

  it('トピック定義とレポートのトピックが1:1で対応する', () => {
    expect(report.topics.map((t) => t.topicId)).toEqual(
      WARD_DIFFERENCE_TOPICS.map((t) => t.topicId),
    );
  });

  it.each(WARD_DIFFERENCE_TOPICS.map((t) => t.topicId))(
    '%s: 全ての区が比較対象になり、取りこぼし(omitted)がない',
    (topicId) => {
      const topic = report.topics.find((t) => t.topicId === topicId);
      expect(topic).toBeDefined();
      expect(topic?.omittedMunicipalityCodes).toEqual([]);
      expect(topic?.cells.map((c) => c.municipalityCode)).toEqual([...WARD_CODES]);
    },
  );

  it.each(WARD_DIFFERENCE_TOPICS.map((t) => t.topicId))(
    '%s: 分布の合計が区数と一致し、区の重複・欠落がない',
    (topicId) => {
      const topic = report.topics.find((t) => t.topicId === topicId);
      const codes = (topic?.valueGroups ?? []).flatMap((g) => [...g.municipalityCodes]);
      expect([...codes].sort()).toEqual([...WARD_CODES]);
    },
  );

  it.each(WARD_DIFFERENCE_TOPICS.map((t) => t.topicId))(
    '%s: 「判定できません」に落ちる区がない(推測ではなく機械判定が付いている)',
    (topicId) => {
      const topic = report.topics.find((t) => t.topicId === topicId);
      const undetermined = (topic?.cells ?? []).filter((c) => c.valueId === 'undetermined');
      // なぜ: ここが落ちたら、データ側の公式文言が抽出器の想定を外れたということ。
      // 抽出器を緩めて推測させるのではなく、人手でデータと導出方法を見直す合図にする。
      expect(
        undetermined.map((c) => `${c.municipalityCode}: ${c.officialText}`),
        `判定できない区がある(${topicId})`,
      ).toEqual([]);
    },
  );

  it.each(WARD_DIFFERENCE_TOPICS.map((t) => t.topicId))(
    '%s: 実際に2通り以上に分かれている(比較ページとして成立する)',
    (topicId) => {
      const topic = report.topics.find((t) => t.topicId === topicId);
      expect(topic?.valueGroups.length ?? 0).toBeGreaterThanOrEqual(2);
    },
  );

  it('分布は「区数の多い順」で並ぶ(表示順が決定論的)', () => {
    for (const topic of report.topics) {
      const counts = topic.valueGroups.map((g) => g.municipalityCodes.length);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    }
  });

  it('全てのセルに根拠(ソース+最終確認日)と公式文言が付く(原則2・原則3)', () => {
    for (const topic of report.topics) {
      for (const cell of topic.cells) {
        expect(cell.sources.length, `${topic.topicId} / ${cell.municipalityCode}`).toBeGreaterThan(
          0,
        );
        for (const s of cell.sources) {
          expect(s.url).toMatch(/^https?:\/\//);
          expect(s.lastVerifiedAt).not.toBe('');
        }
        expect(cell.officialText.length).toBeGreaterThan(0);
        expect(cell.valueLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it('「要確認」系の値には caution、確定した期限には neutral が付く', () => {
    for (const topic of report.topics) {
      for (const group of topic.valueGroups) {
        const isCaution = group.label.includes('要確認') || group.label.includes('算定できない');
        expect(group.tone === 'caution', `${topic.topicId} / ${group.label}`).toBe(isCaution);
      }
    }
  });

  it('犬の届出: 公式文言からの抽出と rules.json の dueRule が矛盾しない', () => {
    // なぜ: 同じ事実(30日以内かどうか)がルールの dueRule と公式文言の両方にある。
    // 片方だけ更新される二重帳簿を防ぐため、両者の一致を不変条件として固定する。
    const topic = report.topics.find((t) => t.topicId === 'dog_registration_change_days');
    for (const code of WARD_CODES) {
      const rules = readJson<{ rules: Rule[] }>(`packages/rules/data/${code}/rules.json`).rules;
      const rule = rules.find((r) => r.procedureId === 'procedure_dog_registration_transfer');
      const cell = topic?.cells.find((c) => c.municipalityCode === code);
      expect(rule, code).toBeDefined();
      expect(cell, code).toBeDefined();
      if (!rule || !cell) continue;
      if (rule.dueRule.type === 'offsetDays') {
        expect(cell.valueId, code).toBe(`day_${rule.dueRule.days}`);
      } else {
        expect(cell.valueId, code).toBe('not_stated');
      }
    }
  });

  it('児童手当: 「転出予定日」起算の区では期日を算定していない(dueRule=unknown)', () => {
    // なぜ: 前住所地の転出予定日は本サービスが知り得ない情報。起算日が転出予定日の区で
    // 引越し日から日付を出してしまうと誤った期限を表示する。データ側でそうなっていないことを固定する。
    const topic = report.topics.find((t) => t.topicId === 'child_allowance_15day_origin');
    for (const cell of topic?.cells ?? []) {
      if (cell.valueId !== 'move_out_scheduled_date') continue;
      const rules = readJson<{ rules: Rule[] }>(
        `packages/rules/data/${cell.municipalityCode}/rules.json`,
      ).rules;
      const rule = rules.find((r) => r.procedureId === 'procedure_child_allowance');
      expect(rule?.dueRule.type, cell.municipalityCode).toBe('unknown');
    }
  });

  it('比較値は各区の公式文言そのものから導出され、他区の文言を持ち込んでいない', () => {
    // なぜ: 原則4。セルの officialText は、その区の rules.json の dueDescription と完全一致する
    // (=比較ページのために別文面を用意していない)ことを固定する。
    for (const topic of report.topics) {
      for (const cell of topic.cells) {
        const rules = readJson<{ rules: Rule[] }>(
          `packages/rules/data/${cell.municipalityCode}/rules.json`,
        ).rules;
        const rule = rules.find((r) => r.procedureId === topic.procedureId);
        expect(cell.officialText, `${topic.topicId} / ${cell.municipalityCode}`).toBe(
          rule?.dueDescription,
        );
      }
    }
  });
});

describe('buildWardDifferences — 縮退の作法', () => {
  const base = realWardInputs()[0];

  it('手続きやルールが無い区は比較から外し、omitted として開示する(該当なしに見せない)', () => {
    if (!base) throw new Error('no ward data');
    const bare: WardDifferenceInput = {
      ...base,
      municipalityCode: '13999',
      rules: [],
      procedures: [],
    };
    const r = buildWardDifferences([base, bare]);
    for (const topic of r.topics) {
      expect(topic.omittedMunicipalityCodes).toContain('13999');
      expect(topic.cells.map((c) => c.municipalityCode)).not.toContain('13999');
    }
  });

  it('承認済み根拠を1件も解決できない区は比較に出さない(原則2)', () => {
    if (!base) throw new Error('no ward data');
    const noSource: WardDifferenceInput = {
      ...base,
      municipalityCode: '13998',
      sources: new Map(),
    };
    const r = buildWardDifferences([base, noSource]);
    for (const topic of r.topics) {
      expect(topic.omittedMunicipalityCodes).toContain('13998');
    }
  });
});
