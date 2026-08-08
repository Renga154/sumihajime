import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPENDATA_GAP_CASES, OPENDATA_GAPS_SOURCE_DOC } from './opendata-gaps';
import {
  ageBandLabel,
  categoryLabel,
  channelLabel,
  coverageStatusLabel,
  dataStatusLabel,
  documentStatusLabel,
  originTypeLabel,
  priorityLabel,
  weekdayLabel,
} from '../lib/format';

/**
 * なぜ: Step2「内部用語のユーザー露出排除」の回帰固定。利用者に表示される静的コンテンツ・
 * ラベルに、開発の進捗/工程用語(タスクID・Wave・MVP・縦切り・レビュー/承認/pending)が
 * 混入していないことを担保する。サイトは開発管理の場ではない(トラッキングの正はdocs)。
 */
const INTERNAL_JARGON = /MVP|T-0\d|Wave\s*\d|縦切り|人手レビュー|pending/i;

/**
 * 正規化データ側の追加検査。静的ラベルだけを見ていたため、`data/normalized/**` に
 * 書かれた注意文の内部識別子(制約ID「C-9」「C-10」など)が素通りしていた。
 * 制約IDの正はdocs(IMPLEMENTATION_PLANの制約表)とregistry.csvのnotesであり、
 * 利用者向けの本文には出さない。
 */
const INTERNAL_ID = /\bC-\d{1,2}\b/;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const NORMALIZED_DIR = join(repoRoot, 'data/normalized');

/** 利用者の画面にそのまま出るテキストフィールド。 */
const USER_VISIBLE_KEYS = new Set([
  'caution',
  'cautions',
  'dueDescription',
  'applicabilityReason',
  'title',
  'shortDescription',
]);

/** 正規化JSONを再帰的に辿り、利用者可視キーの文字列を集める。 */
function collectFromJson(
  node: unknown,
  path: string,
  inUserVisible: boolean,
  out: { label: string; value: string }[],
): void {
  if (typeof node === 'string') {
    if (inUserVisible) out.push({ label: path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectFromJson(v, `${path}[${i}]`, inUserVisible, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      collectFromJson(v, `${path}.${k}`, inUserVisible || USER_VISIBLE_KEYS.has(k), out);
    }
  }
}

function collectNormalizedStrings(): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const code of readdirSync(NORMALIZED_DIR, { withFileTypes: true })) {
    if (!code.isDirectory()) continue;
    for (const file of readdirSync(join(NORMALIZED_DIR, code.name))) {
      if (!file.endsWith('.json')) continue;
      const full = join(NORMALIZED_DIR, code.name, file);
      collectFromJson(JSON.parse(readFileSync(full, 'utf8')), `${code.name}/${file}`, false, out);
    }
  }
  return out;
}

/** 対象文字列を1本に集める(ラベル値・出典・品質レポートの全テキストフィールド)。 */
function collectUserVisibleStrings(): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const pushRecord = (name: string, rec: Record<string, string>) => {
    for (const [k, v] of Object.entries(rec)) out.push({ label: `${name}.${k}`, value: v });
  };
  pushRecord('priorityLabel', priorityLabel);
  pushRecord('channelLabel', channelLabel);
  pushRecord('documentStatusLabel', documentStatusLabel);
  pushRecord('dataStatusLabel', dataStatusLabel);
  pushRecord('coverageStatusLabel', coverageStatusLabel);
  pushRecord('originTypeLabel', originTypeLabel);
  pushRecord('ageBandLabel', ageBandLabel);
  pushRecord('weekdayLabel', weekdayLabel);
  pushRecord('categoryLabel', categoryLabel);

  for (const c of OPENDATA_GAP_CASES) {
    for (const key of [
      'municipality',
      'headline',
      'dataset',
      'summary',
      'contribution',
      'takeaway',
    ] as const) {
      out.push({ label: `opendataGap[${c.id}].${key}`, value: c[key] });
    }
  }
  return out;
}

describe('内部用語のユーザー露出排除 (Step2)', () => {
  it('利用者可視の静的文言に開発用語(MVP/T-0x/Waven/縦切り/人手レビュー/pending)を含まない', () => {
    for (const { label, value } of collectUserVisibleStrings()) {
      expect(value, `${label} に内部用語: ${value}`).not.toMatch(INTERNAL_JARGON);
    }
  });

  it('正規化データの利用者可視フィールドに内部識別子(C-9 等)を含まない', () => {
    const strings = collectNormalizedStrings();
    // 収集自体が空振りしていないことを確認する(パス変更でテストが無言化するのを防ぐ)。
    expect(strings.length).toBeGreaterThan(100);
    for (const { label, value } of strings) {
      expect(value, `${label} に内部識別子: ${value}`).not.toMatch(INTERNAL_ID);
    }
  });

  it('正規化データの利用者可視フィールドに開発用語を含まない', () => {
    for (const { label, value } of collectNormalizedStrings()) {
      expect(value, `${label} に内部用語: ${value}`).not.toMatch(INTERNAL_JARGON);
    }
  });

  it('品質レポートの出典表記はdocsパス(開発トラッキングの正)を指す', () => {
    // なぜ: 来歴の一次記録はリポジトリのdocsが正であることを明示し続ける。
    expect(OPENDATA_GAPS_SOURCE_DOC).toBe('docs/research/opendata-gaps.md');
  });
});
