/**
 * なぜ: OpenAI互換API(embeddings / chat completions)への最小クライアント。baseURL可変で
 * AI Gateway(D-2)へ差し替え可能。fetch を注入できるようにしてテストでモックする
 * (Vectorize/OpenAIは実呼び出ししない方針)。キーの値はここで受け取るだけで、ログ・例外に含めない。
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAIConfig {
  apiKey: string;
  /** 例: https://api.openai.com/v1(末尾スラッシュは許容)。 */
  baseURL: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

export class OpenAIError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function authHeaders(cfg: OpenAIConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    // なぜ: 値はヘッダーにのみ載せ、ログ・例外メッセージには絶対に含めない。
    authorization: `Bearer ${cfg.apiKey}`,
  };
}

/** テキスト1件 → 埋め込みベクトル。 */
export async function embedText(text: string, model: string, cfg: OpenAIConfig): Promise<number[]> {
  const f = cfg.fetchImpl ?? (fetch as unknown as FetchLike);
  let res: Response;
  try {
    res = await f(endpoint(cfg.baseURL, 'embeddings'), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({ model, input: text }),
      signal: cfg.signal,
    });
  } catch (e) {
    throw new OpenAIError(`embeddings request failed: ${(e as Error).name}`);
  }
  if (!res.ok) throw new OpenAIError(`embeddings responded ${res.status}`, res.status);
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!vec || vec.length === 0) throw new OpenAIError('embeddings returned no vector');
  return vec;
}

/** チャット補完 → 応答テキスト。temperature=0 で決定論寄りに。 */
export async function chatComplete(
  messages: ChatMessage[],
  model: string,
  cfg: OpenAIConfig,
): Promise<string> {
  const f = cfg.fetchImpl ?? (fetch as unknown as FetchLike);
  let res: Response;
  try {
    res = await f(endpoint(cfg.baseURL, 'chat/completions'), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({ model, messages, temperature: 0 }),
      signal: cfg.signal,
    });
  } catch (e) {
    throw new OpenAIError(`chat request failed: ${(e as Error).name}`);
  }
  if (!res.ok) throw new OpenAIError(`chat responded ${res.status}`, res.status);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new OpenAIError('chat returned empty content');
  }
  return content;
}
