/**
 * なぜ: 原文スナップショットは不変(上書きしない)で、再取得した版は `<sourceId>.<YYYYMMDD>.<ext>`
 * として並べて保存する(scripts/ingest --update)。publish の基準値・RAG の本文・ingest の差分は
 * どれも「いまの原文」を読むべきなので、その選び方を1か所に置く。ファイル名の日付で決める
 * (mtime は git checkout で変わり、環境ごとに違う結果になる)。日付の無い `<sourceId>.<ext>` は
 * 最初の版として最も古い扱い。
 */

const DATE_SUFFIX = /^(\d{8})$/;

/**
 * ディレクトリ内のファイル名一覧から、そのソースの現行スナップショットのファイル名を返す。
 * 該当が無ければ null。
 */
export function pickCurrentSnapshot(
  fileNames: readonly string[],
  sourceId: string,
  ext: string,
): string | null {
  const plain = `${sourceId}.${ext}`;
  const prefix = `${sourceId}.`;
  const suffix = `.${ext}`;
  let best: { name: string; date: string } | null = null;
  for (const name of fileNames) {
    if (name === plain) {
      if (best === null) best = { name, date: '' };
      continue;
    }
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const middle = name.slice(prefix.length, name.length - suffix.length);
    if (!DATE_SUFFIX.test(middle)) continue;
    if (best === null || middle > best.date) best = { name, date: middle };
  }
  return best?.name ?? null;
}
