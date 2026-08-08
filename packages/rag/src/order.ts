/**
 * なぜ: 生成プロンプトへ渡す抜粋(生成窓)の**並び順**を、検索スコア順から「文書順」へ戻す。
 *
 * 本番実測(2026-08-08): 自治体ページは持ち物を複数の並列ブロックで書く(場合分けの表・
 * 「本人確認書類について」の共通節など)。検索スコア順に並べると、同じページの節が原文と
 * 逆順・飛び飛びで提示され、モデルが「どのブロックが上位で共通か」を読み取れず、1ブロックだけを
 * 根拠に答える(=他ブロックの無条件必須項目が落ちる)。原文の読み順に戻すと、共通節→場合分けの
 * 関係が保たれ、統合の成功率が上がる(千代田・江戸川の書類誤答が解消、退行なし)。
 *
 * 設計: **どの文書を先に見せるかは検索の判断を尊重**し(グループの順序=初出順=スコア順)、
 * **同一文書内の節だけ**を原文順(seq昇順)へ戻す。純関数・ケース非依存。
 */

/** 並べ替え対象が満たすべき最小形状(所属文書と文書内位置)。 */
export interface DocumentPositioned {
  sourceId: string;
  /** 同一 sourceId 内でのチャンク連番(buildSourceChunks の seq)。 */
  seq: number;
}

export function orderByDocumentPosition<T extends DocumentPositioned>(chunks: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const c of chunks) {
    const g = groups.get(c.sourceId);
    if (g) g.push(c);
    else groups.set(c.sourceId, [c]);
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    out.push(...[...g].sort((a, b) => a.seq - b.seq));
  }
  return out;
}
