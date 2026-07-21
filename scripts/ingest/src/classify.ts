import type { RegistryTable } from './registry.js';
import { columnIndex } from './registry.js';

/**
 * なぜ: 再取得の結果分類と、--update 時の台帳書き換えロジックを純関数に切り出し、
 * ネットワーク・ファイルIOなしで単体テストできるようにする(REQUIREMENTS §12.5
 * 「差分が検出されても自動公開せず、原則レビュー待ち」の中核なので厚くテストする)。
 */

export type Classification = 'unchanged' | 'changed' | 'fetch_error';

/**
 * 保存済みhashと再取得hashを比較して分類する。
 *   - 取得失敗            → fetch_error
 *   - 保存hashと一致       → unchanged
 *   - それ以外(不一致/初回)→ changed
 */
export function classify(
  storedHash: string | undefined,
  fetchedHash: string | undefined,
  fetchOk: boolean,
): Classification {
  if (!fetchOk || fetchedHash === undefined) return 'fetch_error';
  if (storedHash !== undefined && storedHash.length > 0 && storedHash === fetchedHash) {
    return 'unchanged';
  }
  return 'changed';
}

export interface FetchOutcome {
  sourceId: string;
  classification: Classification;
  /** changed のとき: 新しい content_hash。 */
  newHash?: string;
}

/**
 * --update 時の台帳書き換え(純関数・非破壊: 新しい RegistryTable を返す)。
 *   - fetch_error の行: 一切変更しない(取得できていないので鮮度も更新しない)。
 *   - 取得できた行: last_fetched_at を today に更新。
 *   - changed の行: さらに content_hash を新値に、review_status を 'pending' に降格。
 *
 * なぜ review_status を pending へ: §12.5「差分が検出されても自動公開せずレビュー待ち」。
 * approved のまま content_hash だけ書き換えると未レビューの変更が公開対象に残る=stale事故。
 * pending に落とすことで publish ゲート(approvedのみ)から自動的に外れる。
 */
export function applyUpdate(
  table: RegistryTable,
  outcomes: FetchOutcome[],
  today: string,
): RegistryTable {
  const idSourceId = columnIndex(table, 'source_id');
  const idLastFetched = columnIndex(table, 'last_fetched_at');
  const idContentHash = columnIndex(table, 'content_hash');
  const idReviewStatus = columnIndex(table, 'review_status');

  const byId = new Map(outcomes.map((o) => [o.sourceId, o]));
  const rows = table.rows.map((row) => {
    const outcome = byId.get(row[idSourceId] ?? '');
    if (!outcome || outcome.classification === 'fetch_error') {
      return row.slice();
    }
    const next = row.slice();
    next[idLastFetched] = today;
    if (outcome.classification === 'changed') {
      if (outcome.newHash !== undefined) next[idContentHash] = outcome.newHash;
      next[idReviewStatus] = 'pending';
    }
    return next;
  });
  return { header: table.header.slice(), rows, eol: table.eol };
}
