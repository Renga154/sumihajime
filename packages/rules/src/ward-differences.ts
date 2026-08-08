import type { ProcedureVersion, Rule } from '@tmn/schemas';

/**
 * なぜ: 23区すべてを整備して初めて見えた「同じ手続きでも区によって期限が違う」を、
 * 公開済みデータから機械的に集計する純関数群(比較ページ /differences のデータ源)。
 *
 * 設計上の絶対条件(CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」):
 *   ここが生成するのは「自治体をまたぐ比較」という、原則4が唯一許される文脈のデータである。
 *   したがって出力は専用のAPI(/api/ward-differences)と専用ページ(/differences)だけが使い、
 *   チェックリスト・手続き詳細・RAGの応答経路には一切流さない。各区の per-ward データ
 *   (data/normalized/{code}/*, packages/rules/data/{code}/rules.json)へ他区の値を書き戻す
 *   ことは cross-ward-text.test.ts が禁止しており、その不変条件はこのモジュールでも壊さない
 *   (このモジュールは既存データを読むだけで、データを書かない)。
 *
 * もう一つの絶対条件(原則2・3「根拠と最終確認日を必ず付ける / 推測しない」):
 *   比較値はハードコードした表ではなく、公開済みの rules.json / procedures.json から
 *   毎回導出する。導出できない区は「判定できない(要確認)」として正直に出し、推測で埋めない。
 *   根拠(承認済みソース)が1件も解決できない区は、比較から除外して omitted に載せる。
 */

/** 比較セルの根拠(表示用)。チェックリストの TaskSourceRef と同形状に揃える。 */
export interface WardDifferenceSourceRef {
  readonly sourceId: string;
  readonly title: string;
  readonly url: string;
  readonly lastVerifiedAt: string;
}

/** 1区分の入力。呼び出し側(API)が D1 から集めて渡す(この関数はI/Oを持たない)。 */
export interface WardDifferenceInput {
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly rules: readonly Rule[];
  readonly procedures: readonly ProcedureVersion[];
  /** その区で解決可能な承認済みソース(sourceId → 表示用参照)。 */
  readonly sources: ReadonlyMap<string, WardDifferenceSourceRef>;
}

/** 値の見た目の調子。caution は「記載なし・要確認」など、利用者が追加確認すべき値。 */
export type WardDifferenceTone = 'neutral' | 'caution';

/** 導出結果の値(区をまたいで同じ valueId なら同じ扱いの値)。 */
export interface WardDifferenceValue {
  readonly valueId: string;
  readonly label: string;
  readonly tone: WardDifferenceTone;
  /** 値の並び順(小さいほど先)。日数・月数は実際の長さ順、要確認系は末尾。 */
  readonly sortKey: number;
}

/** 1区 × 1トピックの比較セル。 */
export interface WardDifferenceCell {
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly valueId: string;
  readonly valueLabel: string;
  readonly tone: WardDifferenceTone;
  /** その区の公式文言(チェックリストで同じ区の利用者に見えている文と同一)。 */
  readonly officialText: string;
  readonly procedureTitle: string;
  readonly sources: readonly WardDifferenceSourceRef[];
}

/** 同じ値になった区のまとまり(分布)。 */
export interface WardDifferenceValueGroup {
  readonly valueId: string;
  readonly label: string;
  readonly tone: WardDifferenceTone;
  readonly municipalityCodes: readonly string[];
}

export interface WardDifferenceTopic {
  readonly topicId: string;
  readonly title: string;
  readonly question: string;
  readonly procedureId: string;
  /** この値をどうやって公式文言から機械判定したかの説明(利用者へ開示する)。 */
  readonly derivationNote: string;
  readonly valueGroups: readonly WardDifferenceValueGroup[];
  readonly cells: readonly WardDifferenceCell[];
  /** 手続き・ルール・承認済み根拠が揃わず比較対象にできなかった区。 */
  readonly omittedMunicipalityCodes: readonly string[];
}

export interface WardDifferenceReport {
  readonly municipalities: readonly { readonly code: string; readonly name: string }[];
  readonly topics: readonly WardDifferenceTopic[];
}

/* ------------------------------------------------------------------------- */
/* 公式文言からの期限抽出(推測しないことを最優先にした保守的な抽出器)          */
/* ------------------------------------------------------------------------- */

