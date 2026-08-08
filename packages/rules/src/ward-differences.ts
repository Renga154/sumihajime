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
 * 「N日以内」「Nか月以内」のように、期間 + 期限であることを示す語がセットで現れる箇所だけを拾う。
 * 「毎年9月30日」「手数料1,600円」のような期限ではない数値を構造的に除外するため、
 * 単位(日/か月)と限定語(以内・を経過 等)の両方を必須にする。
 */
const DURATION_PATTERN =
  /(\d{1,3})\s*(日|か月|ヶ月|カ月|箇月)\s*(以内|を経過|を過ぎ|以上経過|を超え|経過後)/g;

export type DeadlineUnit = 'day' | 'month';

export type StatedDeadline =
  | { readonly kind: 'absent' }
  | { readonly kind: 'duration'; readonly amount: number; readonly unit: DeadlineUnit }
  | { readonly kind: 'undetermined'; readonly reason: 'no_duration_found' | 'ambiguous' };

/**
 * 公式文言から「申請・届出の期限」を1つだけ取り出す。
 *
 * 判定順:
 *   1. 「記載がありません」等の否定があれば absent(数字が同じ文にあっても否定が勝つ)。
 *   2. 期間+限定語の組を全て集め、単位換算後に**ちょうど1種類**なら duration。
 *   3. 0種類、または2種類以上(=どれが当該手続きの期限か機械的に決められない)なら undetermined。
 *
 * 2種類以上を「多い方/最初の方」で選ばないのは、推測で期限を作らないため(原則3)。
 * undetermined が出た場合はUIが「判定できません」と出し、テストが検知して人手レビューへ回す。
 */
export function extractStatedDeadline(text: string): StatedDeadline {
  if (NO_STATEMENT_PATTERNS.some((p) => text.includes(p))) return { kind: 'absent' };

  const found = new Map<string, { amount: number; unit: DeadlineUnit }>();
  for (const m of text.matchAll(DURATION_PATTERN)) {
    const amount = Number(m[1]);
    const unit: DeadlineUnit = m[2] === '日' ? 'day' : 'month';
    found.set(`${unit}:${amount}`, { amount, unit });
  }

  if (found.size === 1) {
    const only = [...found.values()][0];
    if (only) return { kind: 'duration', amount: only.amount, unit: only.unit };
  }
  return { kind: 'undetermined', reason: found.size === 0 ? 'no_duration_found' : 'ambiguous' };
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
 * マイナンバーカードの継続利用で全国共通に用いられる日数。
 * この比較は「区の公式ページがこの日数を明記しているか」だけを見る(区ごとに日数を
 * 読み替えたり、記載のない区に90日を当てはめたりはしない)。
 */
const MYNUMBER_CONTINUED_USE_WINDOW = '90日';

/** 児童手当15日特例の起算日が「前住所地の転出予定日」であることを示す語。 */
const MOVE_OUT_SCHEDULED_DATE = '転出予定日';

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
    question: '転入届のあと、カードの継続利用はいつまでに手続きすればよい？',
    procedureId: 'procedure_mynumber_continued_use',
    derivationNote:
      '継続利用は「転入届出日から90日以内」という全国共通の運用ですが、区の公式ページに' +
      'その90日が明記されているかは区で分かれます。この比較は各区の公式文言に「90日」の記載が' +
      'あるかどうかだけを機械的に判定しており、記載のない区に90日を当てはめることはしません。',
    derive: ({ officialText }) =>
      officialText.includes(MYNUMBER_CONTINUED_USE_WINDOW)
        ? {
            valueId: 'stated_90days',
            label: '転入届出日から90日以内と明記',
            tone: 'neutral',
            sortKey: 90,
          }
        : cautionValue(
            'not_stated',
            '継続利用の期限（90日）を区の公式ページで確認できず（要確認）',
            0,
          ),
  },
  {
    topicId: 'child_allowance_15day_origin',
    title: '児童手当「15日特例」の起算日',
    question: '15日を数えはじめるのは、引越し日？　それとも前の住所での転出予定日？',
    procedureId: 'procedure_child_allowance',
    derivationNote:
      '各区の公式文言に「転出予定日」が起算日として書かれているかで分けています。' +
      '転出予定日が起算日の区では、本サービスが知らない前住所地の届出内容に依存するため、' +
      '引越し日から期日を算定できません（チェックリストでも日付を出さず公式文言を表示します）。',
    derive: ({ officialText, rule }) => {
      if (officialText.includes(MOVE_OUT_SCHEDULED_DATE)) {
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
