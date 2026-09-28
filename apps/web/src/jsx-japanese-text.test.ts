import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * なぜ: JSX は、文の途中で改行した地の文の改行を半角スペース1つにして描画する。英語なら単語の区切りに
 * なるが、日本語では「最終確認日つきで、 期限順の」のように文の途中へ余計な空白が入る。
 * 2026-09-29 の点検で、規約・プライバシーポリシーを中心に52か所で見つかった。
 * 整形(prettier)が長い行を折り返すたびに静かに再発するため、構文木を読んで機械的に止める。
 * 描画されるテキスト(JsxText)だけを見るので、コメントや文字列リテラルの改行には反応しない。
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)));
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.includes('.test.') ? [path] : [];
  });
}

/** 日本語の文字どうしが改行を挟んでいる JsxText の位置(ファイル:行)を返す。 */
function splitJapaneseText(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = node.getFullText();
      for (const m of text.matchAll(/(\S)[ \t]*\n[ \t]*(\S)/g)) {
        if (CJK.test(m[1]!) && CJK.test(m[2]!)) {
          const at = node.getFullStart() + m.index;
          const line = source.getLineAndCharacterOfPosition(at).line + 1;
          found.push(`${relative(srcDir, file)}:${line} 「…${m[1]}⏎${m[2]}…」`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('日本語の地の文', () => {
  it('文の途中で改行しない(描画すると余計な空白が入る)', () => {
    const files = tsxFiles(srcDir);
    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap(splitJapaneseText)).toEqual([]);
  });
});
