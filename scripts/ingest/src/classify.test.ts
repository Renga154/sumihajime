import { describe, expect, it } from 'vitest';
import { applyUpdate, classify } from './classify.js';
import { parseRegistryTable, serializeRegistry, tableToRecords } from './registry.js';

describe('classify — hash comparison', () => {
  it('unchanged when stored hash equals fetched hash', () => {
    expect(classify('abc', 'abc', true)).toBe('unchanged');
  });
  it('changed when hashes differ', () => {
    expect(classify('abc', 'def', true)).toBe('changed');
  });
  it('changed when no stored hash (first capture)', () => {
    expect(classify(undefined, 'def', true)).toBe('changed');
    expect(classify('', 'def', true)).toBe('changed');
  });
  it('fetch_error when fetch failed', () => {
    expect(classify('abc', undefined, false)).toBe('fetch_error');
    expect(classify('abc', 'abc', false)).toBe('fetch_error');
  });
});

// 最小fixture(列順は本物の registry.csv と同一)。実台帳は一切触らない。
const FIXTURE = [
  'source_id,source_title,owner_organization,municipality_code,category,source_url,source_type,license,attribution_text,fetch_method,update_frequency,last_fetched_at,last_verified_at,source_last_modified_at,content_hash,effective_from,effective_to,review_status,reviewer,notes',
  'src-x-001,Title X,Owner,13112,cat,https://www.city.setagaya.lg.jp/x.html,html,CC BY 4.0,Attr,http_get,annual,2026-07-01,2026-07-01,,HASH_OLD,,,approved,rev,note',
  'src-x-002,Title Y,Owner,13112,cat,https://www.city.setagaya.lg.jp/y.csv,csv,CC BY 4.0,Attr,http_get,annual,2026-07-01,2026-07-01,,HASH_SAME,,,approved,rev,note',
  'src-x-003,Title Z,Owner,13112,cat,https://www.city.setagaya.lg.jp/z.html,html,CC BY 4.0,Attr,http_get,annual,2026-07-01,2026-07-01,,HASH_ERR,,,approved,rev,note',
  '',
].join('\n');

describe('applyUpdate — --update rewrite (pending demotion, read-only default)', () => {
  it('demotes changed rows to pending and updates hash + last_fetched_at', () => {
    const table = parseRegistryTable(FIXTURE);
    const updated = applyUpdate(
      table,
      [
        { sourceId: 'src-x-001', classification: 'changed', newHash: 'HASH_NEW' },
        { sourceId: 'src-x-002', classification: 'unchanged', newHash: 'HASH_SAME' },
        { sourceId: 'src-x-003', classification: 'fetch_error' },
      ],
      '2026-07-22',
    );
    const recs = tableToRecords(updated);
    const byId = Object.fromEntries(recs.map((r) => [r.source_id, r]));

    // changed: hash更新 + pending降格 + last_fetched更新
    expect(byId['src-x-001'].content_hash).toBe('HASH_NEW');
    expect(byId['src-x-001'].review_status).toBe('pending');
    expect(byId['src-x-001'].last_fetched_at).toBe('2026-07-22');

    // unchanged: hash/status据え置き、last_fetchedのみ更新
    expect(byId['src-x-002'].content_hash).toBe('HASH_SAME');
    expect(byId['src-x-002'].review_status).toBe('approved');
    expect(byId['src-x-002'].last_fetched_at).toBe('2026-07-22');

    // fetch_error: 一切変更しない(鮮度も更新しない)
    expect(byId['src-x-003'].content_hash).toBe('HASH_ERR');
    expect(byId['src-x-003'].review_status).toBe('approved');
    expect(byId['src-x-003'].last_fetched_at).toBe('2026-07-01');
  });

  it('applyUpdate is non-destructive: the source table is not mutated', () => {
    const table = parseRegistryTable(FIXTURE);
    const before = serializeRegistry(table);
    applyUpdate(
      table,
      [{ sourceId: 'src-x-001', classification: 'changed', newHash: 'X' }],
      '2026-07-22',
    );
    expect(serializeRegistry(table)).toBe(before); // 元テーブルは不変
  });

  it('read-only default: parse -> serialize is a faithful round-trip (no --update = no change)', () => {
    const table = parseRegistryTable(FIXTURE);
    expect(serializeRegistry(table)).toBe(FIXTURE);
  });
});
