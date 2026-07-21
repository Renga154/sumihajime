# @tmn/ingest — 取込・検証パイプライン (T-012)

公式ソースの再取得・差分検知と、CIで走るオフライン検証を提供する workspace パッケージ。
取込・公開パイプライン(`docs/IMPLEMENTATION_PLAN.md` §6 / ADR-003, REQUIREMENTS §12.4–12.5)の
「取得 → 差分 → レビュー待ち」部分を担う。公開(D1/Vectorize反映)は `@tmn/publish` の責務。

## CLI

### 再取得 + 差分検知 (`src/ingest.ts`)

```bash
pnpm --filter @tmn/ingest ingest -- --municipality 13112            # read-only(既定)
pnpm --filter @tmn/ingest ingest -- --municipality 13112 --update   # 台帳/スナップショット更新
```

- registry.csv の対象自治体の html/csv ソースを公式ドメイン(`*.lg.jp`)のみから再取得(タイムアウト+1回リトライ)。
- 文字コードを自動判定(BOMで UTF-8 / UTF-16LE/BE を判定、BOM無しは厳格UTF-8で通らなければ Shift-JIS)。
- SHA-256 を registry の `content_hash` と比較し **unchanged / changed / fetch_error** に分類。
- changed の HTML は本文テキスト(script/style/nav 除去)の行diff要約を表示。
- **既定は完全 read-only**(取得と分類レポートのみ。ファイル書き込みなし)。
- `--update` 指定時のみ: changed の新スナップショットを版付き名(`<sourceId>.<YYYYMMDD>.<ext>`)で保存
  (既存スナップショットは不変=上書きしない)し、registry.csv を書き戻す
  (`last_fetched_at` 更新、changed 行は `content_hash` 更新 + `review_status=pending` へ降格)。
  → REQUIREMENTS §12.5「差分が検出されても自動公開せず、原則レビュー待ち」の機械強制。

### オフライン検証 (`src/validate.ts`)

```bash
pnpm --filter @tmn/ingest validate
```

ネットワーク不要。CI で実行(`.github/workflows/ci.yml`)。以下いずれか違反で exit 1:

1. registry.csv 全行が `@tmn/schemas` の `sourceSchema` を満たす。
2. 公開物(`data/normalized/*/procedures.json` の sourceIds ほか rules/facilities/waste)の参照が
   **registry に実在 かつ approved**(`@tmn/publish` の publish ゲートを再利用)。
3. `last_verified_at`(最終確認日)の欠落チェック。
4. 有効期限: `effective_to` < 今日(Asia/Tokyo)を列挙して非0終了、30日以内は警告。

## スナップショット保管について(将来課題)

現状スナップショットは Git 内に保管する(`data/sources/<code>/snapshots/`)。
ADR-004 が想定する **R2 への不変スナップショット保管+`source_snapshots` 台帳化はスコープ外**であり、
将来 R2 バケット + `r2_key`/`fetched_at` 記録へ移行する(`sourceSnapshotSchema` は既に定義済み)。
