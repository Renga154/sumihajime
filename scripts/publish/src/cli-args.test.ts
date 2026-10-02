import { describe, expect, it } from 'vitest';
import {
  CliArgError,
  RAG_CHUNK_ID,
  VECTORIZE_INDEX_NAME,
  WRANGLER_ENV_NAME,
  assertCliValue,
  flagValue,
} from './cli-args.js';

/**
 * なぜ: publish / rag / reaudit は CLI の値(--env・--index・--ids・D1 から読んだ chunk_id)を
 * wrangler などの子プロセスへ引数として渡す。シェルは通さない(execFileSync)が、値が「-」で
 * 始まると子プロセス側でオプションとして解釈される(オプション注入: `--env --remote` で
 * 本番へ向くなど)。値の形を Allow List で確かめ、「-」始まりを拒否する。
 */
describe('flagValue', () => {
  it('正常系: フラグの次の値を返す。フラグが無ければ undefined', () => {
    expect(flagValue(['--env', 'odh', '--dry-run'], '--env')).toBe('odh');
    expect(flagValue(['--dry-run'], '--env')).toBeUndefined();
  });

  it('攻撃系: 値が「-」で始まる(次のフラグを値として飲み込む・オプション注入)なら拒否する', () => {
    expect(() => flagValue(['--env', '--remote'], '--env')).toThrow(CliArgError);
    expect(() => flagValue(['--env', '-x'], '--env')).toThrow(CliArgError);
  });

  it('攻撃系: 値が無い・空文字なら拒否する(既定値へ静かに縮退させない)', () => {
    expect(() => flagValue(['--env'], '--env')).toThrow(CliArgError);
    expect(() => flagValue(['--env', ''], '--env')).toThrow(CliArgError);
  });
});

describe('assertCliValue', () => {
  it.each([
    ['--env', 'odh', WRANGLER_ENV_NAME],
    ['--env', 'staging_2', WRANGLER_ENV_NAME],
    ['--index', 'tokyo-move-navi-rag', VECTORIZE_INDEX_NAME],
    ['--ids', 'src-13112-resident_registration-001#12', RAG_CHUNK_ID],
  ])('正常系: %s %s', (flag, value, pattern) => {
    expect(assertCliValue(flag, value, pattern)).toBe(value);
  });

  it.each([
    ['--env', '--remote', WRANGLER_ENV_NAME],
    ['--env', 'a b', WRANGLER_ENV_NAME],
    ['--env', 'a;rm -rf /', WRANGLER_ENV_NAME],
    ['--index', '-tokyo', VECTORIZE_INDEX_NAME],
    ['--index', 'Tokyo_RAG', VECTORIZE_INDEX_NAME],
    ['--ids', '--remote', RAG_CHUNK_ID],
    ['--ids', 'src-x#0', RAG_CHUNK_ID],
    ['--ids', 'src-13112-a-001#0\n--remote', RAG_CHUNK_ID],
  ])('攻撃系: %s %j を拒否する', (flag, value, pattern) => {
    expect(() => assertCliValue(flag, value, pattern)).toThrow(CliArgError);
  });
});
