import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 公式ページの原文スナップショット置き場(data/sources)の絶対パス。 */
export const sourceSnapshotsDir = resolve(repoRoot, 'data/sources');

/**
 * data/sources ディレクトリ自体が存在するか。
 *
 * なぜ: 原文スナップショットは各自治体に著作権があるため、公開リポジトリには含めない
 * (非公開リポジトリでだけ監査証跡として保持する)。スナップショットを読む検査は、
 * ディレクトリごと無いときに限って skip する。個々のファイルの欠落は従来どおり失敗させ、
 * 非公開リポジトリでは検査が一件も弱まらないようにしている。
 */
export function hasSourceSnapshots(): boolean {
  return existsSync(sourceSnapshotsDir);
}
