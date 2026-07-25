# ADR-007: 公開単位を「verified の手続き」に限定する(pending項目はstaging同梱・非公開)

- Status: **Accepted — 2026-07-25(Step3 実装。依頼元コーディネータ決裁 Option C)**
- Date: 2026-07-25
- 関連: CLAUDE.md 原則2「公開する全タスクに承認済み公式ソースと最終確認日を付ける」/ 原則9「未対応自治体・カテゴリを対応済みに見せない」、FR-022〜024(承認ゲート)、ADR-003(人手レビュー)

## Context

これまで公開パイプライン(`scripts/publish` の load→gate→seed)は、**自治体単位**で公開可否を判断していた。承認ゲートは「公開物(手続き・ルール・施設・ごみ)が参照する `source_id` が一つでも approved でなければ `PublishGateError` で全停止」する。

新規自治体を pending で追加する運用(江東 T-015 / 新宿 T-016)では、pending データは**別自治体**(13108/13104)に置かれ、既定公開対象(`DEFAULT_PUBLISH_CODES = ['13112']` 世田谷)はクリーンなまま保たれていた。よって既定シードに依存する統合テスト(`apps/api` の `createTestDb()`)・`gate.test.ts`・`d1-harness` は常に緑だった。

Step3 は**既に公開済みの自治体(世田谷13112)へ pending の手続き2件**(学校転入・保育)を追加する。これを自治体単位の従来設計のまま行うと、13112 の公開物が pending ソースを参照するため既定 `buildSeed(13112)` が `PublishGateError` で失敗し、以下が連鎖的に赤化する:

- `apps/api/src/api.integration.test.ts` / `chat.integration.test.ts`(既定シードで seed)
- `scripts/publish/src/gate.test.ts`(「既定 buildSeed は成功」不変条件)
- 取込 validate ゲート(`runValidations` が gate 違反をエラー化)

この衝突は「公開済み自治体のデータ更新のたび(改版検知でソースが pending へ降格した場合等)」に**構造的に再発**する。staging側の隔離(pendingを別ファイルに退避する運用)では毎回手作業が必要になり、恒久解にならない。

## Decision

公開の**粒度を自治体から手続きへ精緻化**する。

1. **公開単位 = `dataStatus === 'verified'` の手続きのみ**。`partial` / `stale` の手続きは seed(公開)から除外する。データファイル(`data/normalized/<code>/procedures.json`)には同梱したまま=staging とする。これは原則「人手承認済みデータだけを公開対象にする」の実装精緻化である。
2. **ルールも対にする**。対応する手続きが verified でないルールは seed から除外する(`RuleSet.rules` を公開対象 procedureId で間引いて seed に載せる)。`rules.json` ファイル自体は不変(実行時にメモリ上で間引くだけ)。
3. **承認ゲートの不変条件は強化のまま維持**する。「**公開対象(verified)の**手続き・ルールが非 approved ソースを参照したら `PublishGateError` で全停止」— ここは絶対に緩めない。変わるのは「**未公開(staging)の pending 項目がゲート検査対象外になる**」ことだけ。verified 手続きが pending ソースを参照した場合は従来どおり全停止する(回帰ガードを `gate.test.ts` に追加)。
4. **施設・ごみ等の非手続きデータは従来どおり**。ソースが approved である限り公開する(本ADRの対象外)。

実装は `scripts/publish/src/load.ts` の `loadPublishData` に集約する(load→gate→seed の gate/seed 段は不変)。除外した手続き・ルールは `PublishData.excludedProcedures` / `excludedRuleRefs` として返し、publish CLI が除外件数をログ出力する。

5. **版付けの誠実性**: staging を含む `rules.json` はファイル全体の `ruleVersion` を前進させてよい(§4「ルールにバージョンを付ける」)が、実際に公開(D1シード)される rule_set は verified 部分集合のみで**内容が不変**のため、公開版を前進させると「公開済みルールが変わった」と誤認させる。これを避けるため `ruleSetSchema` に任意フィールド `publishedRuleVersion` を追加し、publish 時はこれを公開 rule_set の版として用いる(未指定なら `ruleVersion` をそのまま公開版とする=staging を含まない通常ケース)。世田谷は `ruleVersion=2026-07-25.1`(ファイル=10ルール)/ `publishedRuleVersion=2026-07-21.1`(公開=verified 8ルール、内容不変)。承認で partial→verified に昇格した時点で `publishedRuleVersion` を外し(または `ruleVersion` と一致させ)、公開版を前進させる。

