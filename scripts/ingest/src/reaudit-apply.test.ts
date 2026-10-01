import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CliArgError, PathContainmentError } from '@tmn/publish';
import { parseIdList, parseReauditArgs, planApply } from './reaudit-apply.js';
import { parseRegistryTable } from './registry.js';

const HEADER =
  'source_id,source_title,owner_organization,municipality_code,category,source_url,source_type,' +
  'license,attribution_text,fetch_method,update_frequency,last_fetched_at,last_verified_at,' +
  'source_last_modified_at,content_hash,effective_from,effective_to,review_status,reviewer,notes';
const ID = 'src-13112-resident_registration-001';
const registry = parseRegistryTable(
  `${HEADER}\n${ID},転入届,世田谷区,13112,resident_registration,https://www.city.setagaya.lg.jp/x.html,` +
    `html,規約,世田谷区,http_get,as_needed,2026-09-25,2026-09-25,,${'a'.repeat(64)},,,approved,rev,\n`,
);

describe('parseReauditArgs / parseIdList — CLI の値', () => {
  it('正常系: --flag value の組を読む', () => {
    expect(parseReauditArgs(['--ids', `${ID}`, '--out', '/tmp/x'])).toEqual({
      ids: ID,
      out: '/tmp/x',
    });
  });

  it('攻撃系: 値が無い・「-」で始まる(次のフラグを飲み込む)なら拒否する', () => {
    expect(() => parseReauditArgs(['--ids', '--out', '/tmp/x'])).toThrow(CliArgError);
    expect(() => parseReauditArgs(['--ids'])).toThrow(CliArgError);
  });

  it('攻撃系: 台帳の形でない ID(パス要素・区切り)を拒否する', () => {
    expect(parseIdList(`${ID},src-13112-dog_registration-001`)).toEqual([
      ID,
      'src-13112-dog_registration-001',
    ]);
    for (const bad of ['../../etc/passwd', `${ID}/../x`, 'src-13112-a-001\n', '--remote']) {
      expect(() => parseIdList(bad)).toThrow();
    }
    expect(() => parseIdList('')).toThrow();
  });
});

/**
 * なぜ: apply は report が書いた result.json を読み、そこに書かれたパス(newFile)のバイト列を
 * スナップショットとして保存する。result.json は人が受け渡すファイルで、書き換えられていても
 * 気づきにくい。そこに任意のパス(/etc/passwd、~/.ssh/id_rsa、外を指す symlink)や別の自治体
 * コード・種別が書かれていたら、それを公式原文として台帳へ取り込んでしまう。保存元・保存先は
 * 台帳の値から組み立て直し、result.json の値は「一致するか」の照合にだけ使う。
 */
describe('planApply — result.json の値を信用しない', () => {
  let work: string;
  let repo: string;
  let outside: string;
  const BODY = '<p>新しい原文</p>';
  const SHA = createHash('sha256').update(BODY).digest('hex');

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'tmn-reaudit-'));
    repo = mkdtempSync(join(tmpdir(), 'tmn-repo-'));
    outside = mkdtempSync(join(tmpdir(), 'tmn-outside-'));
    writeFileSync(join(work, `${ID}.html`), BODY);
  });
  afterEach(() => {
    for (const d of [work, repo, outside]) rmSync(d, { recursive: true, force: true });
  });

  function writeResult(overrides: Record<string, unknown> = {}): string {
    const p = join(work, 'result.json');
    writeFileSync(
      p,
      JSON.stringify([
        {
          sourceId: ID,
          municipalityCode: '13112',
          sourceType: 'html',
          fetched: true,
          newFile: join(work, `${ID}.html`),
          newSha256: SHA,
          newPageUpdatedOn: '2026-09-30',
          ...overrides,
        },
      ]),
    );
    return p;
  }

  const plan = (resultPath: string, ids = [ID]) =>
    planApply({ repoRoot: repo, resultPath, ids, registry, stamp: '20261002' });

  it('正常系: 台帳の自治体・種別から保存先を組み立て、レビューしたバイト列を返す', () => {
    const [item] = plan(writeResult());
    expect(item?.outPath).toBe(
      resolve(repo, 'data/sources/13112/snapshots', `${ID}.20261002.html`),
    );
    expect(new TextDecoder().decode(item!.bytes)).toBe(BODY);
    expect(item?.newSha256).toBe(SHA);
    expect(item?.newPageUpdatedOn).toBe('2026-09-30');
  });

  it.each([
    ['結果ディレクトリ外の絶対パス', () => '/etc/passwd'],
    ['親ディレクトリへの相対パス', () => '../../etc/passwd'],
  ])('攻撃系: newFile が %s なら読まずに拒否する', (_label, newFile) => {
    expect(() => plan(writeResult({ newFile: newFile() }))).toThrow(/newFile/);
  });

  it('攻撃系: 外のファイルを指す symlink を結果ディレクトリに置かれても拒否する', () => {
    writeFileSync(join(outside, 'secret'), BODY);
    rmSync(join(work, `${ID}.html`));
    symlinkSync(join(outside, 'secret'), join(work, `${ID}.html`));
    expect(() => plan(writeResult())).toThrow(PathContainmentError);
  });

  it.each([
    ['自治体コード', { municipalityCode: '../../..' }],
    ['別の自治体コード', { municipalityCode: '13108' }],
    ['種別', { sourceType: 'html/../../../x' }],
  ])('攻撃系: result.json の %s が台帳と違えば拒否する', (_label, overrides) => {
    expect(() => plan(writeResult(overrides))).toThrow(/registry/);
  });

  it('攻撃系: 保存直前のバイト列がレビュー時のハッシュと違えば拒否する', () => {
    const p = writeResult();
    writeFileSync(join(work, `${ID}.html`), '<p>差し替え</p>');
    expect(() => plan(p)).toThrow(/sha256|変わって/);
  });

  it('攻撃系: 台帳に無い ID・result.json に無い ID は書き込み前にまとめて拒否する', () => {
    expect(() => plan(writeResult(), [ID, 'src-13112-dog_registration-001'])).toThrow();
  });

  it('攻撃系: 更新日が日付の形でなければ拒否する(台帳のセルへ書くため)', () => {
    expect(() => plan(writeResult({ newPageUpdatedOn: '2026-09-30\nX' }))).toThrow(
      /newPageUpdatedOn/,
    );
  });
});
