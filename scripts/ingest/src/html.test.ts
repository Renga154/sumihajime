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
