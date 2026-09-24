# 運用手順: 外形監視（docs/ROADMAP.md A-1-4）

## 1. 仕組み（1分で読む）

- **判定はサーバー側**（`apps/api/src/health.ts` の `assessHealth`。純関数・テスト付き）。
  `GET /api/health` が `status: 'ok' | 'degraded'` と `issues` を返す。HTTP は常に 200
  （D1 が読めなくても Worker 自体の死活は答える）。

  | issue               | 意味                                          | 利用者への影響             |
  | ------------------- | --------------------------------------------- | -------------------------- |
  | `db_unreachable`    | D1 が読めない                                 | チェックリスト・詳細が全滅 |
  | `no_published_data` | 公開中の手続きが0件（publish の途中失敗など） | チェックリストが空         |
  | `patrol_never_ran`  | 定期巡回の記録が無い（Cron 未登録）           | 根拠の鮮度が黙って古くなる |
  | `patrol_stalled`    | 最後の巡回から3時間超                         | 同上                       |

  再確認中の件数（再監査の積み残し）は障害ではないので issues に入れない。
  件数は対応状況ページ「機械巡回の状況」で見る。

- **見張り役は Google Apps Script**（`ops/monitoring/health-monitor.gs`。運営者の Google
  アカウント上のプロジェクト「スミハジメ 外形監視」）。15分ごとに正典とミラーへ
  ① `/api/health` ② トップページ ③ チェックリスト作成（合成の条件）を投げ、
  **異常が2回（約30分）続いたとき**と**復旧したとき**だけ、持ち主の Gmail へ通知する。
  同じ異常で何度も通知しない（状態はスクリプトのプロパティに保持）。

## 2. 通知が来たら

1. 件名の環境（正典／ミラー）と本文の異常を見る。
2. `curl -s https://app.sumihajime.workers.dev/api/health` で現状を確かめる。
3. issue ごとの初動:
   - `db_unreachable` … Cloudflare のステータスと D1 のダッシュボードを見る。こちらで直せる
     ことは少ない。長引く場合も、利用者の端末に残る控え（ADR-012）で一覧は開ける。
   - `no_published_data` … `pnpm --filter @tmn/publish publish:local -- --remote` を再実行。
   - `patrol_never_ran` / `patrol_stalled` … `wrangler deploy` で triggers が登録されたかを
     デプロイ出力の `schedule: 0 * * * *` で確認。`docs/ops/drift-check.md` も参照。
   - HTTP 5xx・接続できない … 直前のデプロイを疑う。`wrangler rollback` で1つ前へ戻せる。
4. 復旧すると「復旧」メールが来る。

## 3. 監視スクリプトを変えるとき

`ops/monitoring/health-monitor.gs` を直したら、Apps Script エディタへ**貼り直す**
（自動では同期されない）。トリガーを作り直す必要があるときは `setup` を1回実行する
（既存の `checkNow` トリガーを消してから登録するので重複しない）。

## 4. 制約

- Apps Script（無料アカウント）のメール送信は1日100通まで。状態が変わったときだけ送るので
  通常は届かない数。
- ミラー（提供環境）は Paid 権限が2026年9月末で切れる。無料枠で動き続ける見込みだが、
  止まった場合は一度だけ「異常」が届く。ミラーを畳むときは `TARGETS` から外して貼り直す。
- 監視は15分間隔なので、それより短い障害は拾わない。
