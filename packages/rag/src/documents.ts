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
 * ここは純関数のみ。D1アクセス・意図に基づく分岐は apps/api/src/chat.ts が持つ。
 */

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
 */
export function renderVerifiedDocumentAnswers(
  municipalityName: string,
  factsList: readonly VerifiedProcedureFacts[],
): string {
  if (factsList.length === 0) return '';
  const blocks = factsList.map((f) => renderProcedureBlock(municipalityName, f).join('\n').trim());
  const oldest = factsList.map((f) => isoDatePart(f.lastVerifiedAt)).sort()[0]!;
  const footer =
    `この回答は${municipalityName}の公式ページを人手で確認した記録（最終確認日: ${oldest}）に基づいています。` +
    'あてはまる条件は方によって異なるため、最終的な内容は下記の公式ページでご確認ください。';

  return [...blocks, footer]
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
