/**
 * なぜ: §13「/chat は厳しめのレート制限」。CF-Connecting-IP 単位の簡易トークンバケット。
 * 注意: Workers は複数isolateに分散するため、このプロセス内メモリのバケットは isolate 単位でしか
 * 効かず、グローバルな厳密制限ではない(悪用の第一防波堤=DoS緩和として十分。厳密制限はDO/KVが必要)。
 */

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** トークンを1つ消費できれば true。時間経過に応じて補充する。 */
  tryRemove(now: number = Date.now()): boolean {
    const elapsedSec = Math.max(0, (now - this.last) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  /**
   * @param capacity バケット容量(バースト許容数)
   * @param refillPerSec 毎秒の補充トークン数(例: 10req/分 = 容量10・補充10/60)
   */
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  /** key(IP等)に対して1リクエストを許可できれば true、超過なら false。 */
  allow(key: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, bucket);
    }
    return bucket.tryRemove(now);
  }
}