/**
 * 「公式ページに日数・期限の記載がない」と各区のデータが明示している言い回し。
 *
 * なぜ否定を最優先で判定するか: 記載が無いと明記した文の中に、別手続きの日数が引用されて
 * いることがある。例)葛飾区の犬の登録事項変更は「日数の期限はこのページには記載がありません
 * (『30日以内』は新たに犬を飼い始めたときの登録の期限です)」。数字を先に拾うと、
 * 別手続きの期限を転入手続きの期限として表示してしまう(原則3違反)。否定が勝つ設計にする。
 */
const NO_STATEMENT_PATTERNS: readonly string[] = [
  '記載がありません',
  '記載はありません',
  '記載がない',
  '記載はない',
  '記載なし',
  '記載を確認できません',
  '確認できませんでした',
  '確認できません',
];

/**
 * 否定が「期限そのもの」に掛かっていることを示す語。
 *
 * なぜ必要か: 否定を文書全体で見て一律に勝たせると、期限を明記している区まで「記載なし」に
 * 落ちる。例)目黒区のマイナンバーカード継続利用は「手続きできる期間は転入届出日から90日以内です。
 * …なお目黒区のページには、他区にある『転出予定日から30日を経過した転入届』…による**失効条件の
 * 記載がありません**」。この否定が指しているのは追加の失効条件であって、期限ではない。
 * 「期限・日数・期間・いつまで」等が同じ文にある否定だけを「期限の記載が無い」と解釈する。
 */
const DEADLINE_SUBJECT_TERMS: readonly string[] = [
  '期限',
  '日数',
  '期間',
  'いつまで',
  'いつから',
  '何日',
];

/** 文単位で否定の掛かり先を見るための素朴な分割(句点・改行)。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 「期限の記載が無い」と区自身が明記しているか(否定と期限語が同じ文に現れるか)。 */
function statesNoDeadline(text: string): boolean {
  return splitSentences(text).some(
    (sentence) =>
      NO_STATEMENT_PATTERNS.some((p) => sentence.includes(p)) &&
      DEADLINE_SUBJECT_TERMS.some((t) => sentence.includes(t)),
  );
}

/**
 * 「N日以内」「Nか月を経過」のように、期間 + 期限であることを示す語がセットで現れる箇所だけを拾う。
 * 「毎年9月30日」「手数料1,600円」のような期限ではない数値を構造的に除外するため、
 * 単位(日/か月)と限定語(以内・経過 等)の両方を必須にする。
 * 助詞は区によって揺れる(「90日が経過」「90日を経過」「15日経過」)ため、単位と限定語の間の
 * 助詞1文字だけを許容する(助詞なしの連続も許す)。
 */
const DURATION_PATTERN =
  /(\d{1,3})\s*(日|か月|ヶ月|カ月|箇月)\s*(?:以内|以上経過|経過後|[をがはも]?\s*(?:経過|過ぎ|超え))/g;

export type DeadlineUnit = 'day' | 'month';

export interface StatedDuration {
  readonly amount: number;
  readonly unit: DeadlineUnit;
}

/**
 * 公式文言に明記されている期限の**すべて**。
 *  - absent: 「記載がありません」等、期限の記載が無いと区自身が明記している。
 *  - durations: 明記されている期間の集合(重複除去済み・実際の長さの昇順)。空配列もあり得る。
 *
 * なぜ「1つに絞る前」の形を公開するか: トピックによって必要な粒度が違う。
 * 「その手続きの期限は1つ」という前提が置けるトピック(子ども医療費・犬)は
 * extractStatedDeadline で1つに絞るが、マイナンバーカードの継続利用のように
 * 「90日を明記する区」と「14日以内かつ30日以内のように別の期限を明記する区」を
 * 区別しなければならないトピックでは、区が実際に書いた日数をすべて見る必要がある。
 * ここを1つに畳んでしまうと、別の期限を明記している区が「判定できない=期限不明」に
 * 落ちて、記載の無い区と同じ扱いになる(利用者に猶予があるかのように誤導する)。
 */
export type StatedDeadlines =
  | { readonly kind: 'absent' }
  | { readonly kind: 'durations'; readonly durations: readonly StatedDuration[] };

