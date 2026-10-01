import { describe, expect, it } from 'vitest';
import { RateLimiter, rateLimitKeyForIp } from './ratelimit.js';

/**
 * IPv6 は1契約(1家庭・1端末)に /64 がまるごと割り当てられるのが普通で、末尾64ビットは利用者側で
 * 自由に変えられる(プライバシー拡張で定期的にも変わる)。アドレス単位で数えると、同じ相手が
 * アドレスを替えるだけで制限を素通りできる。
 */
describe('rateLimitKeyForIp', () => {
  it('攻撃: 同じ /64 の中でアドレスを替えても同じキーになる', () => {
    const a = rateLimitKeyForIp('2001:db8:1234:5678::1');
    const b = rateLimitKeyForIp('2001:db8:1234:5678:ffff:eeee:dddd:cccc');
    const c = rateLimitKeyForIp('2001:0DB8:1234:5678:0:0:0:abcd');
    expect(a).toBe('2001:db8:1234:5678::/64');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('攻撃: アドレスを替えても in-memory の制限を抜けられない', () => {
    const rl = new RateLimiter(2, 2 / 60);
    expect(rl.allow(rateLimitKeyForIp('2001:db8:1:2::1'), 0)).toBe(true);
    expect(rl.allow(rateLimitKeyForIp('2001:db8:1:2::2'), 0)).toBe(true);
    expect(rl.allow(rateLimitKeyForIp('2001:db8:1:2::3'), 0)).toBe(false);
  });

  it('正常: 別の /64 は別キー(隣の契約者を巻き込まない)', () => {
    expect(rateLimitKeyForIp('2001:db8:1:2::1')).not.toBe(rateLimitKeyForIp('2001:db8:1:3::1'));
  });

  it('"::" の省略位置が前半にあっても正しく展開する', () => {
    expect(rateLimitKeyForIp('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKeyForIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKeyForIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('IPv4 射影アドレスは IPv4 として扱う', () => {
    expect(rateLimitKeyForIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('正常: IPv4 はそのまま(既存の挙動を変えない)', () => {
    expect(rateLimitKeyForIp('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKeyForIp(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('ヘッダが無い(ローカル・テスト)ときは共通キー', () => {
    expect(rateLimitKeyForIp(undefined)).toBe('unknown');
    expect(rateLimitKeyForIp('')).toBe('unknown');
  });

  it('解釈できない IPv6 風の値は小文字化した原文をキーにする(落とさない)', () => {
    expect(rateLimitKeyForIp('ZZZZ::1')).toBe('zzzz::1');
  });
});
