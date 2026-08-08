// @tmn/rag — municipality-scoped RAG: chunking / retrieval helpers / answer generation /
// output validation / rate limiting (T-013). Pure logic + minimal OpenAI client; Cloudflare
// bindings (Vectorize/D1) are wired in apps/api. Kept behind the RAG_ENABLED flag.

export const RAG_PACKAGE_VERSION = '0.1.0';

export * from './types.js';
export * from './chunk.js';
export * from './openai.js';
export * from './prompt.js';
export * from './answer.js';
export * from './intent.js';
export * from './order.js';
export * from './documents.js';
export * from './ratelimit.js';
