# 運用手順: 公開リポジトリ（ポートフォリオ）への書き出し

このリポジトリは非公開のまま正本として使い、公開用は履歴を洗浄した別リポジトリ
**https://github.com/Renga154/sumihajime** に書き出す（2026-09-29 持ち主の決定）。

## 公開版から除くもの

| 対象                                                                              | 理由                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `data/sources/`（公式ページの原文スナップショット）                               | 著作権は各自治体。監査の証跡として非公開側にだけ置く |
| `docs/submission/`・`scripts/submission/`・提出用の撮影スクリプト3本              | ハッカソン提出資料。製品の説明は README に集約済み   |
| 持ち主の個人の識別子・ローカルのパス・作業用の一時パス・Cloudflare のアカウントID | 個人と環境の特定を避ける（伏せ字に置換）             |

履歴のすべてのコミット・コミットメッセージから除く（最新の状態だけでなく）。
スナップショットが無い環境では、スナップショットを読むテスト（35件）だけが自動でスキップされる
（`packages/test-fixtures/src/source-snapshots.ts`）。チャットの索引構築・再監査は公開版では動かない。

## 書き出し方

書き出しスクリプトは**リポジトリの外**に置いてある（置換する識別子そのものを含むため、
どのリポジトリにもコミットしない）。

```sh
~/開発/sumihajime-public-export/export.sh        # 非公開側の main を書き出す
cd ~/開発/sumihajime-public-export/repo
git remote add origin https://github.com/Renga154/sumihajime.git
git push origin main                             # fast-forward になるはず
```

- スクリプトは毎回 main を新しく複製して `git filter-repo` で洗浄し、最後に監査する
  （識別子・原文スナップショット・提出資料・API キーの形・アカウントIDが履歴に1件でもあれば止まる）。
- **決定的**: 同じコミットからは同じハッシュになるので、main が進んでも公開側へは fast-forward で push できる。
  スクリプトの除外・置換の設定を変えると全ハッシュが変わり、force push が必要になる（避ける）。
- push の前に、公開版で `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
  が通ることを確かめる（公開側の CI も同じことをする）。
- 初回（2026-09-29）: 205 コミット、約 6.6MB。gitleaks で漏えいなし。
