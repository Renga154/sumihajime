import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_TOKENS,
  OpenAIError,
  chatComplete,
  embedText,
  isAllowedOpenAIBaseUrl,
  type FetchLike,
} from './openai.js';

/** 送られた本文を記録し、固定の応答を返す fetch。 */
function capturingFetch(): { fetchImpl: FetchLike; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: '回答' } }] }), {
      status: 200,
    });
  };
  return { fetchImpl, bodies };
}

describe('chatComplete', () => {
  it('生成トークンの上限(max_tokens)を必ず付ける(1件あたりの費用の上限)', async () => {
    const { fetchImpl, bodies } = capturingFetch();
    await chatComplete([{ role: 'user', content: 'q' }], 'gpt-4o-mini', {
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      fetchImpl,
    });
    expect(bodies[0]?.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(CHAT_MAX_TOKENS).toBeGreaterThan(0);
    expect(CHAT_MAX_TOKENS).toBeLessThanOrEqual(1000);
  });

  it('中断(AbortError)は OpenAIError に包まれる(呼び出し側は例外名ではなくシグナルで判定する)', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    const err = await chatComplete([{ role: 'user', content: 'q' }], 'm', {
      apiKey: 'k',
      baseURL: 'https://api.openai.com/v1',
      fetchImpl,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as Error).name).toBe('OpenAIError');
  });
});

/**
 * なぜ(2026-10-02 監査): OPENAI_BASE_URL は検証なしで fetch の宛先になり、Authorization: Bearer
 * <APIキー> がそのまま送られていた。設定の誤り・すり替え(http・別ホスト・userinfo 付き)で鍵が
 * 第三者へ渡る。宛先は https の OpenAI 本体と Cloudflare AI Gateway に限り、それ以外では
 * **fetch を1度も呼ばずに**失敗させる(鍵を送らない)。
 */
describe('isAllowedOpenAIBaseUrl', () => {
  it('OpenAI 本体と Cloudflare AI Gateway の https だけを許す', () => {
    expect(isAllowedOpenAIBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isAllowedOpenAIBaseUrl('https://api.openai.com/v1/')).toBe(true);
    expect(
      isAllowedOpenAIBaseUrl('https://gateway.ai.cloudflare.com/v1/acct123/my-gateway/openai'),
    ).toBe(true);
  });

  it.each([
    ['http', 'http://api.openai.com/v1'],
    ['別ホスト', 'https://api.openai.test/v1'],
    ['接尾辞の偽装', 'https://api.openai.com.evil.example/v1'],
    ['前置の偽装', 'https://evil-api.openai.com/v1'],
    ['userinfo で本体に見せかける', 'https://api.openai.com@evil.example/v1'],
    ['userinfo 付き', 'https://user:pass@api.openai.com/v1'],
    ['明示ポート', 'https://api.openai.com:8443/v1'],
    ['不正な文字列', 'not a url'],
    ['空文字', ''],
  ])('%s は拒む', (_label, url) => {
    expect(isAllowedOpenAIBaseUrl(url)).toBe(false);
  });
});

describe('許可外の baseURL では鍵を送らない', () => {
  function spyFetch(): { fetchImpl: FetchLike; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    };
    return { fetchImpl, calls };
  }

  it('embedText は fetch を呼ばずに OpenAIError を投げる', async () => {
    const { fetchImpl, calls } = spyFetch();
    const err = await embedText('q', 'm', {
      apiKey: 'secret-key',
      baseURL: 'https://evil.example/v1',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect(String((err as Error).message)).not.toContain('secret-key');
    expect(String((err as Error).message)).not.toContain('evil.example');
    expect(calls).toEqual([]);
  });

  it('chatComplete は fetch を呼ばずに OpenAIError を投げる', async () => {
    const { fetchImpl, calls } = spyFetch();
    const err = await chatComplete([{ role: 'user', content: 'q' }], 'm', {
      apiKey: 'secret-key',
      baseURL: 'http://api.openai.com/v1',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect(calls).toEqual([]);
  });
});
