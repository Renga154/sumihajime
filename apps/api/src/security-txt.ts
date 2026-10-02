/**
 * GET /.well-known/security.txt の本文(RFC 9116)。
 *
 * なぜ置くのか: 脆弱性に気づいた人が「どこへ知らせればよいか」を探す標準の場所。窓口が無いと、
 * 報告が公開の場(SNS・Issue)に出るか、報告そのものが諦められる。
 *
 * Contact は画面の問い合わせ窓口(apps/web/src/content/contact.ts の FEEDBACK_FORM_URL)と同じ
 * フォームにする。メールアドレスを公開しない方針(2026-09-22 決裁)を変えないため。web の定数を
 * Worker から import すると web の依存(React 周り)を Worker の束に引き込むので、値を写して
 * security-txt.test.ts で一致を検査する(片方だけ変わる事故を防ぐ)。
 *
 * Expires は RFC 9116 §2.5.5 が「1年以内」を推奨する。期限切れの security.txt は「窓口が
 * 放置されている」合図になるため、切れる前に日付を更新する(テストが期限切れで落ちる)。
 *
 * Canonical は CANONICAL_ORIGIN から作る。空のミラーでは出さない: ミラーのURLを正典と書くのも、
 * 本番のURLをミラーの応答に書くのも、どちらも事実と違う。
 */

export const SECURITY_CONTACT_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdrMznkVeP9cFbEuxQ8evNTGKaZtLbIbZCvc6KKcE6tUnYByw/viewform';

export const SECURITY_TXT_EXPIRES = '2027-10-01T00:00:00.000Z';

export const SECURITY_POLICY_URL = 'https://github.com/Renga154/sumihajime/blob/main/SECURITY.md';

export function buildSecurityTxt(canonicalOrigin: string | undefined): string {
  let canonical: string | null = null;
  if (canonicalOrigin) {
    try {
      canonical = new URL('/.well-known/security.txt', canonicalOrigin).toString();
    } catch {
      canonical = null;
    }
  }
  return [
    `Contact: ${SECURITY_CONTACT_URL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    'Preferred-Languages: ja, en',
    ...(canonical ? [`Canonical: ${canonical}`] : []),
    `Policy: ${SECURITY_POLICY_URL}`,
    '',
  ].join('\n');
}
