/**
 * なぜ: 「必要書類・持ち物」の質問に対し、**人手レビュー済みの構造化データ**
 * (data/normalized/<区>/procedures.json の requiredDocuments[] → D1 procedure_versions)を
 * 根拠として回答するための純関数群(ADR-010 案A)。
 *
 * 背景(本番実測 2026-08-08): 自治体の公式ページは持ち物を**複数の並列ブロック**で書く
 * (江戸川=ワンストップ/特例転出/紙の転出証明書の場合分け、葛飾=「届出人・本人確認書類について」が
 * 転入/転出/転居の上位に共通で置かれる)。生成モデルは1ブロックだけを読んで答え、他ブロックの
 * **無条件で必須の書類**(本人確認書類・転出証明書)を落とし、選んだブロックの「お持ちの方」限定
 * 項目を唯一の必須物として断定していた。検索は成功しており(該当チャンクは全てプロンプト窓内)、
 * **統合の失敗**なので、プロンプト強化だけでは根治しない。
 *
 * そこで CLAUDE.md 原則1「チェックリストの該当判定をLLMへ任せない」の趣旨に合わせ、
 * 必要書類については **required / conditional の区別を持つ検証済み構造** をそのまま提示する。
 * LLMは事実の抽出にも整形にも関与しない(=モデルが項目を落とす経路が存在しない)。
 *
 * 追記(本番実測 2026-08-08 / 世田谷): この経路は逆向きの欠陥も持っていた。1文で2つ尋ねられたとき
 * (「犬の登録に必要な持ち物と、粗大ごみの出し方を教えてください」)、**答えられない側の話題を
 * 一言も告げずに捨てて** HTTP 200 を返していた。手続きの選択が「採用できなかったcategoryを
 * 変数にも残さない」ループだったため、落選の事実がどこにも存在しなかったのが原因である。
 * 答えられないなら答えられないと言う(CLAUDE.md 原則3。推測しないことと、黙って消さないことは表裏)。
 * そこで選択を selectDocumentProcedures(選ばれた手続き **と** 落選した話題の両方を返す純関数)に
 * 置き換え、落選は renderVerifiedDocumentAnswers が必ず本文へ注記として書く。
 *
 * ここは純関数のみ。D1アクセス・意図に基づく分岐は apps/api/src/chat.ts が持つ。
 */

import { categoryLabel } from './intent.js';

/** 質問が「必要書類・持ち物」を主題にしていると判断できる語(部分一致)。 */
export const DOCUMENT_INTENT_KEYWORDS: readonly string[] = [
  '持ち物',
  '持参',
  '持っていくもの',
  '持って行くもの',
  '持っていく物',
  '必要書類',
  '必要な書類',
  '必要なもの',
  '必要な物',
  'いるもの',
  '用意するもの',
  '用意する物',
  '準備するもの',
  '準備する物',
  '何を持って',
  '何が必要',
  '何を用意',
  '何を準備',
  'どんな書類',
  'どの書類',
] as const;

/**
 * 質問が必要書類・持ち物を尋ねているか(決定論的・LLM非依存)。
 * 「必要な手続き」等の弱い語は採用しない(手続き一覧の質問まで書類回答へ吸い込まないため)。
 */
export function hasDocumentIntent(question: string): boolean {
  return DOCUMENT_INTENT_KEYWORDS.some((k) => question.includes(k));
}

/**
 * 質問文が「選択中の自治体以外」の自治体名を含むか。
 *
 * なぜ必要か: 構造化データ経路は選択自治体のレコードを断定的に提示する。越境質問
 * (例: 新宿区を選択中に「世田谷区の転入届の持ち物は?」)でこれを返すと、利用者が尋ねた区とは
 * 別の区の内容を、区名を確かめないまま断定することになる(CLAUDE.md 原則4)。越境が疑われる
 * ときは構造化経路を使わず、越境を保留するプロンプト規則3を持つ従来のRAG経路へ委ねる。
 */
export function mentionsOtherMunicipality(
  question: string,
  selfName: string,
  otherNames: readonly string[],
): boolean {
  return otherNames.some((n) => n.length > 0 && n !== selfName && question.includes(n));
}

/** requiredDocuments[] の1件(@tmn/schemas の RequiredDocument と構造的に一致)。 */
export interface VerifiedDocument {
  label: string;
  status: 'required' | 'conditional' | 'unknown';
}

