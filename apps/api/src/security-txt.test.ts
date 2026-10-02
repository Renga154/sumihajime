import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSecurityTxt, SECURITY_CONTACT_URL } from './security-txt.js';

/**
 * security.txt の Contact は画面の問い合わせ窓口と同じフォームでなければならない
 * (片方だけ差し替えて、古いフォームを連絡先として公開し続ける事故を防ぐ)。
 */
describe('security.txt', () => {
  it('Contact は web の FEEDBACK_FORM_URL と同一', () => {
    const contactTs = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../web/src/content/contact.ts'),
      'utf-8',
    );
    const match = /FEEDBACK_FORM_URL[^=]*=\s*'([^']+)'/.exec(contactTs);
    expect(match?.[1]).toBe(SECURITY_CONTACT_URL);
  });

  it('不正な CANONICAL_ORIGIN では Canonical 行を出さない', () => {
    expect(buildSecurityTxt('not a url')).not.toContain('Canonical:');
  });

  it('各行は "Field: value" の形で、末尾は改行で終わる', () => {
    const body = buildSecurityTxt('https://sumihajime.com');
    expect(body.endsWith('\n')).toBe(true);
    for (const line of body.trimEnd().split('\n')) {
      expect(line).toMatch(/^[A-Z][A-Za-z-]+: \S/);
    }
  });
});
