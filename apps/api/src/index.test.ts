import { describe, expect, it } from 'vitest';
import app from './index';

describe('GET /api/health', () => {
  it('returns ok with the version', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, version: '0.0.1' });
  });
});