/** 回答の根拠にする検証済み手続きレコード(必要な範囲のみを構造的に受け取る)。 */
export interface VerifiedProcedureFacts {
  title: string;
  requiredDocuments: readonly VerifiedDocument[];
  dueDescription?: string;
  contact?: string;
  /** ISO datetime。人手レビューでこのレコードを確認した日。 */
  lastVerifiedAt: string;
}

/**
 * ISO datetime → 'YYYY-MM-DD'。
 * なぜ日本語表記(YYYY年M月D日)にしないか: 評価ハーネスの「日数・期限表現」抽出(\d+年 等)に
 * 最終確認日が誤ってヒットし、期限の断定と区別できなくなるため。日付粒度のデータ
 * (T00:00:00Z 固定)なのでタイムゾーン変換は行わず、UTCの日付部分をそのまま用いる。
 */
export function isoDatePart(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

const SECTION_REQUIRED = '■ 必ず必要なもの';
const SECTION_CONDITIONAL = '■ 場合により必要なもの（あてはまる方のみ）';
const SECTION_UNKNOWN = '■ 公式ページでの確認が必要なもの';
const SECTION_UNRESOLVED = '■ この回答でご案内できなかったこと';

/**
 * 検証済みデータ経路が、質問に含まれていた話題を回答へ載せられなかった理由。
 *
 * なぜ理由を型で残すか: 利用者向けの文面は2種類に畳むが(下記)、**運用上はこの3つを
 * 区別できなければならない**。no_verified_record は「データを足すべき」信号、
 * ambiguous_records は「同一カテゴリに複数版が並んだ」構造の信号、limit_reached は
 * 「回答の長さ制限に当たった」製品判断の信号で、打つべき手が全く違う。
 */
export type UnresolvedReason =
  /** そのカテゴリに、書類一覧を持つ検証済みレコードが1件も無い(例: ごみ収集日は持ち物の手続きではない)。 */
  | 'no_verified_record'
  /** 候補が2件以上あり、どれを断定してよいか決められない(原則3: 推測しない)。 */
  | 'ambiguous_records'
  /** 該当レコードはあるが、1回答に並べる手続き数の上限に達したため載せなかった。 */
  | 'limit_reached';

/** 回答へ載せられなかった話題1件。 */
export interface UnresolvedTopic {
  /** 内部category(canonicalType)。**利用者向け文面には出さない**(categoryLabelを通す)。 */
  category: string;
  reason: UnresolvedReason;
  /**
   * そのカテゴリで見つかった検証済みレコードの出典ID(順序保持・重複除去)。
   * 呼び出し側がここから公式URLを解決して officialUrl に載せる(D1アクセスは純関数に持ち込まない)。
   */
  sourceIds: string[];
  /** 解決できた公式ページURL。無ければ文面は自治体公式サイトへの一般的な誘導へ退避する。 */
  officialUrl?: string;
}

/**
 * 「回答に含められなかった」1行の文面。
 *
 * ここが本修正の核心: 以前はこの話題が**何も言わずに消えていた**ため、利用者は「聞いたことの片方が
 * 無視された」ことに気づけなかった(本番実測 2026-08-08 / 世田谷: 「犬の登録に必要な持ち物と、
 * 粗大ごみの出し方」で粗大ごみ側が無言で落ちた)。答えられないなら答えられないと言う
 * (CLAUDE.md 原則3)。
 *
 * なぜ no_verified_record と ambiguous_records を同じ文面にするか:
 *   どちらも利用者にとっての意味は「この回答では確認できなかった」で同一であり、**次の行動も同一**
 *   (公式ページを見る)。違いは当方のデータ状態(レコードが無い/複数ある)であって、説明するには
 *   内部構造の語彙が要る。行動が変わらない区別を利用者向け文面へ持ち込まない。
 *
 * なぜ limit_reached だけ文面を分けるか:
 *   上限に当たった場合は**該当レコードが存在している**。ここで「確認できませんでした」と書くと、
 *   確認できているものを確認できていないと述べる=事実に反する断定になる(原則3は逆向きの嘘も禁じる)。
 *   かつ利用者が取れる行動が違う(分けて聞けば答えが得られる)ので、そう案内する。
 *
 * 文面の制約:
 * - 内部用語(経路名・変数名・案A/案C・enum名)を含めない。
 * - 数字+日/年/か月/週間 を含めない。評価ハーネスの期限抽出(scripts/eval の
 *   extractDeadlineExpressions)が本文の日数表現を「根拠なき期限の断定」候補として拾うため、
 *   注記が誤検出されると本物の期限断定と区別できなくなる(isoDatePart と同じ理由)。
 *   URLに数字が含まれても、抽出は数字の**直後の漢字**を要求するので一致しない。
 */
function unresolvedLine(municipalityName: string, topic: UnresolvedTopic): string {
  const label = categoryLabel(topic.category);
  const where = topic.officialUrl
    ? `${municipalityName}の公式ページ（${topic.officialUrl}）でご確認ください。`
    : `${municipalityName}の公式サイトでご確認ください。`;
  const cause =
    topic.reason === 'limit_reached'
      ? 'ご質問が複数のお手続きにわたるため、この回答には含めていません。お手数ですが分けてお尋ねいただくか、'
      : 'お尋ねの内容は、この回答ではご案内できませんでした。';
  return `・${label}: ${cause}${where}`;
}

/** 落とした話題の注記ブロック(1件も無ければ空配列)。 */
function renderUnresolvedBlock(
  municipalityName: string,
  unresolved: readonly UnresolvedTopic[],
): string[] {
  if (unresolved.length === 0) return [];
  return [SECTION_UNRESOLVED, ...unresolved.map((t) => unresolvedLine(municipalityName, t))];
}

/**
 * 検証済み構造 → 回答本文(日本語)。§11.4「①端的な回答 → ②条件・注意事項」に沿う。
 *
 * 不変条件:
 * - status='required' と 'conditional' を**必ず別の見出しの下に**置く。conditional を必須として
 *   断定しない/required を落とさない(これが本修正の目的)。
 * - requiredDocuments に無い書類を足さない・言い換えない(labelは公式文言のまま)。
 * - required が0件のときは「必ず必要なもの」見出しを出さない(空の必須を装わない)。
 */
export function renderVerifiedDocumentAnswer(
  municipalityName: string,
  facts: VerifiedProcedureFacts,
): string {
  return renderVerifiedDocumentAnswers(municipalityName, [facts]);
}

/** 1回答に並べる手続き数の上限の既定値(呼び出し側が上書き可)。 */
export const DEFAULT_MAX_DOCUMENT_PROCEDURES = 2;

/** selectDocumentProcedures が読む最小形状(@tmn/schemas の ProcedureVersion と構造的に一致)。 */
export interface DocumentProcedureLike {
  canonicalType: string;
  dataStatus: string;
  requiredDocuments: readonly unknown[];
  sourceIds: readonly string[];
}

export interface DocumentProcedureSelection<T> {
  /** 回答本文に並べる手続き(質問での言及順)。 */
  selected: T[];
  /** 質問に含まれていたが回答へ載せられなかった話題(言及順)。**必ず利用者へ明示する**。 */
  unresolved: UnresolvedTopic[];
}

/**
 * 質問が主題とするcategory列から、回答に使う検証済み手続きを選ぶ純関数。
 *
 * なぜこの判定を純関数へ出したか(本修正): 以前この選択は apps/api のハンドラ内のループにあり、
 * 「採用できなかったcategory」を**変数にも残さずに捨てていた**(`if (candidates.length === 1)` の
 * else が無い / 上限到達で `break`)。捨てた事実が値として存在しないので、利用者へ伝えることも
 * テストで固定することもできなかった。落選を戻り値の一部にすることで、無言の欠落が
 * 型の上で起こり得なくなる(CLAUDE.md §4 ドメイン判定はUI/APIへ埋め込まない、§7 純関数化)。
 *
 * 決定論的・LLM非依存。categories の順序(質問での言及順)をそのまま尊重する。
 */
export function selectDocumentProcedures<T extends DocumentProcedureLike>(
  categories: readonly string[],
  procedures: readonly T[],
  maxProcedures: number = DEFAULT_MAX_DOCUMENT_PROCEDURES,
): DocumentProcedureSelection<T> {
  const selected: T[] = [];
  const unresolved: UnresolvedTopic[] = [];

  for (const category of categories) {
    // なぜ「書類の有無を問わない検証済みレコード」から出典を拾うか: 落選した話題にも
    // 公式ページへの導線を付けたい。例えばごみ収集日の手続きは requiredDocuments が空
    // (持ち物の手続きではない)だが、検証済みの公式ページ出典は持っている。
    const verified = procedures.filter(
      (p) => p.canonicalType === category && p.dataStatus === 'verified',
    );
    const sourceIds = [...new Set(verified.flatMap((p) => [...p.sourceIds]))];

    if (selected.length >= maxProcedures) {
      unresolved.push({ category, reason: 'limit_reached', sourceIds });
      continue;
    }

    const candidates = verified.filter((p) => p.requiredDocuments.length > 0);
    if (candidates.length === 1) {
      selected.push(candidates[0]!);
      continue;
    }
    // なぜ1件のときだけ採用するか: 同一カテゴリに複数の手続き版が並ぶ区が現れた場合、
    // どれを断定してよいか決められない。曖昧なまま断定せず、そのカテゴリは採らない(原則3)。
    // ただし**採らなかったことは必ず戻り値へ残す**(以前はここで黙って消えていた)。
    unresolved.push({
      category,
      reason: candidates.length === 0 ? 'no_verified_record' : 'ambiguous_records',
      sourceIds,
    });
  }

  return { selected, unresolved };
}

/** 1手続き分の本文ブロック(末尾の共通注記は含まない)。 */
function renderProcedureBlock(municipalityName: string, facts: VerifiedProcedureFacts): string[] {
  const required = facts.requiredDocuments.filter((d) => d.status === 'required');
  const conditional = facts.requiredDocuments.filter((d) => d.status === 'conditional');
  const unknown = facts.requiredDocuments.filter((d) => d.status === 'unknown');

  const lines: string[] = [
    `${municipalityName}の「${facts.title}」に必要なものは、次のとおりです。`,
    '',
  ];

  const section = (heading: string, docs: readonly VerifiedDocument[]): void => {
    if (docs.length === 0) return;
    lines.push(heading);
    for (const d of docs) lines.push(`・${d.label}`);
    lines.push('');
  };

  section(SECTION_REQUIRED, required);
  section(SECTION_CONDITIONAL, conditional);
  section(SECTION_UNKNOWN, unknown);

  if (facts.dueDescription) {
    lines.push('■ 届出の期限');
    lines.push(facts.dueDescription);
    lines.push('');
  }
  if (facts.contact) {
    lines.push('■ お問い合わせ');
    lines.push(facts.contact);
    lines.push('');
  }

  return lines;
}

/**
 * 複数手続き分をまとめて1つの回答にする。
 *
 * なぜ複数を許すか(本番実測 2026-08-08): 利用者は1文に複数の手続きを書く
 * (「転入届に必要な持ち物は？マイナンバーカードは必要ですか？」)。以前はカテゴリが複数一致すると
 * 構造化データ経路を諦めてRAGへ戻していたが、そのRAG回答こそが必須の本人確認書類を落としていた
 * (葛飾・江戸川で実測)。**どれか1つを推測で選ぶのではなく、該当する手続きをそれぞれ手続き名つきで
 * 並べる**ことで、誤った手続きへ帰属させることなく取りこぼしを無くす(原則3: 推測しない)。
 *
 * 最終確認日は最も古いものを示す(「少なくともこの日時点で確認済み」という保守的な表示)。
 *
 * unresolved: 質問に含まれていたが回答へ載せられなかった話題(selectDocumentProcedures の戻り値)。
 * 与えられた場合は必ず本文へ注記として現れる。**無言で落とさない**ことがこの引数の存在理由なので、
 * 省略できるのは「落選が1件も無い」ときだけである。
 *
 * 注記を末尾の共通注記(最終確認日)より前に置く理由: 末尾の注記は**回答できた内容の来歴**であり、
 * 回答の締めとして最後に置くのが既存の構成。落選の案内は本文側の情報なので手続きブロックの直後に続ける。
 */
export function renderVerifiedDocumentAnswers(
  municipalityName: string,
  factsList: readonly VerifiedProcedureFacts[],
  unresolved: readonly UnresolvedTopic[] = [],
): string {
  if (factsList.length === 0) return '';
  const blocks = factsList.map((f) => renderProcedureBlock(municipalityName, f).join('\n').trim());
  const notice = renderUnresolvedBlock(municipalityName, unresolved);
  const oldest = factsList.map((f) => isoDatePart(f.lastVerifiedAt)).sort()[0]!;
  const footer =
    `この回答は${municipalityName}の公式ページを人手で確認した記録（最終確認日: ${oldest}）に基づいています。` +
    'あてはまる条件は方によって異なるため、最終的な内容は下記の公式ページでご確認ください。';

  return [...blocks, ...(notice.length > 0 ? [notice.join('\n')] : []), footer]
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
