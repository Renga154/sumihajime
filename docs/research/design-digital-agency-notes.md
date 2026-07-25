# デジタル庁デザインシステム(DADS)調査メモ — UI洗練の根拠

- 調査日: 2026-07-25(JST)
- 目的: 本サービス(スミハジメ)のUIを「政府っぽいオフィシャル + シンプルで洗練」へ寄せる。
  DADSの**考え方・トークン体系**を参照し、CSS/アセットの直接コピーはせず自前実装する。
- スコープ: 現方向性(深いブルー基調・根拠カード重視)は維持し、そこからDADSの作法で洗練化。

## 参照した一次情報(出典)

| 内容                                 | URL                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| DADS カラー(概要)                    | https://design.digital.go.jp/dads/foundations/color/                    |
| DADS カラーパレット                  | https://design.digital.go.jp/dads/foundations/color/color-palette/      |
| DADS タイポグラフィ                  | https://design.digital.go.jp/dads/foundations/typography/               |
| DADS 基本デザイン                    | https://design.digital.go.jp/dads/foundations/                          |
| **デザイントークン(公式リポジトリ)** | https://github.com/digital-go-jp/design-tokens (`figma/tokens.json`)    |
| フォーカスの外観(WCAG 2.4.13)        | https://waic.jp/translations/WCAG22/Understanding/focus-appearance.html |

補助的に読んだ二次情報(値の裏取り・傾向把握): note.com/howmanydesigns の Color/Typography 解説記事、
shikaku-sh.hatenablog.com の整理記事(Solid Gray スケールの hex 確認に使用)。**一次根拠は上表**。

## ライセンス確認(重要)

- **デザイントークン(`digital-go-jp/design-tokens`)**: **MIT License / Copyright (c) 2023 デジタル庁**。
  → カラー・タイポ・サイズ等の**トークン値は再利用・改変が許諾**されている(帰属表示を保持)。
  本実装では hex を丸ごとコピーせず、**Key(Blue)スケールの値を参照して自前の `@theme` を構築**した。
- **ロゴ・イラスト・アイコン素材**: タスク方針に従い**一切使用しない**(規約リスク回避)。参照は設計思想のみ。
  ロゴ・証票・アイコンは既存どおり全て自前のインラインSVGを維持。
- Noto Sans JP / Noto Sans Mono: **SIL Open Font License 1.1**(DADS採用フォント)。
  本実装は npm パッケージ `@fontsource/noto-sans-jp` からセルフホスト(CDN不使用)。

## 採用した作法と、本実装への落とし込み

### 1. カラー(プライマリブルー / セマンティック)

DADS は「Key カラー = Blue スケール」を主役に据える。`tokens.json` の実値(抜粋):

- Blue: 500 `#4979f5` / 600 `#3460fb` / 800 `#0031d8` / **900 `#0017c1`** / 1000 `#00118f` / 1100 `#000071`
- Semantic(参照): Success=Green-600/800、Error=Red-800(`#ec0000`)/900、Warning=Yellow-700(`#b78f00`)/Orange-600
- Neutral: Solid Gray(`#f2f2f2`→`#1a1a1a`)。3:1境界は Gray-420 `#949494`、AA本文グレーは Gray-536 `#767676`

→ 本実装: `--color-brand-*` を旧・くすんだ紺(`#1f5195`基調)から **DADSの鮮やかで濃い官公庁ブルー**へ置換。
`brand-600 = #0017c1`(主要ボタン・証票)、`brand-700 = #00118f`(本文リンク)。白背景での実効コントラストは
brand-600 で約10:1、brand-700 で約12:1(WCAG AA/AAA)。セマンティック色(至急=red / 重要=orange / 要確認=amber)は
既存の配色(text-900 系 on 100 系)を維持しAAを担保。

### 2. タイポグラフィ

- 書体: **Noto Sans JP**(可読性・視認性の高いサンセリフ、OFL)。等幅は Noto Sans Mono。
- ウェイト: DADSは N=400 / B=700 の2段。本実装は**強調用に 500 も追加**しバンドル(400/500/700)。
- サイズ/行間: 本文は 16px 以上が基準、行間は 150–175%(標準 Std は 170% 目安)。
  → 本実装は本文 `line-height: 1.75`(≒170%)を維持、見出しは 1.35 で階層を明確化。
- 和文にイタリックは使わない(DADS指針)。本実装でもイタリック不使用。

### 3. フォーカスインジケータ(高視認)

- WCAG 2.4.13「フォーカスの外観」: アウトラインは**2px以上**、背景に対し**コントラスト3:1以上**。
- DADSの実装傾向: **黄色**の高視認リングを、暗色アウトラインと重ねて明暗どちらの背景でも視認可能にする
  (外側に暗色outline + 内側に黄色)。
- → 本実装 `:focus-visible`: `outline: 3px solid #1a1a1a`(暗色=背景非依存で3:1確保)+ `outline-offset: 2px`
  - `box-shadow: 0 0 0 2px #ffd43d`(Yellow-300 相当の高視認リング)。全インタラクティブ要素へ一律適用。

### 4. 形状・密度・エレベーション

- 角丸: DADS BorderRadius トークンは 4/6/8/12/16/24/32。→ **8px基調**へ。カード/バナー/入力/ボタンを
  `rounded-lg`(8px)に統一、ヒーロー等の大面のみ `rounded-xl`(12px)で階層付け。
- エレベーション: DADS Elevation は淡い(rgba 0.1 + 0.3)。→ **官公庁的フラット**へ。カード既定の影を落とし、
  1px罫線で面を区切る。操作可能カードのみホバーで控えめな影。プライマリボタンの影も除去。
- 余白/グリッド: 8pxグリッドを踏襲(既存 Tailwind spacing と整合)。

### 5. コンポーネント作法

- **ノーティフィケーションバナー**: 免責枠(Disclaimer)・ごみ収集の注意を、左に4pxのアクセントバー付き
  DADS風バナーへ(色地 + アイコン + 見出し)。**文言は不変**。
- **根拠カード(公式根拠の証票)**: 左ブランドボーダー + 自前の公式シール(青円チェック)+ 「最終確認日」チップを維持し、
  角丸を8pxへ、余分な影を除去して罫線・タイポで格調を上げる。
- **テーブル(来歴・対応状況・ごみ収集)**: **ヘッダ帯(淡いグレー `slate-50`)+ 濃い罫線 + 行罫線**の
  DADSテーブル作法へ。列見出しは太字。
- **ボタン**: プライマリ(濃青地・白文字)/セカンダリ(白地・罫線)/テキスト(リンク調)の3階層。
  トークン置換によりプライマリは自動でDADS青に更新。フラット化(影除去)。
- **リンク**: 下線 + ブルー(`brand-700`)+ hoverで濃色化(既存 ExternalLink 準拠)。

## E2E/アクセシビリティへの影響

- E2Eが参照する role/label/見出し文言・公式文言・免責文は**一切変更しない**(className のみ変更)。
- フォーカス色・コントラスト変更後、axe-core(主要7画面)で **critical/serious 0件** を再確認済み。
