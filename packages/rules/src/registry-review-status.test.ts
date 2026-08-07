import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * なぜ: docs/data-sources/registry.csv の notes 列は publish が D1 の sources テーブルへ書き込み、
 * GET /api/procedures/:id が根拠カードの一部として利用者に返す(GET /api/sources は notes を
 * 落とすため、この経路は見落としやすい)。
 *
 * 背景(2026-08-07): review_status=approved まで進んだ約145行で、notes に承認前の状態を
 * 述べる文言(「人手レビュー未了」「review_status=pending」「公開ゲート(ADR-007)により承認まで
 * 公開対象に入らない」等)が承認後も残っていた。結果、承認済みのデータが利用者に「まだ
 * レビューされていません」と自称する状態になっていた。取得日・鮮度・データの性質といった
 * 有用な情報はそのままに、状態記述だけを承認済みの旨へ書き換えて是正した(本コミット)。
 *
 * 固定する不変条件:
 *   review_status=approved の行の notes に、承認前を示す文言(未了 / pending / 承認まで公開対象に
 *   入らない)が含まれない。
 *
 * review_status=pending の行(まだ実在する場合)はこの検査の対象外とする。pending 行の notes に
 * 「未了」「pending」等が書かれているのは実態と一致しており、正すべき対象ではないため
 * (このリポジトリの2026-08-07時点では pending 行は存在しないが、将来 pending 行が追加されても
 * このテストが誤って壊れないようにする)。
 *
 * 手本: cross-ward-text.test.ts(公開経路を持つフィールドを走査して不変条件を固定するパターン)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/** 引用符つきCSVの最小パーサ(notes 列がカンマ・改行を含むため split(',') では読めない)。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

interface RegistryRow {
  readonly sourceId: string;
  readonly reviewStatus: string;
  readonly notes: string;
}

function readRegistryRows(): RegistryRow[] {
  const raw = readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8');
  const rows = parseCsv(raw);
  const header = rows[0] ?? [];
  const idIdx = header.indexOf('source_id');
  const statusIdx = header.indexOf('review_status');
  const notesIdx = header.indexOf('notes');
  expect(idIdx, 'source_id 列が見つからない').toBeGreaterThanOrEqual(0);
  expect(statusIdx, 'review_status 列が見つからない').toBeGreaterThanOrEqual(0);
  expect(notesIdx, 'notes 列が見つからない').toBeGreaterThanOrEqual(0);
  return rows
    .slice(1)
    .filter((r) => r[idIdx])
    .map((r) => ({
      sourceId: r[idIdx] ?? '',
      reviewStatus: r[statusIdx] ?? '',
      notes: r[notesIdx] ?? '',
    }));
}

/**
 * 承認前を示す文言。「未了」「pending」単体ではなく、承認状態を語っている具体的な言い回しに
 * 絞る(例: 内部の作業チケット来歴を示すだけの「candidate→pending」等の記述まで誤検知しない)。
 */
const STALE_PATTERNS: readonly RegExp[] = [
  /レビュー未了/,
  /公開対象に入らない/,
  /review_status\s*=\s*pending/,
];

function staleMatches(notes: string): RegExp[] {
  return STALE_PATTERNS.filter((p) => p.test(notes));
}

describe('registry.csv — 承認済み行の notes に承認前の文言を残さない', () => {
  it('registry.csv が読め、approved 行が存在する', () => {
    const rows = readRegistryRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.reviewStatus === 'approved')).toBe(true);
  });

  it.each(readRegistryRows().filter((r) => r.reviewStatus === 'approved'))(
    '$sourceId: review_status=approved の notes に承認前の文言が残っていない',
    (row) => {
      const matches = staleMatches(row.notes);
      expect(
        matches,
        `${row.sourceId} の notes は approved なのに承認前の文言が残っている: ` +
          `${matches.map((m) => m.source).join(', ')}\nnotes: ${row.notes}`,
      ).toEqual([]);
    },
  );

  it('approved 行全体を合わせても承認前の文言が0件', () => {
    // なぜ: it.each は行ごとに落ちるが、総数0であること自体を1本の不変条件として残す。
    const offenders = readRegistryRows()
      .filter((r) => r.reviewStatus === 'approved')
      .filter((r) => staleMatches(r.notes).length > 0);
    expect(
      offenders.map((r) => r.sourceId),
      '承認前の文言が残っている approved 行がある',
    ).toEqual([]);
  });

  it('pending 行(実在する場合)は検査対象外である(実態を書き換えない)', () => {
    // なぜ: 「pending 行の notes には pending 系の文言があってよい」ことをテスト自体の意図として
    // 明示する。将来 pending 行が追加されても、このテストが誤って壊れないようにする回帰。
    const pendingRows = readRegistryRows().filter((r) => r.reviewStatus === 'pending');
    for (const row of pendingRows) {
      // 対象外であることの確認であり、pending行に文言があることを強制はしない。
      expect(row.reviewStatus).toBe('pending');
    }
  });

  it('検出ロジックが実際に承認前の文言を捕まえる(テスト自体の有効性)', () => {
    // なぜ: 「常に空配列を返すだけのテスト」に劣化していないことを保証する。
    expect(
      staleMatches('Batch10で取得。人手レビュー未了のため review_status=pending。'),
    ).not.toEqual([]);
    expect(staleMatches('公開ゲート(ADR-007)により承認まで公開対象に入らない。')).not.toEqual([]);
    expect(staleMatches('人手レビュー未了(pending)')).not.toEqual([]);
    // 承認済みの正しい文言は誤検知しない。
    expect(staleMatches('2026-08-07に人手レビュー承認済み。')).toEqual([]);
    // 作業チケットの来歴記述(現在の承認状態についての主張ではない)は誤検知しない。
    expect(staleMatches('T-004b candidate→pending。2026-07-25に人手レビュー承認済み。')).toEqual(
      [],
    );
  });
});