/**
 * 公式文言に明記されている期限をすべて取り出す。
 *
 * 判定順:
 *   1. 「記載がありません」等の否定があれば absent(数字が同じ文にあっても否定が勝つ)。
 *   2. 期間+限定語の組を全て集め、重複を除いて実際の長さの昇順で返す。
 */
export function extractStatedDeadlines(text: string): StatedDeadlines {
  if (statesNoDeadline(text)) return { kind: 'absent' };

  const found = new Map<string, StatedDuration>();
  for (const m of text.matchAll(DURATION_PATTERN)) {
    const amount = Number(m[1]);
    const unit: DeadlineUnit = m[2] === '日' ? 'day' : 'month';
    found.set(`${unit}:${amount}`, { amount, unit });
  }

  const durations = [...found.values()].sort(
    (a, b) => durationSortKey(a.amount, a.unit) - durationSortKey(b.amount, b.unit),
  );
  return { kind: 'durations', durations };
}

export type StatedDeadline =
  | { readonly kind: 'absent' }
  | { readonly kind: 'duration'; readonly amount: number; readonly unit: DeadlineUnit }
  | { readonly kind: 'undetermined'; readonly reason: 'no_duration_found' | 'ambiguous' };

/**
 * 公式文言から「申請・届出の期限」を1つだけ取り出す(期限が1つに定まる前提のトピック用)。
 *
 * 判定順:
 *   1. 「記載がありません」等の否定があれば absent(数字が同じ文にあっても否定が勝つ)。
 *   2. 明記された期間が**ちょうど1種類**なら duration。
 *   3. 0種類、または2種類以上(=どれが当該手続きの期限か機械的に決められない)なら undetermined。
 *
 * 2種類以上を「多い方/最初の方」で選ばないのは、推測で期限を作らないため(原則3)。
 * undetermined が出た場合はUIが「判定できません」と出し、テストが検知して人手レビューへ回す。
 */
export function extractStatedDeadline(text: string): StatedDeadline {
  const all = extractStatedDeadlines(text);
  if (all.kind === 'absent') return { kind: 'absent' };

  if (all.durations.length === 1) {
    const only = all.durations[0];
    if (only) return { kind: 'duration', amount: only.amount, unit: only.unit };
  }
  return {
    kind: 'undetermined',
    reason: all.durations.length === 0 ? 'no_duration_found' : 'ambiguous',
  };
}

/** 期間の表示文字列(ラベル生成と、テストが公式文言と突き合わせるときの共通形)。 */
export function formatDuration({ amount, unit }: StatedDuration): string {
  return unit === 'day' ? `${amount}日以内` : `${amount}か月以内`;
}

/** 期間値の並び順を「実際の長さ」で決める(日と月を混ぜても順序が壊れないように日数換算)。 */
function durationSortKey(amount: number, unit: DeadlineUnit): number {
  return unit === 'day' ? amount : amount * 31;
}

function durationValue(amount: number, unit: DeadlineUnit, suffix: string): WardDifferenceValue {
  const label = unit === 'day' ? `${amount}日以内${suffix}` : `${amount}か月以内${suffix}`;
  return {
    valueId: `${unit}_${amount}`,
    label,
    tone: 'neutral',
    sortKey: durationSortKey(amount, unit),
  };
}

/** 要確認系の値は分布の末尾に置く(短い期限ほど先に見せたいため)。 */
const CAUTION_SORT_KEY = 1_000_000;

function cautionValue(valueId: string, label: string, offset = 0): WardDifferenceValue {
  return { valueId, label, tone: 'caution', sortKey: CAUTION_SORT_KEY + offset };
}

/* ------------------------------------------------------------------------- */
/* トピック定義                                                                */
/* ------------------------------------------------------------------------- */

export interface TopicContext {
  readonly rule: Rule;
  readonly procedure: ProcedureVersion;
  /**
   * 比較に使う公式文言。ルールの dueDescription を優先する。
   * なぜ: チェックリストの期限表示は評価器が rule.dueDescription をそのまま出す
   * (packages/rules/src/evaluate.ts)。同じ文を比較ページでも見せることで、
   * 「自分の区のチェックリストに書いてあった文」と突き合わせられる。
   */
  readonly officialText: string;
}

export interface WardDifferenceTopicSpec {
  readonly topicId: string;
  readonly title: string;
  readonly question: string;
  readonly procedureId: string;
  readonly derivationNote: string;
  readonly derive: (ctx: TopicContext) => WardDifferenceValue;
}

