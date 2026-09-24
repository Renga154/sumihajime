/**
 * なぜ1か所に置くのか: 誤り報告・問い合わせの窓口はフッター・利用規約・プライバシーポリシー・
 * 手続き詳細の4か所から参照する。URLが散らばると片方だけ古い窓口を指す事故が起きる。
 *
 * 窓口は Google フォーム（2026-09-22 ユーザー決裁、2026-09-24 公開）。メールアドレスを
 * 公開せずに受け取れるため。フォームはメールアドレスを収集せず、ログインも求めない設定にしてあり、
 * 受け取った内容の扱いはプライバシーポリシーに書いてある。
 *
 * undefined にすると各画面が窓口の節ごと出さない（「準備中」と書いた窓口を公開しない）。
 */
export const FEEDBACK_FORM_URL: string | undefined =
  'https://docs.google.com/forms/d/e/1FAIpQLSdrMznkVeP9cFbEuxQ8evNTGKaZtLbIbZCvc6KKcE6tUnYByw/viewform';

/** 窓口で受け付ける内容。フォームの「お問い合わせの種類」の選択肢と一字一句そろえる。 */
export const FEEDBACK_TOPICS = [
  'データの誤り（期限・持ち物・窓口・リンク切れなど）',
  '自治体からのご連絡',
  '使いにくい点・不具合のご報告',
] as const;

/**
 * フォームの設問ID(entry.*)。フォームの設問を作り直すと変わるので、変えたら
 * contact.test.ts の期待値と一緒に更新する(公開フォームの FB_PUBLIC_LOAD_DATA_ で確認できる)。
 */
const ENTRY = {
  topic: 'entry.1595257451',
  target: 'entry.550992746',
  pageUrl: 'entry.242184327',
} as const;

/**
 * 手続き詳細から開く「誤りを報告」リンク。種類・対象・ページURLを事前入力する。
 *
 * なぜ事前入力するのか: 誤りに気づいた人に「どの区のどの手続きか」を書かせると、報告の手間が
 * 増えるうえに対象が特定できない報告が混ざる。事前入力するのは手続き名・自治体コード・
 * ページのURLだけで、利用者の入力条件（引越し日・世帯など）は一切載せない（原則6・7）。
 */
export function buildReportUrl(input: {
  procedureTitle: string;
  municipalityCode: string;
  pageUrl: string;
}): string | undefined {
  if (!FEEDBACK_FORM_URL) return undefined;
  const params = new URLSearchParams({
    usp: 'pp_url',
    [ENTRY.topic]: FEEDBACK_TOPICS[0],
    [ENTRY.target]: `${input.procedureTitle}（自治体コード ${input.municipalityCode}）`,
    [ENTRY.pageUrl]: input.pageUrl,
  });
  return `${FEEDBACK_FORM_URL}?${params.toString()}`;
}
