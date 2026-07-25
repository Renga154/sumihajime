import { z } from 'zod';

/**
 * なぜ: 来歴ダッシュボード(Wave3)の「オープンデータ品質レポート」で表示する事例データ。
 * 出典は docs/research/opendata-gaps.md(人手で記録した一次調査)であり、本ファイルはその
 * 内容を UI 表示向けに構造化した「改変しない要約」である。原則3(推測しない)に従い、
 * md に記載のある事実のみを保持する。トーンは自治体批判ではなく、公開オープンデータの
 * 品質改善に建設的に貢献する立場(公式ページとの突き合わせ・件数検証の一般化)で記述する。
 *
 * スキーマ検証(opendataGapCaseSchema)により、必須フィールドの欠落や表記ゆれをテストで検出する。
 */

/** 出典(唯一の一次記録)。UIに常時明記し、原文を辿れるようにする。 */
export const OPENDATA_GAPS_SOURCE_DOC = 'docs/research/opendata-gaps.md';

export const opendataGapCaseSchema = z.strictObject({
  /** 安定した識別子(UIのkey・アンカー用)。 */
  id: z.string().min(1),
  municipality: z.string().min(1),
  municipalityCode: z.string().regex(/^\d{5}$/),
  /** 事例の見出し(何が起きたか)。 */
  headline: z.string().min(1),
  /** 対象データセット名。 */
  dataset: z.string().min(1),
  /** 事実の要約(md記載の範囲。改変しない)。 */
  summary: z.string().min(1),
  /** 本サービスが取った建設的な対処(捏造せず・原文改変せず、公式突き合わせで補完/補正)。 */
  contribution: z.string().min(1),
  /** 同種の欠落を他区でも防ぐための一般化された観点。 */
  takeaway: z.string().min(1),
  /** md に記録された確認日(YYYY-MM-DD)。 */
  confirmedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type OpendataGapCase = z.infer<typeof opendataGapCaseSchema>;

export const opendataGapCasesSchema = z.array(opendataGapCaseSchema);

export const OPENDATA_GAP_CASES: OpendataGapCase[] = [
  {
    id: 'shinjuku-facility-missing',
    municipality: '新宿区',
    municipalityCode: '13104',
    headline: '公共施設一覧CSVに特別出張所が1か所欠落していた',
    dataset: '新宿区 GIF施設一覧CSV(624データ行)',
    summary:
      '新宿区の特別出張所は公式に10か所ですが、公開CSVには「若松町特別出張所」に該当する行がなく、抽出できたのは9か所でした。624行を名称で全件走査し、CSV側の欠落であること(抽出ロジックの不備ではないこと)を確認しています。',
    contribution:
      '不足分は新宿区公式サイトの特別出張所一覧ページと詳細ページから名称・住所を取得して補完し、原文のスナップショットを保存し、出典として記録したうえで掲載しています。緯度経度は公式ページに記載が無いため設定していません(座標は捏造しない)。地図では座標データが無い施設として、その旨を注記のうえ一覧に掲載を続けます。',
    takeaway:
      '施設・窓口系のオープンデータを取り込む際は、公式ページの一覧と件数を突き合わせるだけで欠落を早期に検出できます。件数照合は安価で再現性の高いチェック観点です。',
    confirmedOn: '2026-07-22',
  },
  {
    id: 'setagaya-waste-columns',
    municipality: '世田谷区',
    municipalityCode: '13112',
    headline: 'ごみ分別CSVで列見出しと中身が入れ替わっていた',
    dataset: '世田谷区 ごみ分別一覧CSV(787データ行・自治体標準オープンデータセット準拠)',
    summary:
      '見出しの「品目」列に分別区分(不燃ごみ等17種)が、「分別区分」列に品目名(787種)が入っており、見出しと中身が入れ替わっていました。江東区・新宿区の同種CSVとの対比、およびユニーク値数の機械検証で確認しています。',
    contribution:
      '取込パーサに明示的な列スワップ補正を実装し、世田谷区にのみ適用しました。データの中身は改変しておらず、列の対応付けのみを正しく修正しています(理由は取込スクリプトに文書化)。',
    takeaway:
      '標準データセット「準拠」でも、列の中身の検証は必要です。列ごとのユニーク値数の比較は、列スワップを検出する安価な機械チェックとして有効です。',
    confirmedOn: '2026-07-23',
  },
];
