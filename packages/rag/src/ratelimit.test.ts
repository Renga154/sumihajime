import { describe, it, expect } from 'vitest';
import { TokenBucket, RateLimiter } from './ratelimit.js';

describe('TokenBucket', () => {
  it('容量まではバースト許可、超過は拒否', () => {
    const b = new TokenBucket(3, 1, 0);
    expect(b.tryRemove(0)).toBe(true);
    expect(b.tryRemove(0)).toBe(true);
    expect(b.tryRemove(0)).toBe(true);
    expect(b.tryRemove(0)).toBe(false); // 使い切り
  });

  it('時間経過で補充される', () => {
    const b = new TokenBucket(2, 1, 0); // 毎秒1補充
    expect(b.tryRemove(0)).toBe(true);
    expect(b.tryRemove(0)).toBe(true);
    expect(b.tryRemove(0)).toBe(false);
    // 1秒後に1トークン補充。
    expect(b.tryRemove(1000)).toBe(true);
    expect(b.tryRemove(1000)).toBe(false);
  });
});

describe('RateLimiter (10req/分)', () => {
  it('IPごとに独立し、10回まで許可・11回目で拒否', () => {
    const rl = new RateLimiter(10, 10 / 60);
    for (let i = 0; i < 10; i++) expect(rl.allow('1.1.1.1', 0)).toBe(true);
    expect(rl.allow('1.1.1.1', 0)).toBe(false);
    // 別IPは影響を受けない。
    expect(rl.allow('2.2.2.2', 0)).toBe(true);
  });
});
