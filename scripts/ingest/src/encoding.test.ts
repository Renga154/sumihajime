import { describe, expect, it } from 'vitest';
import { decodeBuffer, detectEncoding } from './encoding.js';

// なぜ: docs/research/audit-verification.md の混在エンコーディング(UTF-8 BOM /
// UTF-16LE BOM / BOM無しShift-JIS)を自動判定できることを固定する。判定を誤ると
// 本文抽出・差分・正規化が全て文字化けするため回帰を防ぐ最重要テスト。

const U8 = (...b: number[]) => new Uint8Array(b);

describe('detectEncoding / decodeBuffer', () => {
  it('UTF-8 with BOM', () => {
    // BOM + "あ"(E3 81 82)
    const bytes = U8(0xef, 0xbb, 0xbf, 0xe3, 0x81, 0x82);
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-8', hadBom: true });
    const d = decodeBuffer(bytes);
    expect(d.text).toBe('あ');
    expect(d.hadBom).toBe(true);
  });

  it('UTF-16LE with BOM (新宿GIF施設CSVの形式)', () => {
    // BOM FF FE + "あ" LE (42 30)
    const bytes = U8(0xff, 0xfe, 0x42, 0x30);
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-16le', hadBom: true });
    expect(decodeBuffer(bytes).text).toBe('あ');
  });

  it('UTF-16BE with BOM', () => {
    // BOM FE FF + "あ" BE (30 42)
    const bytes = U8(0xfe, 0xff, 0x30, 0x42);
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-16be', hadBom: true });
    expect(decodeBuffer(bytes).text).toBe('あ');
  });

  it('Shift-JIS without BOM (世田谷ごみ収集曜日CSVの形式)', () => {
    // "東京" in Shift-JIS = 93 8C 8B 9E, no BOM
    const bytes = U8(0x93, 0x8c, 0x8b, 0x9e);
    expect(detectEncoding(bytes)).toEqual({ encoding: 'shift_jis', hadBom: false });
    expect(decodeBuffer(bytes).text).toBe('東京');
  });

  it('UTF-8 without BOM (plain ASCII CSV)', () => {
    const bytes = new TextEncoder().encode('a,b\n1,2');
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-8', hadBom: false });
    expect(decodeBuffer(bytes).text).toBe('a,b\n1,2');
  });

  it('UTF-8 without BOM (Japanese) is NOT misdetected as Shift-JIS', () => {
    const bytes = new TextEncoder().encode('東京都');
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-8', hadBom: false });
    expect(decodeBuffer(bytes).text).toBe('東京都');
  });
});
