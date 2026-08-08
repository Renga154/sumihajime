import { describe, expect, it } from 'vitest';
import app from './index.js';
import { chatAvailability } from './chat.js';
import type { Bindings } from './db.js';

/**
 * なぜ(独立点検 P1): 以前の /api/chat/availability は RAG_ENABLED しか見ていなかった。
 * OPENAI_API_KEY が失効していても、Vectorize バインディングが外れていても「使えます」と答え、
 * 利用者は質問を書いて送信してはじめて壊れていることを知った。実際の依存を見ることと、
 * その判定が外部APIを一切呼ばない(=課金しない)ことを固定する。
 */

const env = (o: Partial<Bindings> = {}) =>
  ({ RAG_ENABLED: 'true', OPENAI_API_KEY: 'k', VECTORIZE: {}, ...o }) as unknown as Bindings;

function get(bindings: Bindings): Promise<Response> {
  return Promise.resolve(
    app.request(
      '/api/chat/availability',
      undefined,
      bindings as unknown as Record<string, unknown>,
    ),
  );
}

describe('chatAvailability — 依存の有無から判定する(純関数)', () => {
  it('フラグ・鍵・索引がそろっていれば全機能', () => {
    expect(chatAvailability(env())).toEqual({ enabled: true, mode: 'full' });
  });

  it('フラグが無効なら利用不可(パネルを出さない)', () => {
    expect(chatAvailability(env({ RAG_ENABLED: 'false' }))).toEqual({
      enabled: false,
      mode: 'disabled',
    });
    expect(chatAvailability(env({ RAG_ENABLED: undefined }))).toEqual({
      enabled: false,
      mode: 'disabled',
    });
  });

  it('APIキーが無い/空なら、検証済みの持ち物・書類だけに縮退する', () => {
    for (const key of [undefined, '', '   ']) {
      expect(chatAvailability(env({ OPENAI_API_KEY: key }))).toEqual({
        enabled: true,
        mode: 'documents_only',
      });
    }
  });

  it('検索索引のバインディングが無ければ縮退する', () => {
    expect(chatAvailability(env({ VECTORIZE: undefined }))).toEqual({
      enabled: true,
      mode: 'documents_only',
    });
  });

  /**
   * なぜ縮退で enabled=false にしないのか: 鍵も索引も無い状態で唯一動くのが、人手で確認済みの
   * requiredDocuments を返す経路(handleChat 手順5)。この経路はRAG基盤の障害時に答えられる
   * ようLLM呼び出しより前へ置かれている(原則8)。ここで一律に隠すと、障害時にこそ効く
   * いちばん確実な回答経路まで一緒に落ちる。
   */
  it('縮退時もパネル自体は使える(使える経路を落として見せない)', () => {
    expect(chatAvailability(env({ OPENAI_API_KEY: undefined })).enabled).toBe(true);
  });
});

describe('GET /api/chat/availability', () => {
  it('判定結果をそのまま返す', async () => {
    const res = await get(env());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: true, mode: 'full' });
  });

  it('鍵が無ければ documents_only を返す', async () => {
    const res = await get(env({ OPENAI_API_KEY: undefined }));
    await expect(res.json()).resolves.toEqual({ enabled: true, mode: 'documents_only' });
  });

  it('フラグが無効なら disabled を返す', async () => {
    const res = await get(env({ RAG_ENABLED: 'false' }));
    await expect(res.json()).resolves.toEqual({ enabled: false, mode: 'disabled' });
  });

  /**
   * なぜ: 表示可否を決めるためだけに OpenAI へ実リクエストを投げると、画面を開くたび課金と
   * 外部依存が増える。判定はバインディングと設定の有無だけで完結していなければならない。
   */
  it('判定のために外部APIを呼ばない', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error('外部APIを呼んではいけない');
    }) as typeof fetch;
    try {
      await get(env());
      await get(env({ OPENAI_API_KEY: undefined }));
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toEqual([]);
  });

  it('秘密の値を応答へ出さない', async () => {
    const res = await get(env({ OPENAI_API_KEY: 'sk-super-secret-value' }));
    expect(await res.text()).not.toContain('sk-super-secret');
  });
});
