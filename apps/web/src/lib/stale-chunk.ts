/**
 * デプロイ後に古いタブで画面を移ったときの救済。
 *
 * なぜ: 画面ごとに分割したファイル(main.tsx)は、デプロイのたびにファイル名が変わり、古いものは
 * 配信されなくなる。デプロイ前に開いたタブのまま別の画面へ移ると、その画面のファイルが取れず
 * エラー画面になる。利用者に落ち度はなく、再読み込みすれば新しいファイルで開ける。
 *
 * 再読み込みは1分に1回まで。本当にファイルが壊れている場合に再読み込みを繰り返さないため。
 */

const RELOADED_AT_KEY = 'sumihajime:stale-chunk-reloaded-at';
const MIN_INTERVAL_MS = 60_000;

/** ブラウザごとの「動的 import に失敗した」例外の文面(Chrome / Safari / Firefox)。 */
const CHUNK_LOAD_FAILURE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleChunkError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_FAILURE.test(error.message);
}

/**
 * 直近1分に再読み込みしていなければ reload を呼び、true を返す。
 * 保存領域が使えない(プライベートモード等)ときは繰り返しを防げないので再読み込みしない。
 */
export function reloadOnceForStaleChunk(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number,
  reload: () => void,
): boolean {
  try {
    const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
    if (now - last < MIN_INTERVAL_MS) return false;
    storage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
