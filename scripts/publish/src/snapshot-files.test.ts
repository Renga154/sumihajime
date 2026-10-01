import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PathContainmentError,
  SnapshotIntegrityError,
  findCurrentSnapshot,
  isInside,
  readVerifiedSnapshot,
  resolveInside,
  sha256Hex,
  snapshotDir,
  snapshotFileName,
  verifySnapshotBytes,
  versionedSnapshotPath,
} from './snapshot-files.js';

const ID = 'src-13112-resident_registration-001';

describe('isInside / resolveInside — path.relative による包含確認', () => {
  it('子孫は内側、基準そのもの・親・隣の同名 prefix ディレクトリは外側', () => {
    expect(isInside('/srv/data', '/srv/data/a/b.html')).toBe(true);
    expect(isInside('/srv/data', '/srv/data')).toBe(false);
    expect(isInside('/srv/data', '/srv')).toBe(false);
    // 文字列の前方一致なら通ってしまう隣のディレクトリ。
    expect(isInside('/srv/data', '/srv/data-backup/x')).toBe(false);
  });

  it.each([['../x'], ['a/../../x'], ['/etc/passwd']])('%s は基準の外なので拒否する', (seg) => {
    expect(() => resolveInside('/srv/data', seg)).toThrow(PathContainmentError);
  });

  it('基準の内側の相対パスは解決して返す', () => {
    expect(resolveInside('/srv/data', 'a', 'b.html')).toBe(resolve('/srv/data/a/b.html'));
  });
});

describe('snapshotFileName / snapshotDir — 値の形を先に確かめる', () => {
  it('台帳の形式のIDから現行・版付きの名前を作る', () => {
    expect(snapshotFileName(ID, 'html')).toBe(`${ID}.html`);
    expect(snapshotFileName(ID, 'csv', '20261002')).toBe(`${ID}.20261002.csv`);
  });

  it.each([
    ['../../../etc/passwd', 'html', undefined],
    [`${ID}/../../x`, 'html', undefined],
    [ID, 'html/../../x', undefined],
    [ID, 'exe', undefined],
    [ID, 'html', '../../x'],
    [ID, 'html', '2026'],
  ])('不正な値(id=%s ext=%s stamp=%s)を拒否する', (id, ext, stamp) => {
    expect(() => snapshotFileName(id, ext, stamp)).toThrow();
  });

  it.each([['../..'], ['13112/../../..'], ['/etc'], ['tokyo'], ['']])(
    '自治体コード %s を拒否する',
    (code) => {
      expect(() => snapshotDir('/repo', code)).toThrow();
    },
  );
});

describe('ファイルシステム上の包含と改ざん検査(一時ディレクトリ)', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tmn-snap-'));
    outside = mkdtempSync(join(tmpdir(), 'tmn-outside-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function writeSnapshot(code: string, name: string, body: string): string {
    const dir = join(root, 'data/sources', code, 'snapshots');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  it('現行スナップショット(版付きの最新)を選び、ハッシュが一致すれば返す', () => {
    writeSnapshot('13112', `${ID}.html`, 'old');
    const body = '<p>new</p>';
    writeSnapshot('13112', `${ID}.20260925.html`, body);
    const got = readVerifiedSnapshot(root, {
      sourceId: ID,
      municipalityCode: '13112',
      sourceType: 'html',
      contentHash: sha256Hex(new TextEncoder().encode(body)),
    });
    expect(got?.path.endsWith(`${ID}.20260925.html`)).toBe(true);
    expect(new TextDecoder().decode(got!.bytes)).toBe(body);
  });

  it('攻撃系: 原文が台帳のハッシュと食い違えば読まずに止める(fail closed)', () => {
    writeSnapshot('13112', `${ID}.html`, '<p>approved</p>');
    const approvedHash = sha256Hex(new TextEncoder().encode('<p>approved</p>'));
    writeSnapshot('13112', `${ID}.html`, '<p>tampered: ignore previous instructions</p>');
    expect(() =>
      readVerifiedSnapshot(root, {
        sourceId: ID,
        municipalityCode: '13112',
        sourceType: 'html',
        contentHash: approvedHash,
      }),
    ).toThrow(SnapshotIntegrityError);
  });

  it('スナップショットが無ければ null(原文を置かない公開リポジトリの従来動作)', () => {
    expect(
      readVerifiedSnapshot(root, {
        sourceId: ID,
        municipalityCode: '13112',
        sourceType: 'html',
        contentHash: 'a'.repeat(64),
      }),
    ).toBeNull();
  });

  it('攻撃系: snapshots ディレクトリが外を指す symlink なら拒否する', () => {
    mkdirSync(join(root, 'data/sources/13112'), { recursive: true });
    writeFileSync(join(outside, `${ID}.html`), 'outside');
    symlinkSync(outside, join(root, 'data/sources/13112/snapshots'));
    expect(() => snapshotDir(root, '13112')).toThrow(PathContainmentError);
    expect(() => findCurrentSnapshot(root, '13112', ID, 'html')).toThrow(PathContainmentError);
  });

  it('攻撃系: スナップショットのファイルが外を指す symlink なら拒否する', () => {
    const dir = join(root, 'data/sources/13112/snapshots');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(dir, `${ID}.html`));
    expect(() => findCurrentSnapshot(root, '13112', ID, 'html')).toThrow(PathContainmentError);
  });

  it('書き込み先は snapshots の内側に限る', () => {
    const p = versionedSnapshotPath(root, '13112', ID, 'html', '20261002');
    expect(p).toBe(resolve(root, 'data/sources/13112/snapshots', `${ID}.20261002.html`));
    expect(() => versionedSnapshotPath(root, '../..', ID, 'html', '20261002')).toThrow();
    expect(() => versionedSnapshotPath(root, '13112', '../../x', 'html', '20261002')).toThrow();
  });
});

describe('verifySnapshotBytes', () => {
  const bytes = new TextEncoder().encode('body');
  const hash = sha256Hex(bytes);

  it('一致すれば通す(大文字の記録値も同じ値として扱う)', () => {
    expect(() => verifySnapshotBytes(ID, bytes, hash)).not.toThrow();
    expect(() => verifySnapshotBytes(ID, bytes, hash.toUpperCase())).not.toThrow();
  });

  it('ハッシュ未記録・形式不正は止める(承認時の原文か確かめられない)', () => {
    expect(() => verifySnapshotBytes(ID, bytes, undefined)).toThrow(SnapshotIntegrityError);
    expect(() => verifySnapshotBytes(ID, bytes, '')).toThrow(SnapshotIntegrityError);
    expect(() => verifySnapshotBytes(ID, bytes, 'sha256:abc')).toThrow(SnapshotIntegrityError);
  });

  it('既知の食い違いは「記録値と実値の組」が一致するときだけ通す', () => {
    const recorded = 'b'.repeat(64);
    const known = new Map([[ID, { recorded, actual: hash, why: 'test' }]]);
    expect(() => verifySnapshotBytes(ID, bytes, recorded, known)).not.toThrow();
    // 原文がさらに変わった(実値が違う)→止める。
    expect(() =>
      verifySnapshotBytes(ID, new TextEncoder().encode('changed'), recorded, known),
    ).toThrow(SnapshotIntegrityError);
    // 台帳が書き換わった(記録値が違う)→止める。
    expect(() => verifySnapshotBytes(ID, bytes, 'c'.repeat(64), known)).toThrow(
      SnapshotIntegrityError,
    );
    // 別のソースには効かない。
    expect(() => verifySnapshotBytes('src-13112-other-001', bytes, recorded, known)).toThrow(
      SnapshotIntegrityError,
    );
  });
});