/**
 * マイナンバーカードの継続利用で全国共通に用いられる日数(転入届出日から90日)。
 * この日数は「区の公式文言に明記されているか」の判定にだけ使う。
 * 記載の無い区に当てはめたり、別の期限を明記している区の日数を上書きしたりはしない。
 */
const MYNUMBER_COMMON_WINDOW_DAYS = 90;

/** 児童手当15日特例の起算日が「前住所地の転出予定日」であることを示す語。 */
const MOVE_OUT_SCHEDULED_DATE = '転出予定日';

/**
 * 起算日(何の日から数えるか)を区が定義していないと明記している言い回し。
 *
 * なぜ児童手当トピック限定にするか: 「『転入日』が転出予定日か引越し日かの定義がない」という
 * 断り書きは、子ども医療費助成の文言にも出てくるが、そちらでは**日数の期限そのものは
 * 明記されている**(例: 15日以内)。この語を汎用の否定パターン(NO_STATEMENT_PATTERNS)へ
 * 入れると、期限を明記している区まで「記載なし」に落ちてしまう。
 * 起算日を問うこのトピックでだけ、否定として扱う。
 */
const ORIGIN_UNDEFINED_PATTERNS: readonly string[] = [
  '定義がない',
  '定義がありません',
  '定義はありません',
];

/** 否定が「起算日」に掛かっていることを示す語(否定の掛かり先を文単位で確かめる)。 */
const ORIGIN_SUBJECT_TERMS: readonly string[] = ['起算', '定義', '転入日'];

/** 「起算日が公式ページから特定できない」と区自身が明記しているか。 */
function statesNoOrigin(text: string): boolean {
  return splitSentences(text).some(
    (sentence) =>
      [...NO_STATEMENT_PATTERNS, ...ORIGIN_UNDEFINED_PATTERNS].some((p) => sentence.includes(p)) &&
      ORIGIN_SUBJECT_TERMS.some((t) => sentence.includes(t)),
  );
}

