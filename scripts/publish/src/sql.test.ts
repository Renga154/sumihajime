import { describe, expect, it } from 'vitest';
import { SqlLiteralError, sqlJson, sqlNullableString, sqlNumber, sqlString } from './sql.js';

/**
 * なぜ: シード SQL(D1 へ `wrangler d1 execute --file` で流す)は値を文字列リテラルへ埋め込んで
 * 作る(D1 の --file はバインド変数を使えない)。安全性はこのエスケープ関数だけに懸かっているので、
 * SQLite の規則(文字列リテラル内では `'` を `''` にするだけ。`\` は特別扱いしない)どおりで
 * あることと、SQL ファイルを壊し得る値(NUL・制御文字・孤立サロゲート・NaN/Infinity)を
 * 黙って埋め込まずに拒否することを固定する。
 */
describe('sqlString', () => {
  it.each([
    ['ふつうの文字列', '転入届', "'転入届'"],
    ['シングルクォートは二重にする', "It's 'x'", "'It''s ''x'''"],
    [
      'クォートで閉じて文を足す攻撃もただの値になる',
      "'); DROP TABLE sources; --",
      "'''); DROP TABLE sources; --'",
    ],
    ['バックスラッシュはそのまま(SQLite はエスケープ文字として扱わない)', 'a\\b\\', "'a\\b\\'"],
    ['改行・タブ・CR は値の一部として残す(説明文に現れる)', 'a\nb\tc\r\n', "'a\nb\tc\r\n'"],
    ['絵文字・結合文字・全角', '👨‍👩‍👧 ｶﾞ ＡＢ', "'👨‍👩‍👧 ｶﾞ ＡＢ'"],
    ['空文字', '', "''"],
  ])('%s', (_label, input, expected) => {
    expect(sqlString(input)).toBe(expected);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['ベル', 'a\u0007b'],
    ['エスケープ(端末制御)', '\u001b[31mred'],
    ['DEL', 'a\u007fb'],
    ['孤立した上位サロゲート', 'a\ud800b'],
    ['孤立した下位サロゲート', 'a\udc00b'],
  ])('攻撃系: %s を含む値は拒否する', (_label, input) => {
    expect(() => sqlString(input)).toThrow(SqlLiteralError);
  });

  it('nullable は undefined/null を NULL にする', () => {
    expect(sqlNullableString(undefined)).toBe('NULL');
    expect(sqlNullableString(null)).toBe('NULL');
    expect(sqlNullableString("O'Reilly")).toBe("'O''Reilly'");
  });
});

describe('sqlNumber', () => {
  it.each([
    [0, '0'],
    [35.6895, '35.6895'],
    [-139.6917, '-139.6917'],
    [undefined, 'NULL'],
    [null, 'NULL'],
  ])('%s → %s', (input, expected) => {
    expect(sqlNumber(input)).toBe(expected);
  });

  it.each([[NaN], [Infinity], [-Infinity]])(
    '攻撃系: %s は SQL の数値にならないので拒否する',
    (v) => {
      expect(() => sqlNumber(v)).toThrow(SqlLiteralError);
    },
  );
});

describe('sqlJson', () => {
  it('JSON 化した文字列をクォートする(JSON.stringify は制御文字を \\uXXXX に直すので通る)', () => {
    expect(sqlJson({ a: "it's", b: 'x\u0000y' })).toBe(`'{"a":"it''s","b":"x\\u0000y"}'`);
  });
});
