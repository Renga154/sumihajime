import { describe, expect, it } from 'vitest';
import { chatCitationSchema, errorResponseSchema } from './api.js';
import { municipalitySchema } from './municipality.js';
import { taskSourceRefSchema } from './task.js';
import { httpsUrlSchema } from './url.js';

/**
 * なぜ: z.url() は `javascript:`・`data:`・`http:` も通した。これらのURLは根拠カード等で <a href> に
 * なるため、台帳の誤記・改ざんがスクリプト実行や平文通信の導線になり得る。https + ドメイン名だけを許す。
 */
describe('httpsUrlSchema', () => {
  it('公式サイトの https URL は通す', () => {
    expect(httpsUrlSchema.safeParse('https://www.city.setagaya.lg.jp/02233/88.html').success).toBe(
      true,
    );
    expect(httpsUrlSchema.safeParse('https://www.vill.aogashima.tokyo.jp/top.html').success).toBe(
      true,
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://www.city.setagaya.lg.jp/',
    'ftp://example.lg.jp/file.csv',
    'https://127.0.0.1/',
    'https://localhost/',
    'not a url',
    '',
  ])('%s は拒む', (url) => {
    expect(httpsUrlSchema.safeParse(url).success).toBe(false);
  });

  it('URLを持つ公開契約はすべて https 限定になっている', () => {
    const bad = 'javascript:alert(1)';
    expect(
      chatCitationSchema.safeParse({
        sourceId: 's',
        title: 't',
        ownerOrganization: 'o',
        url: bad,
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      taskSourceRefSchema.safeParse({
        sourceId: 's',
        title: 't',
        url: bad,
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      municipalitySchema.safeParse({ code: '13112', name: 'x', supported: true, officialUrl: bad })
        .success,
    ).toBe(false);
    expect(
      errorResponseSchema.safeParse({ error: { code: 'c', message: 'm', officialUrl: bad } })
        .success,
    ).toBe(false);
  });
});
