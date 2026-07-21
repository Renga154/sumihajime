import { describe, expect, it } from 'vitest';
import { assertOfficialUrl, DisallowedHostError, isOfficialHost } from './http.js';

describe('isOfficialHost — official-domain allowlist', () => {
  it('allows municipal and Tokyo open-data hosts under .lg.jp', () => {
    expect(isOfficialHost('www.city.setagaya.lg.jp')).toBe(true);
    expect(isOfficialHost('www.city.shinjuku.lg.jp')).toBe(true);
    expect(isOfficialHost('opendata.metro.tokyo.lg.jp')).toBe(true);
    expect(isOfficialHost('catalog.data.metro.tokyo.lg.jp')).toBe(true);
  });

  it('rejects non-official hosts', () => {
    expect(isOfficialHost('example.com')).toBe(false);
    expect(isOfficialHost('evil-lg.jp.attacker.com')).toBe(false);
    expect(isOfficialHost('notlg.jp')).toBe(false); // suffix ".lg.jp" は "notlg.jp" に一致しない
  });
});

describe('assertOfficialUrl', () => {
  it('accepts https official urls', () => {
    expect(() => assertOfficialUrl('https://www.city.setagaya.lg.jp/x.html')).not.toThrow();
  });
  it('rejects http (non-https)', () => {
    expect(() => assertOfficialUrl('http://www.city.setagaya.lg.jp/x.html')).toThrow(
      DisallowedHostError,
    );
  });
  it('rejects non-official host', () => {
    expect(() => assertOfficialUrl('https://example.com/x')).toThrow(DisallowedHostError);
  });
});