export const WARD_DIFFERENCE_TOPICS: readonly WardDifferenceTopicSpec[] = [
  {
    topicId: 'child_medical_application_deadline',
    title: '子ども医療費助成の申請期限',
    question: '転入日にさかのぼって助成を受けるには、いつまでに申請すればよい？',
    procedureId: 'procedure_child_medical',
    derivationNote:
      '各区の公式文言から「N日以内」「Nか月以内」の記載を機械的に取り出しています。' +
      '「記載がありません」と明記している区は、数字を推測せず「記載なし(要確認)」として表示します。',
    derive: ({ officialText }) => {
      const d = extractStatedDeadline(officialText);
      if (d.kind === 'absent') {
        return cautionValue(
          'not_stated',
          '区の公式ページに申請期限の記載なし（要確認）',
          /* offset */ 0,
        );
      }
      if (d.kind === 'duration') return durationValue(d.amount, d.unit, 'に申請');
      return cautionValue('undetermined', '公式文言から期限を判定できません（要確認）', 1);
    },
  },
  {
    topicId: 'mynumber_continued_use_window',
    title: 'マイナンバーカードの継続利用の期限',
    question: 'カードを引き続き使うための手続きは、いつまでに済ませればよい？',
    procedureId: 'procedure_mynumber_continued_use',
    derivationNote:
      '各区の公式文言から「N日以内」「Nか月以内」の記載を機械的に取り出し、' +
      '(1)全国共通の運用である「転入届出日から90日以内」を明記している区、' +
      '(2)90日ではない期限（引越し日から14日以内など）を明記している区、' +
      '(3)期限の記載を公式ページで確認できないと区自身が明記している区、の3通りに分けています。' +
      '(2)では区が実際に書いている日数をそのまま表示します（90日に読み替えません）。' +
      '(3)の区に90日を当てはめることもしません。',
    derive: ({ officialText }) => {
      const stated = extractStatedDeadlines(officialText);
      // 区自身が「確認できない」と明記している場合のみ、要確認として扱う(原則3)。
      if (stated.kind === 'absent') {
        return cautionValue(
          'not_stated',
          '継続利用の期限の記載を区の公式ページで確認できず（要確認）',
          0,
        );
      }
      if (stated.durations.length === 0) {
        return cautionValue(
          'undetermined',
          '公式文言から継続利用の期限を判定できません（要確認）',
          1,
        );
      }
      if (
        stated.durations.some((d) => d.unit === 'day' && d.amount === MYNUMBER_COMMON_WINDOW_DAYS)
      ) {
        return {
          valueId: 'stated_90days',
          label: `転入届出日から${MYNUMBER_COMMON_WINDOW_DAYS}日以内と明記`,
          tone: 'neutral',
          sortKey: MYNUMBER_COMMON_WINDOW_DAYS,
        };
      }
      // 90日ではない期限を明記している区。**記載が無い区と同じ扱いにしてはならない**:
      // これらの区の期限は90日より短いことがあり(例: 引越し日から14日以内)、
      // 「期限を確認できず」と見せると、猶予があるかのように誤導して失効の実害につながる。
      const shortest = stated.durations[0];
      if (!shortest) {
        return cautionValue(
          'undetermined',
          '公式文言から継続利用の期限を判定できません（要確認）',
          1,
        );
      }
      const shortestKey = durationSortKey(shortest.amount, shortest.unit);
      const listed = stated.durations.map(formatDuration).join('・');
      return {
        valueId: `stated_other_${stated.durations.map((d) => `${d.unit}_${d.amount}`).join('_')}`,
        label:
          `${MYNUMBER_COMMON_WINDOW_DAYS}日ではなく「${listed}」と明記` +
          (shortestKey < MYNUMBER_COMMON_WINDOW_DAYS
            ? `（${MYNUMBER_COMMON_WINDOW_DAYS}日より短い期限）`
            : ''),
        tone: 'neutral',
        sortKey: shortestKey,
      };
    },
  },
  {
    topicId: 'child_allowance_15day_origin',
    title: '児童手当「15日特例」の起算日',
    question: '15日を数えはじめるのは、引越し日？　それとも前の住所での転出予定日？',
    procedureId: 'procedure_child_allowance',
    derivationNote:
      '各区の公式文言に「転出予定日」が起算日として書かれているかで分けています。' +
      '転出予定日が起算日の区では、本サービスが知らない前住所地の届出内容に依存するため、' +
      '引越し日から期日を算定できません（チェックリストでも日付を出さず公式文言を表示します）。' +
      'なお「起算日の定義が公式ページにない」と明記している区は、文中に「転出予定日」の語が' +
      '出てきても“転出予定日が起算日”とはみなさず、「起算日を特定できず（要確認）」とします。',
    derive: ({ officialText, rule }) => {
      // 否定が勝つ。「転入日が転出予定日か引越し日かの定義がない」と書いている区の文にも
      // 「転出予定日」の語は現れるため、語の有無だけで判定すると、区が言っていない起算日を
      // その区の見解として表示してしまう(原則3)。
      if (!statesNoOrigin(officialText) && officialText.includes(MOVE_OUT_SCHEDULED_DATE)) {
        return cautionValue(
          'move_out_scheduled_date',
          '前住所地の「転出予定日」が起算日（引越し日からは期日を算定できない）',
          0,
        );
      }
      if (rule.dueRule.type === 'offsetDays') {
        return {
          valueId: 'move_date',
          label: `引越し日から${rule.dueRule.days}日以内として期日を算定`,
          tone: 'neutral',
          sortKey: rule.dueRule.days,
        };
      }
      return cautionValue(
        'not_stated',
        '起算日を公式文言から特定できず、期日を算定していない（要確認）',
        1,
      );
    },
  },
  {
    topicId: 'dog_registration_change_days',
    title: '犬の登録事項変更（転入時）の日数',
    question: '飼い犬の住所変更は、何日以内に届け出ればよい？',
    procedureId: 'procedure_dog_registration_transfer',
    derivationNote:
      '各区の公式文言から「N日以内」を機械的に取り出しています。狂犬病予防法の30日以内を' +
      '転入時の届出期限として明記している区と、日数を書いていない区に分かれます。' +
      '「新たに飼い始めたときの登録は30日以内」のように別手続きの日数だけが書かれている区は、' +
      'その数字を転用せず「記載なし(要確認)」とします。',
    derive: ({ officialText }) => {
      const d = extractStatedDeadline(officialText);
      if (d.kind === 'absent') {
        return cautionValue('not_stated', '区の公式ページに日数の記載なし（要確認）', 0);
      }
      if (d.kind === 'duration') return durationValue(d.amount, d.unit, 'に届出');
      return cautionValue('undetermined', '公式文言から日数を判定できません（要確認）', 1);
    },
  },
];

