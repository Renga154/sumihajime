import { describe, expect, it } from 'vitest';
import { CHAT_MAX_TOKENS, OpenAIError, chatComplete, type FetchLike } from './openai.js';

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
      baseURL: 'https://api.openai.test/v1',
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
      baseURL: 'https://api.openai.test/v1',
      fetchImpl,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as Error).name).toBe('OpenAIError');
  });
});
