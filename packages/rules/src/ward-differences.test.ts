import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcedureVersion, Rule } from '@tmn/schemas';
import {
  buildWardDifferences,
  extractStatedDeadline,
  extractStatedDeadlines,
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
 *   6. 【最重要】「別の期限を明記している区」が「期限の記載を確認できない区」に混ざらない。
 *      混ざると、90日より短い期限(例: 引越し日から14日以内)を公開している区の利用者に
 *      「自分の区は期限を出していない=猶予があるかも」と読ませ、安全と逆に倒れる。
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

  it('助詞の揺れ(「90日が経過」「15日経過」「90日を過ぎ」)も期限として拾う', () => {
    // 実データ(中央区のマイナンバーカード継続利用)は「90日が経過すると失効します」と書く。
    // 助詞を許容しないと、90日を明記している区を「明記していない」と誤判定する。
    for (const text of ['90日が経過すると失効します。', '90日経過すると失効します。']) {
      expect(extractStatedDeadline(text), text).toEqual({
        kind: 'duration',
        amount: 90,
        unit: 'day',
      });
    }
  });

  it('否定が期限以外に掛かっている文では absent にしない(期限は別の文で明記されている)', () => {
    // 実データ(目黒区)の形。「失効条件の記載がありません」は期限そのものの否定ではない。
    const text =
      '手続きできる期間は転入届出日から90日以内です。' +
      'なお目黒区のページには、他区にある失効条件の記載がありません。';
    expect(extractStatedDeadline(text)).toEqual({ kind: 'duration', amount: 90, unit: 'day' });
  });
});

