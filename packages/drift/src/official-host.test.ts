import { describe, expect, it } from 'vitest';
import { isOfficialHost, isOfficialUrl } from './official-host.js';

describe('isOfficialUrl', () => {
  it('https の公式ホストだけを許す', () => {
    expect(isOfficialUrl('https://www.city.setagaya.lg.jp/x.html')).toBe(true);
    expect(isOfficialUrl('https://www.city.shibuya.tokyo.jp/x')).toBe(true);
  });
  it('http・非公式ホスト・不正URLは拒む', () => {
    expect(isOfficialUrl('http://www.city.setagaya.lg.jp/x.html')).toBe(false);
    expect(isOfficialUrl('https://example.com/x')).toBe(false);
    expect(isOfficialUrl('not a url')).toBe(false);
  });
  it('isOfficialHost は接尾辞の偽装を拒む', () => {
    expect(isOfficialHost('evil-lg.jp.attacker.com')).toBe(false);
    expect(isOfficialHost('notlg.jp')).toBe(false);
  });
});
