import { describe, expect, it } from 'vitest';
import { extractTextLines, summarizeLineDiff } from './html.js';

describe('extractTextLines', () => {
  it('strips script/style/nav and returns body text lines', () => {
    const html = `
      <html><head><style>.a{color:red}</style><script>var x=1;</script></head>
      <body>
        <nav>ホーム メニュー</nav>
        <h1>転入届</h1>
        <p>届出期間は14日以内です。</p>
        <footer>Copyright</footer>
      </body></html>`;
    const lines = extractTextLines(html);
    expect(lines).toContain('転入届');
    expect(lines).toContain('届出期間は14日以内です。');
    expect(lines).not.toContain('ホーム メニュー');
    expect(lines.join(' ')).not.toContain('color:red');
    expect(lines.join(' ')).not.toContain('var x');
    expect(lines.join(' ')).not.toContain('Copyright');
  });

  it('decodes basic entities', () => {
    expect(extractTextLines('<p>A&amp;B&nbsp;C</p>')).toEqual(['A&B C']);
  });

  it('decodes valid numeric character references', () => {
    expect(extractTextLines('<p>&#65;&#x42;&#12354;&#x1F600;</p>')).toEqual(['ABあ\u{1F600}']);
  });

  /**
   * なぜ: 数値文字参照は原文(外部入力)がそのまま値を決める。`&#0;` は NUL になって後段の
   * SQL 生成で拒否され、範囲外(`&#x110000;` 等)は String.fromCodePoint が RangeError を投げて
   * 索引の構築ごと落ちる。孤立サロゲートは UTF-8 で書くと化ける。HTML の仕様どおり置換文字
   * (U+FFFD)にして、1ページの不正な参照で全体を止めない。
   */
  it.each([
    ['NUL', '&#0;'],
    ['NUL(16進)', '&#x0;'],
    ['範囲外', '&#x110000;'],
    ['極端に大きい値', '&#99999999999999999999;'],
    ['上位サロゲート', '&#xD800;'],
    ['下位サロゲート', '&#57343;'],
    ['ベル(制御文字)', '&#7;'],
    ['エスケープ(端末制御)', '&#x1b;'],
    ['DEL', '&#127;'],
  ])('攻撃系: 不正な数値参照(%s)は例外にせず U+FFFD にする', (_label, ref) => {
    expect(() => extractTextLines(`<p>a${ref}b</p>`)).not.toThrow();
    expect(extractTextLines(`<p>a${ref}b</p>`)).toEqual(['a�b']);
  });
});

describe('summarizeLineDiff', () => {
  it('reports added and removed body lines', () => {
    const oldHtml = '<p>共通行</p><p>消える行</p>';
    const newHtml = '<p>共通行</p><p>新しい行</p>';
    const diff = summarizeLineDiff(oldHtml, newHtml);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.addedSample).toContain('新しい行');
    expect(diff.removedSample).toContain('消える行');
  });

  it('reports no diff when body text is unchanged despite tag noise', () => {
    const a = '<div><p>同じ</p><script>a</script></div>';
    const b = '<section><p>同じ</p><style>x</style></section>';
    const diff = summarizeLineDiff(a, b);
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
  });
});
