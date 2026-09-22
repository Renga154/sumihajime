import { describe, expect, it } from 'vitest';
import { pickCurrentSnapshot } from './snapshot.js';

describe('pickCurrentSnapshot', () => {
  const id = 'src-13000-driver_license-001';

  it('版付きが無ければ日付無しの原本を返す', () => {
    expect(pickCurrentSnapshot([`${id}.html`, 'other.html'], id, 'html')).toBe(`${id}.html`);
  });

  it('版付きがあれば最も新しい日付を返し、原本より優先する(並び順に依存しない)', () => {
    const files = [`${id}.20260922.html`, `${id}.html`, `${id}.20260801.html`];
    expect(pickCurrentSnapshot(files, id, 'html')).toBe(`${id}.20260922.html`);
    expect(pickCurrentSnapshot([...files].reverse(), id, 'html')).toBe(`${id}.20260922.html`);
  });

  it('拡張子・接頭辞が一致しないものと、日付でない中間部は無視する', () => {
    const files = [
      `${id}.20260922.csv`, // 拡張子違い
      `${id}-002.20260922.html`, // 別ソース(接頭辞が一致しない)
      `${id}.draft.html`, // 日付でない
      `${id}.html`,
    ];
    expect(pickCurrentSnapshot(files, id, 'html')).toBe(`${id}.html`);
  });

  it('該当が無ければ null', () => {
    expect(pickCurrentSnapshot(['x.html'], id, 'html')).toBeNull();
    expect(pickCurrentSnapshot([], id, 'html')).toBeNull();
  });
});
