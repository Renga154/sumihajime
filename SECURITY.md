# セキュリティポリシー

## このプロジェクトについて

「スミハジメ 〜東京の新生活ToDo〜」は、東京への転入者向けに手続きのチェックリストを公式情報の根拠付きで表示する、**非公式・個人運営**のWebサービスです。ログイン機能はなく、氏名・電話番号・メールアドレス・完全な生年月日・マイナンバーなどの個人情報は収集しません。

## 脆弱性の報告方法

脆弱性を見つけた場合は、サイトのフッター「お問い合わせ」から辿れる問い合わせフォームでご連絡ください。

https://docs.google.com/forms/d/e/1FAIpQLSdrMznkVeP9cFbEuxQ8evNTGKaZtLbIbZCvc6KKcE6tUnYByw/viewform

- 「使いにくい点・不具合のご報告」を選び、内容欄に「セキュリティ」と明記してください。
- 再現手順、影響、対象のURLまたはファイルを書いてください。
- 公開の Issue や SNS には、修正前の脆弱性の詳細を書かないでください。
- フォームはメールアドレスを収集しません。返信が必要な場合は、連絡先を内容欄に書いてください（任意）。

## テストについてのお願い

- 本番環境（sumihajime.com）には、通常の利用の範囲を超える操作をしないでください。
- 負荷試験（高頻度のリクエスト、DoS 試験）はしないでください。
- 自動スキャナによる大量のアクセスはしないでください。
- 他の利用者のデータへアクセスしたり、データを変更・削除したりしないでください（本サービスは利用者データを保存しません）。

## 対象範囲

対象:

- sumihajime.com
- 本リポジトリ（https://github.com/Renga154/sumihajime）のコードと設定

対象外:

- 第三者のサービス（Cloudflare、OpenAI、Google フォーム、各自治体のサイトなど）。それぞれの提供元へ報告してください。

## 対応について

個人運営のため、対応は **ベストエフォート** です。返信や修正の時期はお約束できません。報奨金（バグバウンティ）はありません。

---

# Security Policy (English)

"Sumihajime" is an **unofficial, personally operated** web service that shows a checklist of administrative procedures, with official sources, for people moving to Tokyo. It has no login and collects no personal information (no name, phone, email, full date of birth, or national ID number).

**Reporting a vulnerability:** please use the contact form linked from the site footer ("お問い合わせ"): https://docs.google.com/forms/d/e/1FAIpQLSdrMznkVeP9cFbEuxQ8evNTGKaZtLbIbZCvc6KKcE6tUnYByw/viewform . Choose the bug-report topic and write "security" in the message, with reproduction steps and impact. Do not disclose details publicly before a fix.

**Rules:** do not test production (sumihajime.com) beyond normal use. No load testing and no automated scanning. Do not access or modify other people's data.

**Scope:** sumihajime.com and this repository. Third-party services (Cloudflare, OpenAI, Google Forms, municipal websites) are out of scope; report to their operators.

**Response:** best effort only, with no guaranteed timeline. There is no bug bounty.