/* ------------------------------------------------------------------------- */
/* 集計                                                                        */
/* ------------------------------------------------------------------------- */

function resolveSources(
  rule: Rule,
  procedure: ProcedureVersion,
  lookup: ReadonlyMap<string, WardDifferenceSourceRef>,
): WardDifferenceSourceRef[] {
  // なぜ: ルールが根拠として宣言した順を保ちつつ、手続き側の sourceIds も補う。
  // 解決できないIDは黙って落とす(未承認・未登録の根拠を表示しない=原則2)。
  const ids = [...new Set([...rule.sourceIds, ...procedure.sourceIds])];
  const out: WardDifferenceSourceRef[] = [];
  for (const id of ids) {
    const s = lookup.get(id);
    if (s) out.push(s);
  }
  return out;
}

function buildTopic(
  spec: WardDifferenceTopicSpec,
  wards: readonly WardDifferenceInput[],
): WardDifferenceTopic {
  const cells: WardDifferenceCell[] = [];
  const omitted: string[] = [];
  const values = new Map<string, WardDifferenceValue>();
  const codesByValue = new Map<string, string[]>();

  for (const ward of wards) {
    const rule = ward.rules.find((r) => r.procedureId === spec.procedureId);
    const procedure = ward.procedures.find((p) => p.id === spec.procedureId);
    // なぜ: 未整備の区を「該当なし」に見せない(原則9)。比較対象から外し omitted で開示する。
    if (!rule || !procedure) {
      omitted.push(ward.municipalityCode);
      continue;
    }

    const sources = resolveSources(rule, procedure, ward.sources);
    if (sources.length === 0) {
      // 承認済み根拠を1件も付けられない値は公開しない(原則2)。
      omitted.push(ward.municipalityCode);
      continue;
    }

    const officialText = rule.dueDescription ?? procedure.dueDescription ?? '';
    const value = spec.derive({ rule, procedure, officialText });
    values.set(value.valueId, value);
    codesByValue.set(value.valueId, [
      ...(codesByValue.get(value.valueId) ?? []),
      ward.municipalityCode,
    ]);

    cells.push({
      municipalityCode: ward.municipalityCode,
      municipalityName: ward.municipalityName,
      valueId: value.valueId,
      valueLabel: value.label,
      tone: value.tone,
      officialText,
      procedureTitle: procedure.title,
      sources,
    });
  }

  const valueGroups: WardDifferenceValueGroup[] = [...values.values()]
    .map((v) => ({
      valueId: v.valueId,
      label: v.label,
      tone: v.tone,
      municipalityCodes: codesByValue.get(v.valueId) ?? [],
      sortKey: v.sortKey,
    }))
    // 区数の多い順 → 同数なら期限の短い順(要確認系は末尾)。区が増えても決定論的に並ぶ。
    .sort(
      (a, b) => b.municipalityCodes.length - a.municipalityCodes.length || a.sortKey - b.sortKey,
    )
    .map(({ valueId, label, tone, municipalityCodes }) => ({
      valueId,
      label,
      tone,
      municipalityCodes,
    }));

  return {
    topicId: spec.topicId,
    title: spec.title,
    question: spec.question,
    procedureId: spec.procedureId,
    derivationNote: spec.derivationNote,
    valueGroups,
    cells,
    omittedMunicipalityCodes: omitted,
  };
}

/**
 * 公開済みデータ(各区の rules / procedures / 承認済みソース)から、区をまたぐ差分レポートを作る。
 * 入力に含まれた区だけを扱うため、対応区が増えれば出力も自動的に追随する(表のハードコードなし)。
 */
export function buildWardDifferences(wards: readonly WardDifferenceInput[]): WardDifferenceReport {
  const sorted = [...wards].sort((a, b) => a.municipalityCode.localeCompare(b.municipalityCode));
  return {
    municipalities: sorted.map((w) => ({ code: w.municipalityCode, name: w.municipalityName })),
    topics: WARD_DIFFERENCE_TOPICS.map((spec) => buildTopic(spec, sorted)),
  };
}
