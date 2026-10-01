/**
 * なぜ: publish / rag / reaudit は CLI の値(--env・--index・--ids・D1 から読み戻した chunk_id)を
 * wrangler などの子プロセスへ引数として渡す。execFileSync(シェル無し)なのでシェル注入は起きないが、
 * 値が「-」で始まると子プロセス側でオプションとして解釈される(オプション注入。例: `--env --remote`
 * で本番 D1 へ向く、`--ids --help` で削除対象が変わる)。wrangler(yargs)は `--` 以降を位置引数として
 * 扱うため、値の前に `--` を置く対策は使えない(--ids のような配列オプションが壊れる)。
 * そこで値の形を Allow List で確かめ、「-」始まり・空白・制御文字を値の段階で拒否する。
 */

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgError';
  }
}

/** wrangler の環境名(wrangler.jsonc の env キー)。 */
export const WRANGLER_ENV_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Vectorize の索引名(英小文字・数字・ハイフン)。 */
export const VECTORIZE_INDEX_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** RAG チャンクID(`<sourceId>#<seq>`。packages/rag の buildSourceChunks が作る形)。 */
export const RAG_CHUNK_ID = /^src-\d{5}-[a-z][a-z0-9_]{0,47}-\d{3}#\d{1,6}$/;

/** 値が pattern に合い、「-」で始まらないことを確かめて返す。 */
export function assertCliValue(flag: string, value: string, pattern: RegExp): string {
  if (value.startsWith('-')) {
    throw new CliArgError(`${flag}: value must not start with "-" (got ${JSON.stringify(value)})`);
  }
  if (!pattern.test(value)) {
    throw new CliArgError(`${flag}: invalid value ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * argv から `flag <value>` の値を取り出す。フラグが無ければ undefined。
 * 値が無い・空・「-」で始まる(次のフラグを値として飲み込んだ)ときは例外。
 * なぜ例外か: 以前は `--env` の直後のフラグをそのまま環境名として wrangler へ渡していた。
 */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value === '') {
    throw new CliArgError(`${flag}: missing value`);
  }
  if (value.startsWith('-')) {
    throw new CliArgError(`${flag}: value must not start with "-" (got ${JSON.stringify(value)})`);
  }
  return value;
}