describe('extractStatedDeadlines — 明記された期限を「すべて」取り出す', () => {
  it('複数の期限を実際の長さの昇順で返す(1つに畳んで捨てない)', () => {
    const text = '引越してきた日から14日以内かつ転出予定日から30日以内に手続きしてください。';
    expect(extractStatedDeadlines(text)).toEqual({
      kind: 'durations',
      durations: [
        { amount: 14, unit: 'day' },
        { amount: 30, unit: 'day' },
      ],
    });
  });

  it('日と月が混ざっても実際の長さの順に並ぶ', () => {
    const text = '3か月以内に申請してください。14日以内であれば遡れます。';
    expect(extractStatedDeadlines(text)).toEqual({
      kind: 'durations',
      durations: [
        { amount: 14, unit: 'day' },
        { amount: 3, unit: 'month' },
      ],
    });
  });

  it('期限の記載が無いと明記している場合は、同じ文の数字を拾わず absent', () => {
    const text = '日数の期限はこのページには記載がありません(『30日以内』は別手続きの期限です)。';
    expect(extractStatedDeadlines(text)).toEqual({ kind: 'absent' });
  });

  it('期限らしい数値が無い場合は空配列(absent とは区別する)', () => {
    expect(extractStatedDeadlines('手数料は1,600円です。')).toEqual({
      kind: 'durations',
      durations: [],
    });
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

  it('児童手当: 「転出予定日」起算の区は引越し日からは算定せず、転出予定日を起算日にする', () => {
    // なぜ: 起算日が転出予定日の区で引越し日から日付を出すと、区が言っていない期限になる。
    // 2026-08-09 に転出予定日(任意入力)を受け取れるようにしたため、
    //   - 算定するなら起算日は必ず moveOutScheduledDate(moveDate 起算は禁止)
    //   - 転出予定日が未入力なら dueDate は出ない(dates.test.ts が固定)
    // というデータ側の不変条件を固定する。
    const topic = report.topics.find((t) => t.topicId === 'child_allowance_15day_origin');
    const checked: string[] = [];
    for (const cell of topic?.cells ?? []) {
      if (cell.valueId !== 'move_out_scheduled_date') continue;
      const rules = readJson<{ rules: Rule[] }>(
        `packages/rules/data/${cell.municipalityCode}/rules.json`,
      ).rules;
      const rule = rules.find((r) => r.procedureId === 'procedure_child_allowance');
      const dueRule = rule?.dueRule;
      expect(dueRule, cell.municipalityCode).toBeDefined();
      if (dueRule?.type === 'offsetDays') {
        expect(dueRule.from, cell.municipalityCode).toBe('moveOutScheduledDate');
      } else {
        expect(dueRule?.type, cell.municipalityCode).toBe('unknown');
      }
      checked.push(cell.municipalityCode);
    }
    // 空ループで素通りしないことを保証する(区が減れば気づける)。
    expect(checked.length).toBeGreaterThan(0);
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

describe('マイナンバーカード継続利用 — 「別の期限を明記」と「記載を確認できない」を混ぜない', () => {
  const TOPIC_ID = 'mynumber_continued_use_window';
  const PROCEDURE_ID = 'procedure_mynumber_continued_use';

  /**
   * テスト側で独立に「期限の記載が無い」と読める文かを判定する(実装の内部定数を使わない)。
   * データ側が新しい言い回しを持ち込んだら、実装との食い違いとしてここで落ちる。
   */
  const NEGATION =
    /記載が(ありません|ない)|記載は(ありません|ない)|記載なし|確認できません(でした)?/;

  const topic = report.topics.find((t) => t.topicId === TOPIC_ID);

  function buildWithText(dueDescription: string): string {
    const base = realWardInputs()[0];
    if (!base) throw new Error('no ward data');
    const ward: WardDifferenceInput = {
      ...base,
      municipalityCode: '13999',
      municipalityName: '検証区',
      rules: base.rules.map((r) =>
        r.procedureId === PROCEDURE_ID ? { ...r, dueDescription } : r,
      ) as Rule[],
    };
    const built = buildWardDifferences([ward]);
    const cell = built.topics.find((t) => t.topicId === TOPIC_ID)?.cells[0];
    if (!cell) throw new Error('no cell');
    return cell.valueId;
  }

  it('90日 / 別の期限 / 記載を確認できない が、それぞれ別の値になる(3値以上)', () => {
    const ninety = buildWithText('継続利用の手続きは転入届出日から90日以内です。');
    const other = buildWithText(
      '引越してきた日から14日以内かつ転出予定日から30日以内(期限を過ぎるとカードの継続利用ができません)。',
    );
    const unknown = buildWithText(
      '継続利用の手続きそのものの期限は、区の公式ページでは確認できませんでした(未確認)。',
    );
    expect(new Set([ninety, other, unknown]).size).toBe(3);
    expect(ninety).toBe('stated_90days');
    expect(unknown).toBe('not_stated');
    // 別の期限を明記している区は、記載の無い区と同じ値に落ちてはならない(このバグの本体)。
    expect(other).not.toBe('not_stated');
    expect(other).not.toBe('undetermined');
  });

  it('実データでも3通り以上に分かれ、分布の合計が対応区数と一致する', () => {
    expect(topic).toBeDefined();
    expect(topic?.valueGroups.length ?? 0).toBeGreaterThanOrEqual(3);
    const total = (topic?.valueGroups ?? []).reduce((n, g) => n + g.municipalityCodes.length, 0);
    expect(total).toBe(WARD_CODES.length);
  });

  it('【P0】期限を明記している区が「確認できず」側に入らない', () => {
    for (const cell of topic?.cells ?? []) {
      if (NEGATION.test(cell.officialText)) continue;
      // 区自身が「確認できない」と書いていない以上、要確認へ落としてはならない。
      expect(cell.valueId, `${cell.municipalityCode}: ${cell.officialText}`).not.toBe('not_stated');
      expect(cell.tone, cell.municipalityCode).toBe('neutral');
    }
  });

  it('「確認できず」に入る区は、区自身がその旨を明記している区だけ', () => {
    for (const cell of topic?.cells ?? []) {
      if (cell.valueId !== 'not_stated') continue;
      expect(
        NEGATION.test(cell.officialText),
        `${cell.municipalityCode}: ${cell.officialText}`,
      ).toBe(true);
    }
  });

  it('「90日以内と明記」の区の文言には90日が実在し、それ以外の区には無い', () => {
    for (const cell of topic?.cells ?? []) {
      const has90 = /90\s*日/.test(cell.officialText);
      if (cell.valueId === 'stated_90days') {
        expect(has90, cell.municipalityCode).toBe(true);
      } else {
        // 90日を書いている区を「別の期限」「確認できず」にはしない。
        expect(has90, `${cell.municipalityCode}: ${cell.officialText}`).toBe(false);
      }
    }
  });

  it('「別の期限を明記」の区は、そのラベルの日数が公式文言に実在する(推測で数字を作らない)', () => {
    const others = (topic?.cells ?? []).filter((c) => c.valueId.startsWith('stated_other_'));
    // 実データにこの類型が存在すること自体を固定する(存在しなくなったら分類の見直しが必要)。
    expect(others.length).toBeGreaterThan(0);
    for (const cell of others) {
      const numbers = [...cell.valueLabel.matchAll(/(\d{1,3})(日|か月)以内/g)];
      expect(numbers.length, `${cell.municipalityCode}: ${cell.valueLabel}`).toBeGreaterThan(0);
      for (const [, amount, unit] of numbers) {
        expect(
          new RegExp(`${amount}\\s*${unit === '日' ? '日' : '[かヶカ箇]月'}`).test(
            cell.officialText,
          ),
          `${cell.municipalityCode} のラベル「${cell.valueLabel}」の${amount}${unit}が公式文言に無い`,
        ).toBe(true);
      }
      // 90日を明記していないことが、この類型の前提。
      expect(/90\s*日/.test(cell.officialText), cell.municipalityCode).toBe(false);
    }
  });

  it('児童手当: 「転出予定日が起算日」とするのは、その区がそう書いている区だけ', () => {
    // なぜ: 「起算日の定義がこのページに無い」と書いている区の文にも『転出予定日』の語は現れる。
    // 語の有無だけで判定すると、区が言っていない起算日をその区の見解として表示してしまう。
    const allowance = report.topics.find((t) => t.topicId === 'child_allowance_15day_origin');
    for (const cell of allowance?.cells ?? []) {
      const saysUndefined =
        /定義が(ない|ありません)|定義はありません/.test(cell.officialText) ||
        NEGATION.test(cell.officialText);
      if (cell.valueId === 'move_out_scheduled_date') {
        expect(cell.officialText, cell.municipalityCode).toContain('転出予定日');
        expect(saysUndefined, `${cell.municipalityCode}: ${cell.officialText}`).toBe(false);
      }
      if (saysUndefined) {
        expect(cell.valueId, `${cell.municipalityCode}: ${cell.officialText}`).not.toBe(
          'move_out_scheduled_date',
        );
      }
    }
  });

  /**
   * なぜこの3件を足したか(2026-08-09): チェックリスト側で期日を算定できる区を増やしたため、
   * 「比較ページの分類」と「チェックリストが日付を出す/出さない」が食い違わないことを機械検証する。
   * 分類は区が書いた文言から導出し、期日はルールから導出する。二重帳簿にしない。
   */
  it('マイナンバー: 分類は 90日明記18区 / 90日でない期限を明記2区 / 記載なし3区 のまま', () => {
    const groups = new Map(
      (topic?.valueGroups ?? []).map((g) => [g.valueId, g.municipalityCodes.length]),
    );
    expect(groups.get('stated_90days')).toBe(18);
    expect(groups.get('not_stated')).toBe(3);
    // 「90日ではない期限」の類型は valueId に日数が入るため、接頭辞で数える。
    const others = (topic?.valueGroups ?? [])
      .filter((g) => g.valueId.startsWith('stated_other_'))
      .reduce((n, g) => n + g.municipalityCodes.length, 0);
    expect(others).toBe(2);
  });

  it('マイナンバー: 「期限の記載を確認できない」区には期日を算定していない(90日を当てはめない)', () => {
    for (const cell of topic?.cells ?? []) {
      if (cell.valueId !== 'not_stated') continue;
      const rules = readJson<{ rules: Rule[] }>(
        `packages/rules/data/${cell.municipalityCode}/rules.json`,
      ).rules;
      const rule = rules.find((r) => r.procedureId === 'procedure_mynumber_continued_use');
      expect(rule?.dueRule.type, cell.municipalityCode).toBe('unknown');
    }
  });

  it('マイナンバー: 期日を算定している区は、その日数が自区の公式文言に実在する', () => {
    // なぜ: 90日そのものは「転入届出日」起算で算定できない。算定に使ってよいのは、同じ区が
    // 転入届側の条件として書いた日数(住み始めた日から◯日 / 転出予定日から◯日)だけである。
    let checked = 0;
    for (const cell of topic?.cells ?? []) {
      const rules = readJson<{ rules: Rule[] }>(
        `packages/rules/data/${cell.municipalityCode}/rules.json`,
      ).rules;
      const dueRule = rules.find(
        (r) => r.procedureId === 'procedure_mynumber_continued_use',
      )?.dueRule;
      const days =
        dueRule?.type === 'offsetDays'
          ? [dueRule.days]
          : dueRule?.type === 'earliestOf'
            ? dueRule.of.map((o) => o.days)
            : [];
      for (const d of days) {
        checked += 1;
        expect(d, cell.municipalityCode).not.toBe(90);
        expect(
          new RegExp(`${d}\\s*日`).test(cell.officialText),
          `${cell.municipalityCode}: ${d}日 が公式文言に無い — ${cell.officialText}`,
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
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
