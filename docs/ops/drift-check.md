# 運用手順: 公式ソースの定期巡回と自動降格（ADR-014）

対象: `apps/api/src/drift.ts`（Cron）、`packages/drift`（純関数）、D1 `source_drift` テーブル（migration 0005）。
設計の理由は `docs/adr/ADR-014-scheduled-drift-check-and-auto-downgrade.md` を正とする。

## 1. 巡回の仕組み（1分で読む）

- Worker の Cron（`0 * * * *`、毎時）が `scheduled` を起動し、承認済み（`review_status='approved'`）
  ソースのうち **最も巡回が古い10件**（`DRIFT_BATCH_SIZE`）を直列に再取得する。332件は約1.4日で一巡。
- 判定は種別ごとに違う（`@tmn/drift classifyCheck`。純関数）:
  | 種別                   | 信号                                                                                                       | 結果                                           |
  | ---------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
  | 全ソース               | 2xx 以外／最終URLのホストが変わった／深いパスがトップへ潰された                                            | `transient`（1回目）→ `unreachable`（2回連続） |
  | HTML（更新日表記あり） | ページの「更新日」を抽出し、publish 時にスナップショットから得た `sources.snapshot_page_updated_on` と比較 | 違えば `changed`                               |
  | HTML（更新日表記なし） | 初回巡回で控えた `Last-Modified`（`baseline_last_modified`）と比較。無ければ `unverifiable`                | 違えば `changed`                               |
  | csv / xlsx             | 生バイトの SHA-256 と台帳 `content_hash`                                                                   | 違えば `changed`                               |
- `changed` / `unreachable` のソースを根拠に持つ手続きは、**読み出し時に** `dataStatus: 'stale'`（再確認中）
  として返る（チェックリスト・手続き詳細・比較ページ）。公開データ（`procedure_versions`）は書き換えない。
  根拠カードには検知日を出し、公式リンクは残す。
- 一度 `changed` / `unreachable` になった行は、一過性の失敗（`transient`）や判定不能（`unverifiable`）では
  下ろさない（利用者の表示が毎時ちらつき、検知日もリセットされるため）。下ろすのは `ok` に戻ったときだけ。
  その間も `reason` / `http_status` / `consecutive_failures` には最新の観測が入る。
- **機械は `verified` へ戻さない。** 復帰は「人が再監査 → 台帳の `last_verified_at` を進める → 再publish」のみ（§3）。
- 要約は `GET /api/health` の `drift` と `GET /api/stats` の `driftFlaggedSources` / `driftLastCheckedAt`、
  対応状況ページ「機械巡回の状況」に出る。ログは `event: drift.run`（ソースIDと件数のみ）。

## 2. `source_drift` を読む

ローカル（`--local`）でも本番（`--remote`。読み取りのみ）でも同じ SQL。`cd apps/api` で実行する。

```sh
# 直近の巡回結果（新しい順）
pnpm exec wrangler d1 execute tokyo-move-navi --local --command \
  "SELECT source_id, status, reason, http_status, current_page_updated_on, last_checked_at FROM source_drift ORDER BY last_checked_at DESC LIMIT 20"

# 効力のある検知（= いま「再確認中」に落としているソース）
pnpm exec wrangler d1 execute tokyo-move-navi --local --command \
  "SELECT d.source_id, d.status, d.reason, d.detected_at, d.verified_at_seen, s.last_verified_at FROM source_drift d JOIN sources s ON s.source_id = d.source_id WHERE d.status IN ('changed','unreachable') AND (s.last_verified_at IS NULL OR d.verified_at_seen IS NULL OR s.last_verified_at <= d.verified_at_seen) ORDER BY d.detected_at"

# 状態別の件数と最終巡回
pnpm exec wrangler d1 execute tokyo-move-navi --local --command \
  "SELECT status, COUNT(*) AS n, MAX(last_checked_at) AS latest FROM source_drift GROUP BY status"
```

