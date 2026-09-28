import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_VERSION } from './version.js';

describe('API_VERSION', () => {
  it('apps/api/package.json の version と一致する(片方だけ上げない)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf-8')) as {
      version: string;
    };
    expect(API_VERSION).toBe(pkg.version);
  });
});
