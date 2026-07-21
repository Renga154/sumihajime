# @tmn/schemas

Zod（v4系）による境界層スキーマと推論型の単一の真実（single source of truth）。
`packages/rules`・`apps/api`・`apps/web`・`packages/rag` は、外部入力（HTTPリクエスト/
レスポンス、ルールJSON、ソース台帳、正規化データ）の検証にここで定義した型のみを使う。

- 未知の入力は `strictObject` で安全に拒否する（余剰プロパティ拒否）。
- 日付・日時は ISO 文字列のまま保持する（`Date` オブジェクト化しない）。
- 境界層以外での `any` は使用しない。
- ルール評価器そのもの（`packages/rules`, T-003）はここに含まれない。スキーマと型のみ。

## ファイル構成

| ファイル              | 内容                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `src/municipality.ts` | Municipality / Coverage / municipalityCode                       |
| `src/profile.ts`      | Profile / Destination / Household / Flags / AgeBand / OriginType |
| `src/rule.ts`         | RuleCondition(DSL) / Rule / RuleSet / RuleOutcome / DueRule      |
| `src/procedure.ts`    | ProcedureVersion / RequiredDocument / Channel / DataStatus       |
| `src/source.ts`       | Source / SourceSnapshot / SourceType / ReviewStatus              |
| `src/facility.ts`     | Facility / WasteArea / WasteSchedule / Weekday                   |
| `src/task.ts`         | GeneratedTask / TaskSourceRef                                    |
| `src/api.ts`          | ChecklistRequest/Response / ChatRequest/Response / ErrorResponse |
| `src/index.ts`        | 上記すべての再export                                             |

## スキーマ ↔ REQUIREMENTS.md / IMPLEMENTATION_PLAN.md 対応表

| スキーマ                                                          | 対応要件                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `municipalitySchema`                                              | REQUIREMENTS §13.1 Municipality、計画§8.1 municipalities（`officialUrl` は FR-021 公式導線用の追加的optional, T-006）              |
| `municipalityWithCoverageSchema` / `municipalitiesResponseSchema` | 計画§8.2 GET /api/municipalities → {code,name,supported,officialUrl,coverage[]}（FR-001/021, T-006）                               |
| `procedureDetailResponseSchema`                                   | 計画§8.2 GET /api/procedures/:id → ProcedureVersion+sources（根拠カード, T-006）                                                   |
| `facilitiesResponseSchema`                                        | 計画§8.2 GET /api/facilities → Facility[]（T-006）                                                                                 |
| `wasteSchedulesResponseSchema`                                    | 計画§8.2 GET /api/waste-schedules → areas[]/schedules[]+caution（C-9, T-006）                                                      |
| `coverageSchema` / `coverageStatusSchema`                         | REQUIREMENTS §13.1 MunicipalityCoverage、FR-024、計画§8.1 coverage                                                                 |
| `profileSchema`                                                   | REQUIREMENTS §14.1 チェックリスト生成入力例、§9.2 ルール入力                                                                       |
| `destinationSchema`                                               | REQUIREMENTS §7.3 Step1（転入先自治体・町丁目/郵便番号）                                                                           |
| `originTypeSchema`                                                | REQUIREMENTS §7.3 Step1（転入元区分）                                                                                              |
| `ageBandSchema`                                                   | REQUIREMENTS §7.3 Step2（世帯員の年齢帯の6区分）                                                                                   |
| `householdSchema`                                                 | REQUIREMENTS §7.3 Step2（単身/複数人、年齢帯配列）                                                                                 |
| `flagsSchema`                                                     | REQUIREMENTS §7.3 Step3（条件チェック項目）＋計画C-10（dogHasMicrochip）                                                           |
| `ruleConditionSchema` / `rulePredicateSchema`                     | 計画ADR-002（宣言的DSL: all/any/not + 述語4種）                                                                                    |
| `dueRuleSchema`                                                   | 計画ADR-002（期限の宣言表現: offsetDays / unknown）                                                                                |
| `ruleOutcomeSchema`                                               | REQUIREMENTS §9.3 ルール出力                                                                                                       |
| `ruleSchema` / `ruleSetSchema`                                    | 計画§8.1 rule_sets、ADR-002（ruleVersion管理）                                                                                     |
| `procedureVersionSchema`                                          | REQUIREMENTS §10 タスク詳細要件の表、計画§8.1 procedure_versions                                                                   |
| `requiredDocumentSchema` / `documentStatusSchema`                 | REQUIREMENTS §10 requiredDocuments                                                                                                 |
| `channelSchema`                                                   | REQUIREMENTS §10 channels                                                                                                          |
| `dataStatusSchema`                                                | REQUIREMENTS §10 dataStatus                                                                                                        |
| `sourceSchema` / `sourceTypeSchema`                               | REQUIREMENTS §12.3 データソース台帳                                                                                                |
| `reviewStatusSchema`                                              | REQUIREMENTS §12.4 取得・公開フロー、計画ADR-003                                                                                   |
| `sourceSnapshotSchema`                                            | REQUIREMENTS §12.4「原文を取得しR2等へ不変スナップショット保存」、計画§8.1 source_snapshots                                        |
| `facilitySchema`                                                  | REQUIREMENTS §13.1 Facility、計画§8.1 facilities、ADR-005（地図P1・距離計算なし）                                                  |
| `wasteAreaSchema` / `wasteScheduleSchema`                         | REQUIREMENTS §13.1 WasteArea/WasteSchedule、計画§8.1 waste_areas/waste_schedules、C-9（例外日展開なし）                            |
| `generatedTaskSchema` / `taskSourceRefSchema`                     | REQUIREMENTS §14.2 タスク出力例、§13.1 GeneratedTask                                                                               |
| `checklistRequestSchema`                                          | 計画§8.2 POST /api/checklists 入力（= Profile）                                                                                    |
| `checklistResponseSchema`                                         | 計画§8.2 POST /api/checklists 出力、§13.2（生成時のRuleVersion保持）                                                               |
| `chatRequestSchema`                                               | REQUIREMENTS §11.3 検索スコープ（クライアント指定可能な最小項目）                                                                  |
| `chatResponseSchema` / `chatCitationSchema`                       | REQUIREMENTS §11.4 回答フォーマット、§11.5 失敗時の挙動                                                                            |
| `errorResponseSchema`                                             | 全API共通の失敗時契約（CLAUDE.md §7: 次の行動が分かるエラー文面。`error.officialUrl` は FR-021 の公式導線用追加的optional, T-006） |

