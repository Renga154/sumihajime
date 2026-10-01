import { describe, expect, it } from 'vitest';
import { CliArgError } from '@tmn/publish';
import { parseBuildTarget, partitionOrphanIds } from './cli.js';

/**
 * なぜ: build:index は --env / --index と、D1 から読み戻した chunk_id を wrangler の引数へ渡す。
 * 値が「-」で始まると wrangler 側でオプションとして解釈される(オプション注入)。D1 の値は
 * 自分で書いたものでも「外から来た値」として形を確かめてから渡す。
 */
describe('parseBuildTarget', () => {
  it('正常系: 既定は個人アカウントの本番索引・env なし', () => {
    expect(parseBuildTarget(['--dry-run'])).toEqual({
      indexName: 'tokyo-move-navi-rag',
      envArgs: [],
    });
  });

  it('正常系: --env / --index を検証して返す', () => {
    expect(parseBuildTarget(['--env', 'odh', '--index', 'odh-rag'])).toEqual({
      indexName: 'odh-rag',
      envArgs: ['--env', 'odh'],
    });
  });

  it.each([
    [['--env', '--remote']],
    [['--index', '--remote']],
    [['--index', 'Bad Name']],
    [['--env']],
  ])('攻撃系: %j を拒否する', (argv) => {
    expect(() => parseBuildTarget(argv)).toThrow(CliArgError);
  });
});

describe('partitionOrphanIds', () => {
  it('チャンクIDの形のものだけを削除対象にし、それ以外は渡さずに報告する', () => {
    const { deletable, rejected } = partitionOrphanIds([
      'src-13112-resident_registration-001#3',
      '--remote',
      'src-x#0',
      'src-13112-a-001#0 --force',
    ]);
    expect(deletable).toEqual(['src-13112-resident_registration-001#3']);
    expect(rejected).toHaveLength(3);
  });
});
