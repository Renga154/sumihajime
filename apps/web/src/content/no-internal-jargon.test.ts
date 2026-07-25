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

  it('品質レポートの出典表記はdocsパス(開発トラッキングの正)を指す', () => {
    // なぜ: 来歴の一次記録はリポジトリのdocsが正であることを明示し続ける。
    expect(OPENDATA_GAPS_SOURCE_DOC).toBe('docs/research/opendata-gaps.md');
  });
});
