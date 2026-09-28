import { describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadOnceForStaleChunk } from './stale-chunk';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/WizardPage-abc.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://x/assets/a.js',
  ])('各ブラウザの文面を拾う: %s', (message) => {
    expect(isStaleChunkError(new TypeError(message))).toBe(true);
  });

  it('それ以外の例外やエラー以外の値は拾わない', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('reloadOnceForStaleChunk', () => {
  it('初回は再読み込みし、1分以内の2回目はしない(再読み込みの無限ループを防ぐ)', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(storage, 1_000_000, reload)).toBe(true);
    expect(reloadOnceForStaleChunk(storage, 1_000_000 + 59_999, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('1分たてば再び再読み込みする(次のデプロイ後の古いタブも救う)', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForStaleChunk(storage, 1_000_000, reload);
    expect(reloadOnceForStaleChunk(storage, 1_000_000 + 60_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('保存領域が使えないときは再読み込みしない(繰り返しを防げないため)', () => {
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(reloadOnceForStaleChunk(broken, 1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
