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

/**
 * なぜ: 以前は一度作ったIPのバケットを二度と消さず、isolate が生きている限りメモリが増え続けた。
 * 満タンに戻ったバケットは新品と同じなので捨てても挙動が変わらない、という前提ごと固定する。
 */
describe('RateLimiter — 古いバケットの掃除', () => {
  it('満タンに戻ったIPのバケットは次の掃除で消え、再訪時は新品として扱われる', () => {
    const rl = new RateLimiter(10, 10 / 60); // 満タンまで60秒
    for (let i = 0; i < 100; i++) rl.allow(`10.0.0.${i}`, 0);
    expect(rl.size).toBe(100);
    // 60秒後の最初の要求で掃除が走り、満タンに戻った100件は消える(新しい1件だけが残る)。
    expect(rl.allow('192.0.2.1', 60_000)).toBe(true);
    expect(rl.size).toBe(1);
  });

  it('まだ補充途中(制限中)のバケットは掃除で消さない=制限をすり抜けさせない', () => {
    const rl = new RateLimiter(10, 10 / 60);
    for (let i = 0; i < 10; i++) rl.allow('203.0.113.9', 0);
    expect(rl.allow('203.0.113.9', 0)).toBe(false);
    // 30秒時点で補充された5トークンを使い切らせる。60秒時点(前回の掃除から60秒)で掃除が走るが、
    // そのときの残量は5(=補充途中)なので消えない。消えていれば新品扱いで10回通ってしまう。
    for (let i = 0; i < 5; i++) rl.allow('203.0.113.9', 30_000);
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (rl.allow('203.0.113.9', 60_000)) allowed += 1;
    expect(allowed).toBe(5);
  });

  it('キー数の上限を超えたら古いキーから捨てる(メモリ上限)', () => {
    const rl = new RateLimiter(10, 10 / 60, 3);
    for (const ip of ['a', 'b', 'c', 'd']) rl.allow(ip, 0);
    expect(rl.size).toBe(3);
  });
});
