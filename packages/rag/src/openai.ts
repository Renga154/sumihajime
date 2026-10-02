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

/**
 * APIキーを送ってよい宛先ホスト(完全一致)。
 * - api.openai.com: OpenAI 本体
 * - gateway.ai.cloudflare.com: Cloudflare AI Gateway(D-2。https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai)
 *
 * なぜ許可リストか(2026-10-02 監査): baseURL は環境変数(OPENAI_BASE_URL)から来て、検証なしで
 * fetch の宛先になり Authorization: Bearer <キー> が付いていた。設定の誤りやすり替え(http・別ホスト・
 * `https://api.openai.com@evil/` のような userinfo の偽装)で鍵が第三者へ渡る。宛先を固定の2ホストに
 * 限り、それ以外は送る前に失敗させる(閉じる側に倒す)。宛先を増やすときはここへ足す。
 */
export const ALLOWED_OPENAI_HOSTS = ['api.openai.com', 'gateway.ai.cloudflare.com'] as const;

/** baseURL が鍵を送ってよい宛先か(https・許可ホストの完全一致・ポート/userinfo なし)。純関数。 */
export function isAllowedOpenAIBaseUrl(baseURL: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return false;
  return (ALLOWED_OPENAI_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase());
}

function endpoint(baseURL: string, path: string): string {
  // なぜここでも検証するか: 呼び出し側(apps/api・scripts/rag)が検証を忘れても、鍵を載せた
  // リクエストが許可外へ出ないようにする最後の関門。例外文に URL もキーも含めない。
  if (!isAllowedOpenAIBaseUrl(baseURL)) {
    throw new OpenAIError('baseURL is not an allowed OpenAI endpoint');
  }
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
  // 宛先の検証は try の外で行う(許可外なら fetch に到達する前に、そのままの理由で失敗させる)。
  const url = endpoint(cfg.baseURL, 'embeddings');
  let res: Response;
  try {
    res = await f(url, {
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

/**
 * 生成トークンの上限。なぜ: 未指定だとモデル既定の上限まで生成でき、質問文で「長く書け」と
 * 指示されれば1件あたりの費用が青天井になる。実回答(端的な回答+条件・注意+SOURCES行)は
 * 評価データで数百トークンに収まっており、800 はその余裕を見た値。上限で切れた回答は
 * SOURCES 行を失うため、出力検証(引用なし→保留)で自然に保留へ倒れる。
 */
export const CHAT_MAX_TOKENS = 800;

/** チャット補完 → 応答テキスト。temperature=0 で決定論寄りに。 */
export async function chatComplete(
  messages: ChatMessage[],
  model: string,
  cfg: OpenAIConfig,
): Promise<string> {
  const f = cfg.fetchImpl ?? (fetch as unknown as FetchLike);
  // 宛先の検証は try の外で行う(許可外なら fetch に到達する前に、そのままの理由で失敗させる)。
  const url = endpoint(cfg.baseURL, 'chat/completions');
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: CHAT_MAX_TOKENS }),
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
