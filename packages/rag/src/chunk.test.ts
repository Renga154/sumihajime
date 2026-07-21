import { describe, it, expect } from 'vitest';
import { chunkLines, buildSourceChunks } from './chunk.js';
import type { RagChunkMetadata } from './types.js';

/** 指定長の疑似行を作る(文字数境界の検証用)。 */
function line(n: number, ch = 'あ'): string {
  return ch.repeat(n);
}

describe('chunkLines', () => {
  it('短い入力は1チャンクにまとまる', () => {
    const chunks = chunkLines(['転入届は14日以内に提出してください。', '窓口は本庁舎です。']);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('転入届');
    expect(chunks[0]).toContain('本庁舎');
  });

  it('空行・空白のみの行は除外される', () => {
    const chunks = chunkLines(['本文A', '   ', '', '本文B']);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('本文A\n本文B');
  });

  it('max を超えると複数チャンクに分割し、各チャンクは max+overlap 以内', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `${i}:${line(90)}`);
    const opts = { minChars: 200, maxChars: 300, overlapChars: 80 };
    const chunks = chunkLines(lines, opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(opts.maxChars + opts.overlapChars);
    }
  });

  it('隣接チャンクにオーバーラップ(共有行)がある', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `L${i}:${line(90)}`);
    const opts = { minChars: 200, maxChars: 300, overlapChars: 120 };
    const chunks = chunkLines(lines, opts);
    // 直前チャンクの末尾行が次チャンクの先頭付近に現れる。
    const firstTailLine = chunks[0]!.split('\n').at(-1)!;
    expect(chunks[1]!.startsWith(firstTailLine)).toBe(true);
  });

  it('1行が max を超える場合は文字数で機械分割される', () => {
    const chunks = chunkLines([line(2000)], { minChars: 500, maxChars: 800, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });
});

describe('buildSourceChunks', () => {
  const meta: RagChunkMetadata = {
    municipalityCode: '13112',
    category: 'resident_registration',
    sourceId: 'src-13112-resident_registration-001',
    procedureId: 'procedure_resident_registration',
    title: '転入届',
    url: 'https://example.lg.jp/88.html',
    lastVerifiedAt: '2026-07-21T00:00:00Z',
  };

  it('id は "<sourceId>#<連番>" で連番・冪等', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `段落${i}:${line(120)}`);
    const chunks = buildSourceChunks(lines, meta, {
      minChars: 200,
      maxChars: 300,
      overlapChars: 60,
    });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.id).toBe(`${meta.sourceId}#${i}`);
      expect(c.seq).toBe(i);
      expect(c.metadata).toEqual(meta);
    });
    // 再実行しても同じidになる(冪等)。
    const again = buildSourceChunks(lines, meta, {
      minChars: 200,
      maxChars: 300,
      overlapChars: 60,
    });
    expect(again.map((c) => c.id)).toEqual(chunks.map((c) => c.id));
  });
});
