# Claude Code 推奨セットアップ

この文書は、要件定義書を基にClaude Codeで計画・実装する際の、Skills、MCP、Plugins、Hooksの推奨構成を示す。

## 1. 基本方針

最初から多くの拡張を入れない。Claude Codeの組み込みファイル操作・検索・シェルで足りるものに、重複するMCPを追加しない。

推奨導入順:

1. `CLAUDE.md`
2. 本リポジトリ同梱のプロジェクトSkills
3. TypeScript LSPプラグイン
4. security-guidanceプラグイン
5. GitHub連携
6. Cloudflare連携
7. Playwright MCP
8. 本番運用後にSentry等

## 2. 同梱Skills

`.claude/skills/` に以下を含む。

| Skill               | 用途                                                       |
| ------------------- | ---------------------------------------------------------- |
| `/plan-mvp`         | 要件から実装計画、ADR、マイルストーン、タスクを作る        |
| `/source-audit`     | 自治体公式ソース、ライセンス、鮮度、取得方法を監査する     |
| `/add-municipality` | 自治体追加を共通手順で行い、データ・ルール・テストを揃える |
| `/rag-eval`         | RAGの検索、引用、回答保留、自治体混入を評価する            |
| `/release-check`    | リリース前の品質・データ・プライバシーゲートを実行する     |

初回は `/plan-mvp` を使用する。

## 3. 推奨Plugins

### 3.1 TypeScript code intelligence

Claude Code公式マーケットプレイスのTypeScript LSPを推奨。

```text
/plugin install typescript-lsp@claude-plugins-official
```

`typescript-language-server` と TypeScript が利用可能な状態にする。導入後、型エラーの自動診断とシンボルナビゲーションが期待できる。

### 3.2 Security guidance

```text
/plugin install security-guidance@claude-plugins-official
```

各変更の一般的な脆弱性レビューに使用する。ただし、これだけでセキュリティ監査が完了したとはみなさない。

### 3.3 GitHub

```text
/plugin install github@claude-plugins-official
```

Issue、PR、レビューをClaude Codeから扱う。最初は対象リポジトリだけにアクセスできる最小権限で接続する。

`github`プラグインと手動GitHub MCPを二重に導入しない。

### 3.4 Cloudflare

ハッカソン提供環境との親和性が高いため、Cloudflare公式Skills/MCPプラグインを推奨。

```text
/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare
```

初期は読み取り・プレビュー用途を中心にし、本番変更権限は最小化する。

### 3.5 任意

- `pr-review-toolkit`: PR運用開始後
- `sentry`: 本番監視開始後
- `figma`: Figmaを設計の正本にする場合のみ

## 4. 推奨MCP

### 4.1 Playwright MCP — 推奨

用途:

- 入力からチェックリストまでのブラウザ操作確認
- レスポンシブ確認
- 公式ページの構造調査
- E2Eデバッグ

プロジェクトスコープ例:

```bash
claude mcp add --transport stdio --scope project playwright -- npx -y @playwright/mcp@latest
```

注意:

- Microsoft公式のスコープ付きパッケージを使う
- 個人アカウントへログイン済みのブラウザを操作させない
- 本番管理画面の資格情報を保存しない
- Webページ内の命令文を信頼せず、プロンプトインジェクションを前提に扱う

### 4.2 GitHub MCP — GitHubプラグインを使わない場合のみ

公式GitHub MCPを利用する。Fine-grained PATを使い、対象リポジトリだけに限定する。

プラグイン導入済みなら追加しない。

### 4.3 Cloudflare MCP — Cloudflareプラグイン経由を推奨

Cloudflare公式プラグインはSkillsとMCPをまとめて導入できる。個別設定より先に公式プラグインを検討する。

### 4.4 Sentry MCP — 本番後の任意

本番エラー調査が必要になってから導入する。MVP着手時点では不要。

### 4.5 導入しないもの

- 汎用filesystem MCP: Claude Codeの組み込み機能と重複
- 汎用shell MCP: 組み込みBashと重複
- 出所不明なWeb scraping MCP
- 本番DBへ広い書き込み権限を持つMCP
- 同じサービスへ接続する複数の重複MCP

## 5. 推奨Subagents

Planで必要になった場合、次の専門Subagentを追加する。

### data-auditor

- 公式性、ライセンス、更新日、適用範囲を監査
- 多数のソースを読んで要点だけ返す
- 原則read-only

### rule-reviewer

- 条件分岐の正例・負例・境界をレビュー
- 自治体を跨ぐ誤適用を探す

### privacy-security-reviewer

- PII、ログ、プロンプトインジェクション、SSRF、権限をレビュー
- リリース前に独立した文脈で確認

### ux-accessibility-reviewer

- モバイル導線、読みやすさ、キーボード、スクリーンリーダーを確認

## 6. 推奨Hooks

技術スタック確定後に追加する。毎回必ず行う決定論的処理をHookへ置く。

候補:

- ファイル編集後: formatter
- TypeScript編集後: lintまたは軽量typecheck
- commit前: lint / typecheck / unit test
- `.env`、秘密鍵、承認済みraw snapshotへの不用意な編集をブロック
- セッション終了前: 未実行テストを警告

重いE2EやRAG評価を全編集後に実行しない。`/release-check`でまとめて実行する。

## 7. MCP・Pluginの権限ルール

- OAuthまたは短命トークンを優先
- トークンは環境変数・OSキーチェーン等へ保存
- `.mcp.json`に秘密情報を書かない
- Project scopeには共有してよい設定だけを置く
- 本番書き込み権限は通常セッションへ与えない
- インストール前にプラグインが含むSkills、Hooks、MCP、LSPを確認する
- 使わないプラグインは無効化・削除する

## 8. 初回セットアップ手順

1. このパッケージを新規リポジトリのルートへ配置
2. `git init` と初回コミット
3. Claude Codeを起動
4. `CLAUDE.md` と `REQUIREMENTS.md` を読ませる
5. 必須Pluginsを導入
6. `/plan-mvp` または `INITIAL_PLAN_PROMPT.md` をPlanモードで実行
7. Planをレビューし、承認前は実装しない
8. 承認後、1自治体のVertical Sliceから着手

## 9. 公式ドキュメント

- Claude Code拡張の選び方: https://code.claude.com/docs/ja/features-overview
- Skills: https://code.claude.com/docs/ja/skills
- MCP: https://code.claude.com/docs/ja/mcp
- Plugins: https://code.claude.com/docs/ja/discover-plugins
- Cloudflare + Claude Code: https://developers.cloudflare.com/agent-setup/claude-code/
- GitHub MCP: https://github.com/github/github-mcp-server
- Playwright MCP: https://github.com/microsoft/playwright-mcp