## Consequences

- 既定 `buildSeed(13112)` は verified 8手続きのみを公開し、**緑を維持**する(pending 2手続きは除外)。`apps/api` 統合テストは無変更で pass。
- publish dry-run(supported 全件)は「13112 の pending 2手続きが**除外として報告され**、ゲートは通過する」ことが新しい期待挙動。
- pending データは D1 に載らないため、承認前の世田谷ユーザーには学校転入・保育タスクは表示されない(原則9・原則2に合致)。人手レビューで `partial`→`verified` に昇格した時点で、ファイル変更なしに公開へ切り替わる。
- `coverage.csv` の `school_childcare` は承認まで `unavailable` のまま(pending をverifiedに見せない)。承認時に `verified` へ更新する運用とする。
- 将来「公開済み自治体のソース改版検知→pending降格」が起きても、当該手続きだけが自動的に非公開へ退避し、他の verified 手続きの公開は継続する(構造的再発の解消)。

## Alternatives considered

1. **(A) staging隔離**: pending を 13112 の公開ファイルに入れず別管理。毎回手作業・接続忘れリスク。棄却(恒久解でない)。
2. **(B) 赤を許容してテスト更新**: pending 期間は publish 系が赤で正しいとし、`apps/api` ハーネス・`gate.test.ts` を更新。`apps/変更禁止`・広範な赤を招くため棄却。
3. **(D) 既定シード対象の変更**: `DEFAULT_PUBLISH_CODES` を別スナップショットへ。公開既定の意味論を変え d1-harness に波及。棄却。

## Step4 追記(2026-07-25): 非手続きデータへの承認ゲート精緻化(Decision §4 の実装)

当初 §4 は「施設・ごみ等の非手続きデータはソースが approved である限り公開する(本ADRの対象外)」とだけ述べていた。Step4 で **全ソースが最初 pending の新規自治体を `supported` に含めても publish が停止しない**ことが要件になり、§4 を手続きと同じ粒度で実装した(`scripts/publish/src/load.ts` の `loadPublishData`)。

**実装した挙動**:

1. **非手続きデータもソース単位で公開/staging を判定する**。施設(`facilities`)・収集曜日データセット(`wasteDatasets` とその areas/schedules)・ごみ分別辞書(`wasteSortingItems`)は、参照する `source_id` が approved のもの**だけ**を seed(公開)・ゲート参照に載せる。未 approved のソースに属するものは公開せず staging とし、`PublishData.excludedNonProcedureSources`(`{ municipalityCode, sourceId }`)として返す。publish CLI が除外件数をログ出力する。
2. **公開ルールが 0 件の自治体は `rule_set` を seed しない**(空行を作らない。「承認まで自治体は D1 に載らない」を素直に表現)。
3. **`waste.json` 不在の許容(誠実縮退)**。収集曜日の機械判読可能データを提供しない自治体は `data/normalized/<code>/waste.json` を作らない。`loadWasteFor` はファイル不在で例外にせず `dataset=null` を返し、当該自治体は収集曜日の公開物・ゲート参照を一切生成しない。UI(`WastePage`)は空状態(「収集曜日は未対応+公式サイト導線」)へフォールバックし、曜日を推測表示しない(原則3/9)。
   - 杉並区(13115): 収集曜日が第三者 SaaS(コグモ)の JS ウィジェット依存で機械取得不可の**恒久的**誠実縮退。ごみ分別辞書(`waste_sorting`)は自治体標準オープンデータとして別途整備し公開する。
   - 千代田区(13101): 収集曜日が公式 PDF のみで機械判読可能データが無いため同様に縮退。分別辞書は公開。

**承認ゲートの不変条件は不変**: 「公開対象(seed に載る手続き・ルール・施設・ごみ)が非 approved ソースを参照したら `PublishGateError` で全停止」。Step4 の変更は「未 approved の**非手続き**データがゲート検査対象外(=非公開の staging)になる」点のみで、承認済み 3 区(世田谷/江東/新宿。全ソース approved)の公開出力は不変(後方互換)。回帰は `gate.test.ts` の合成 fixture ベース describe(実台帳の承認状態に依存しない恒久形)と、杉並/千代田の承認後 describe で担保する。
