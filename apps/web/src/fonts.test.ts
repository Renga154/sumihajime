import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * なぜ(ADR-015): 日本語Webフォントは、分割サブセットにしてもトップだけで55本・約650KBあり、
 * モバイルの初回表示を約7秒まで遅らせていた。端末の日本語書体へ切り替えて 1.7秒になった。
 * Webフォントの読み込みは1行の import や @font-face で静かに戻るので、ここで機械的に止める。
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(webRoot, ...p), 'utf8');

describe('日本語フォントは端末の書体を使う', () => {
  it('Webフォントのパッケージに依存しない', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@fontsource'))).toEqual(
      [],
    );
  });

  it('エントリも index.css もフォントファイルを読み込まない', () => {
    expect(read('src', 'main.tsx')).not.toMatch(/fontsource|\.woff2?/);
    const css = read('src', 'index.css');
    // 規則そのものが無いことを見る(解説コメント中の語には反応させない)。
    expect(css).not.toMatch(/@font-face\s*\{/);
    expect(css).not.toMatch(/@import\s+['"][^'"]*(fonts\.googleapis|fontsource)/);
  });

  it('本文の書体は Android・Apple・Windows それぞれの日本語書体を指定している', () => {
    const css = read('src', 'index.css');
    const body = css.slice(css.indexOf('\nbody {'));
    const from = body.indexOf('font-family:');
    const stack = body.slice(from, body.indexOf(';', from));
    for (const family of ["'Hiragino Sans'", "'BIZ UDPGothic'", 'Meiryo', 'sans-serif']) {
      expect(stack).toContain(family);
    }
  });
});
