import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getChatAvailability, getMunicipalities, postChat } from './client';

/**
 * なぜ: 回線が切れる代わりに無音になる(接続は張れたまま応答が来ない)のはモバイルで
 * 最も普通の失敗であり、fetch はこの状態で永久に解決しない。タイムアウトが無いと画面は
 * 読み込み中のまま固定され、利用者には文言も再試行手段も出ない。エラーより無反応のほうが
 * 悪いため、「一定時間で必ず打ち切って次の行動が分かる文面を出す」ことを回帰テストで固定する。
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 決して解決しない fetch(dead-air な接続の再現)。 */
function stubHangingFetch() {
  const calls: Array<{ signal?: AbortSignal | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      calls.push({ signal: init?.signal });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }),
  );
  return calls;
}

describe('応答が返らないときは必ず打ち切る', () => {
  it('GET は10秒で ApiError(timeout) になり、読み込み中のまま固まらない', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const promise = getMunicipalities();
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('打ち切り時の文面は次の行動(通信環境の確認と再試行)を伝える', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const promise = getMunicipalities().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = (await promise) as ApiError;

    expect(error.code).toBe('timeout');
    expect(error.message).toContain('通信環境');
    expect(error.message).toContain('お試しください');
  });

  it('打ち切りより前には解決しない(早すぎる中断で正常応答を捨てない)', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    let settled = false;
    void getMunicipalities().then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBe(false);
  });

  it('POST /api/chat も打ち切る(サーバー側15秒より長い余裕を持たせる)', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const promise = postChat({ municipalityCode: '13104', question: 'テスト' }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    const error = (await promise) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('timeout');
  });

  it('チャット可否の問い合わせが無反応なら利用不可(パネルを出さない安全側)へ倒す', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const promise = getChatAvailability();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toEqual({ enabled: false, mode: 'disabled' });
  });

  it('中断は AbortSignal で行い、接続を放置しない', async () => {
    vi.useFakeTimers();
    const calls = stubHangingFetch();

    const promise = getMunicipalities().catch(() => undefined);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;
    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('通常の失敗は従来どおり区別して伝える', () => {
  it('接続そのものが失敗したときは network_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = (await getMunicipalities().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('network_error');
    expect(error.message).toContain('サーバーに接続できませんでした');
  });
});