本番は `--local` を `--remote` に置き換える（ミラー環境は `--env odh`）。`source_drift` は publish の
DELETE→INSERT 対象ではないので、再publish しても巡回の記憶は残る。

列の意味: `detected_at` は `changed`/`unreachable` へ遷移した時刻（`ok` に戻れば NULL）。`verified_at_seen` は
検知時点の `sources.last_verified_at`。`consecutive_failures` は連続失敗回数（2で `unreachable` 確定）。
`reason` は機械可読コード（`page_updated_on_changed` / `page_updated_on_missing_now` / `content_hash_changed` /
`last_modified_changed` / `http_404` / `host_changed` / `path_collapsed_to_root` / `network_error` /
`no_signal` / `charset_not_utf8` / `host_not_official` / `baseline_established` など）。

## 3. 検知を解除する（人手のみ）

1. `source-audit` スキルで当該ソースを再監査する（公式ページの内容を読み、手続きデータ
   `data/normalized/<code>/procedures.json` に反映が要るか判断する。要れば版を進める）。
2. `docs/data-sources/registry.csv` の当該行の `last_verified_at`（と必要なら `source_last_modified_at` /
   `content_hash`）を進める。原文スナップショットは `scripts/ingest` で取り直す（`data/sources/**` は追記のみ）。
3. 再publish する（ローカル: `pnpm --filter @tmn/publish publish:local`。本番は `-- --remote`。本番反映は
   main から一括で行う）。`sources.last_verified_at` が `verified_at_seen` より新しくなった時点で、
   マークは読み出しに効かなくなる（行を消す必要はない。次の巡回で `ok` に戻れば `detected_at` も消える）。
4. 更新日表記のあるページは、再publish で `snapshot_page_updated_on` も新しいスナップショットの値に更新される。

`source_drift` を手で UPDATE/DELETE して解除しないこと（「再確認中」の解除は人の確認日で表す、が ADR-014 の約束）。

## 4. ローカルで巡回を回す

```sh
cd apps/api
pnpm --filter @tmn/publish publish:local          # migration 0005 + 基準値(snapshot_page_updated_on)を投入
pnpm exec wrangler dev --test-scheduled            # 別ターミナルで起動
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"   # 1バッチ(10件)を実行。実際に公式サイトへ接続する
curl -s http://localhost:8787/api/health | jq .drift
```

`wrangler dev` は `--local` の D1（`.wrangler/state`）を使う。実ネットワークへ出るため、公式サイトに
過剰な負荷をかけないよう連打しない（毎時10件が設計値）。

## 5. Workers Free の制約（設計値の根拠）

- 1回の実行で CPU 10ms、外部サブリクエスト 50（リダイレクトの各ホップを含む）、同時接続 6、Cron 5本まで。
- そのため 1回 10件・直列・本文全体のテキスト抽出なし（更新日はラベル直後の200文字だけを見る）。
  `DRIFT_BATCH_SIZE` を増やすときはサブリクエスト（リダイレクト込み）が 50 を超えないこと、
  csv/xlsx のハッシュ計算（最大348KB）が CPU 枠に収まることを先に測る。
- User-Agent は `Mozilla/5.0 (compatible; SumihajimeDriftCheck/1.0; +https://sumihajime.com)`
  で固定（ADR-014 で全32公式ホストが 200 を返すことを確認済み。変えるなら再測定する）。

## 6. 既知の限界

- 更新日表記も `Last-Modified` も無いページは到達性しか見られない（`unverifiable`。`/api/health` の
  `unverifiableSources` に数が出る）。
- 「更新日が変わった」は「手続きの内容が変わった」を意味しない。保守的に倒しているため、再監査が
  滞ると再確認中が積み上がる。
- 非 UTF-8 宣言のページは本文を読まず `unverifiable`（現状の承認済みHTMLはすべて UTF-8）。
