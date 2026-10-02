import {
  RAG_CHUNK_ID,
  VECTORIZE_INDEX_NAME,
  WRANGLER_ENV_NAME,
  assertCliValue,
  flagValue,
} from '@tmn/publish';

/**
 * なぜ: build:index(build.ts)が wrangler へ渡す値の検証を、CLI 本体(実行すると wrangler を
 * 呼ぶ)から切り離してテストできるようにする。値が「-」で始まると wrangler(yargs)がオプションと
 * して解釈する(オプション注入。`--env --remote` など)。wrangler は `--` 以降を位置引数として
 * 扱うので `--` は使えず、値の形を Allow List で確かめる(scripts/publish/src/cli-args.ts)。
 */

export const DEFAULT_INDEX_NAME = 'tokyo-move-navi-rag';

export interface BuildTarget {
  indexName: string;
  envArgs: string[];
}

/** --env / --index を検証して読む。値の欠落・「-」始まり・形の違いは例外。 */
export function parseBuildTarget(argv: readonly string[]): BuildTarget {
  const env = flagValue(argv, '--env');
  const index = flagValue(argv, '--index');
  return {
    indexName:
      index !== undefined
        ? assertCliValue('--index', index, VECTORIZE_INDEX_NAME)
        : DEFAULT_INDEX_NAME,
    envArgs: env !== undefined ? ['--env', assertCliValue('--env', env, WRANGLER_ENV_NAME)] : [],
  };
}

/**
 * D1 から読み戻した chunk_id のうち、チャンクIDの形のものだけを削除対象にする。
 * 形の違う値は wrangler へ渡さず、呼び出し側が件数を報告する(D1 が想定外の値を持つこと自体が
 * 調べるべき異常で、黙って消すものではない)。
 */
export function partitionOrphanIds(ids: readonly string[]): {
  deletable: string[];
  rejected: string[];
} {
  const deletable: string[] = [];
  const rejected: string[] = [];
  for (const id of ids) {
    if (!id.startsWith('-') && RAG_CHUNK_ID.test(id)) deletable.push(id);
    else rejected.push(id);
  }
  return { deletable, rejected };
}
