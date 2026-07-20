# Claude Code Plan用 初回プロンプト

以下をClaude CodeのPlanモードで実行してください。

---

あなたは本プロジェクトのテックリード兼プロダクトエンジニアです。まず実装は行わず、実行可能な初期計画を作ってください。

必ず先に読むファイル:

1. `REQUIREMENTS.md`
2. `CLAUDE.md`
3. `CLAUDE_CODE_SETUP.md`
4. `.claude/skills/plan-mvp/SKILL.md`

## 目的

2026-08-23の作品提出までに、東京転入者が最低限の入力から、公式根拠付きの個別ToDoを得られるMVPを完成させる。広く薄い実装ではなく、3自治体程度の深く信頼できるデモを目指す。

## このPlanで行うこと

1. 現在のリポジトリ状態を確認する
2. 要件をP0/P1/P2に再整理し、矛盾・曖昧さを列挙する
3. MVP候補自治体を少なくとも5件挙げ、データ監査の評価軸と調査手順を決める
4. Cloudflareネイティブ構成を第一候補として、少なくとも1つの代替案と比較する
5. 最終推奨アーキテクチャと理由をADR案として示す
6. 1自治体・1ペルソナのVertical Sliceを定義する
7. 推奨リポジトリ構成、主要モジュール、API、データモデルを具体化する
8. ルールエンジン、データ来歴、RAG、更新差分の実装方針を定義する
9. テスト戦略と品質ゲートを定義する
10. プライバシー、セキュリティ、MCP権限の対策を定義する
11. 2026-08-23から逆算した週次・日次マイルストーンを作る
12. 最初の10〜20タスクを依存関係・完了条件付きで並べる
13. 2分プレゼンと1分操作動画で見せる固定デモシナリオを定義する
14. リスク、フォールバック、削る順番を定義する

## 必須の出力構成

- Executive summary
- Assumptions
- Open decisions
- Scope table
- Candidate municipality data-audit plan
- Architecture decision and Mermaid diagram
- Repository tree
- Data model and API outline
- Vertical Slice 1 acceptance criteria
- Epics and dependency graph
- Detailed task list
- Test and evaluation strategy
- Security/privacy plan
- MCP/Plugins/Skills plan
- Schedule to 2026-08-23
- Risk register and fallback plan
- Definition of Ready for implementation

## 制約

- この段階でプロダクトコードを書かない
- 不明点は合理的な仮定を置き、その検証タスクを計画へ含める
- LLMをチェックリスト適用判定に使わない
- 全タスクとRAG回答の公式根拠を必須にする
- 完全住所・氏名・生年月日等を永続化しない
- 1自治体縦切りの完成を最優先する
- RAGはチェックリスト完成後に統合可能な構造とする
- 8月23日までに間に合わない場合のスコープ削減順を明記する

## 保存先

計画を `docs/IMPLEMENTATION_PLAN.md` に保存し、先頭に以下を入れてください。

```text
Status: DRAFT — HUMAN APPROVAL REQUIRED
```

計画作成後は実装を開始せず、人間の承認を待ってください。
