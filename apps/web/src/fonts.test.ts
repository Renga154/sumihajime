import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * なぜ(独立点検 P1-7): 以前は日本語フォントを「1ウェイト=約1MBの集約サブセット・unicode-range
 * なし」で宣言しており、どのページでも3ウェイト計3.09MB(初回転送量の96%)を必ず取得していた。
 * 想定利用者は引越し直後の細い回線であり、この構成は致命的だった。
 *
 * 現在は @fontsource の分割サブセット(Google Fonts と同じ unicode-range 付き120分割)を使う。
 * この構成は「@font-face が全て unicode-range を持つ」ことでのみ成立する。1つでも
 * unicode-range 無しの日本語フェイスが混ざると、そのページは無条件に約1MBを取りに行き、
 * 修正前へ静かに戻る。CSSの書き換えは容易なので、その退行をここで機械的に止める。
 *
 * DADS準拠の見た目(400=本文 / 500=強調 / 700=見出し)は落とさない。ウェイトを削るのではなく
 * 分割で軽くする方針であることも、ここで固定する。
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontPackage = join(webRoot, 'node_modules', '@fontsource', 'noto-sans-jp');

/** 単一スライスの上限(バイト)。分割前の集約サブセットは約1MBあり、この閾値で必ず落ちる。 */
const MAX_SLICE_BYTES = 200_000;

/** main.tsx が実際に読み込んでいる @fontsource のCSSパスを抜き出す。 */
function importedFontCssFiles(): string[] {
  const main = readFileSync(join(webRoot, 'src', 'main.tsx'), 'utf8');
  return [...main.matchAll(/^import '@fontsource\/noto-sans-jp\/([^']+)';$/gm)].map((m) => m[1]!);
}

describe('日本語Webフォントの構成', () => {
  it('DADS準拠の3ウェイト(400/500/700)を読み込む', () => {
    expect(importedFontCssFiles().sort()).toEqual(['400.css', '500.css', '700.css']);
  });

  it('index.css は @font-face を持たない(宣言は分割サブセットCSSに一本化する)', () => {
    const css = readFileSync(join(webRoot, 'src', 'index.css'), 'utf8');
    // 規則そのものが無いことを見る(解説コメント中の語には反応させない)。
    expect(css).not.toMatch(/@font-face\s*\{/);
  });

  it.each(importedFontCssFiles())('%s の @font-face はすべて unicode-range を持つ', (file) => {
    const css = readFileSync(join(fontPackage, file), 'utf8');
    const faces = css.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(100);
    for (const face of faces) {
      const block = face.slice(0, face.indexOf('}'));
      expect(block).toContain('unicode-range:');
    }
  });

  it.each(importedFontCssFiles())('%s が参照する woff2 は1本ずつが十分小さい', (file) => {
    const css = readFileSync(join(fontPackage, file), 'utf8');
    const files = [...css.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) {
      expect(statSync(join(fontPackage, 'files', f)).size).toBeLessThan(MAX_SLICE_BYTES);
    }
  });

  it('unicode-range 無しの集約サブセット(japanese-*.woff2)は参照しない', () => {
    for (const file of importedFontCssFiles()) {
      expect(readFileSync(join(fontPackage, file), 'utf8')).not.toContain('japanese-');
    }
  });
});
