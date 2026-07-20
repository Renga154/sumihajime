import { Hono } from 'hono';

/**
 * Single Cloudflare Worker: serves the /api/* routes and coexists with the
 * static SPA assets (see wrangler.jsonc `run_worker_first`). Domain routes
 * (checklists, procedures, facilities, ...) are added in later tasks.
 */
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, version: '0.0.1' } as const));

export default app;