## 設計上の判断・既知の逸脱

- **§14.1のageBands値 `"preschool"`**: §7.3 Step2で定義された6区分の語彙
  （`age0_2`/`age3_5`/`elementary`/`junior_senior`/`adult`/`senior65plus`）には
  含まれない。テストfixtureでは3〜5歳の未就学児を指すと解釈し `"age3_5"` に
  置き換えている。ルール記述時に「未就学児」を指す語として `preschool` を
  別途エイリアスとして許容するかは、rules実装（T-003）着手時に確認する。
- **§14.1のflags項目不足**: `dogHasMicrochip`（計画C-10）、`needsVehicleGuidance`、
  `isPregnantMember`（§7.3 Step3/Step2で要求されるが§14.1の例には含まれない）は、
  Zodの `.default()` で安全側デフォルト（`false` / `"unknown"` = 該当なし・未確認）
  を補完し、§14.1の例をそのままparseできるようにしている。
- **RuleOutcomeとGeneratedTaskの重複**: §9.3（ルール評価器の内部出力）と
  §14.2（API利用者向け出力）は目的が異なるため別スキーマとした。
  `sources`（GeneratedTask）は表示用に軽量化した参照形状（`taskSourceRefSchema`）。
- **GeneratedTaskの `applicable` / `warnings`（T-006で追加）**: §14.2の例には無いが、
  API（POST /api/checklists）は applicable と needs_confirmation の両方のタスクを返すため、
  UIが「要確認」を表示できるよう `applicable`（§9.3のApplicability）と `warnings` を
  追加的optionalとして持たせた。§14.2の例はこれらを省いてもそのままparseできる（後方互換）。
- **`officialUrl`（municipality / errorResponse, T-006で追加）**: FR-021の公式導線用。
  いずれも追加的optionalで既存の入出力を壊さない。

## 検証コマンド

```sh
pnpm --filter @tmn/schemas typecheck
pnpm --filter @tmn/schemas test
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test   # ルートから全ゲート
```
