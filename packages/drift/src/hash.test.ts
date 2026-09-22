import { describe, expect, it } from 'vitest';
import { sha256HexWeb } from './hash.js';

describe('sha256HexWeb', () => {
  it('既知ベクタ(空・abc)に一致し、ArrayBuffer/Uint8Array どちらも受ける', async () => {
    expect(await sha256HexWeb(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const abc = new TextEncoder().encode('abc');
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256HexWeb(abc)).toBe(expected);
    expect(await sha256HexWeb(abc.buffer.slice(0))).toBe(expected);
  });
});
