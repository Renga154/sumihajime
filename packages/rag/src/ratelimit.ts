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

  /**
   * now の時点で満タンまで補充済みか(=新品のバケットと区別がつかないか)。
   * 満タンのバケットは捨てても、次の要求で新しく作ったものと挙動が同じなので安全に消せる。
   */
  isFullAt(now: number): boolean {
    const elapsedSec = Math.max(0, (now - this.last) / 1000);
    return this.tokens + elapsedSec * this.refillPerSec >= this.capacity;
  }
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private lastSweep: number | undefined;

  /**
   * @param capacity バケット容量(バースト許容数)
   * @param refillPerSec 毎秒の補充トークン数(例: 10req/分 = 容量10・補充10/60)
   * @param maxKeys 保持するキー数の上限(メモリの上限)
   */
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys: number = 10_000,
  ) {}

  /** 現在保持しているキー数(テスト・観測用)。 */
  get size(): number {
    return this.buckets.size;
  }

  /** key(IP等)に対して1リクエストを許可できれば true、超過なら false。 */
  allow(key: string, now: number = Date.now()): boolean {
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // 上限に達していれば最も古く登録したキーから捨てる(Map は挿入順を保つ)。
      // 捨てられたキーは次回まっさらなバケットになる=その分だけ緩くなるが、メモリを
      // 無制限に使って isolate ごと落ちるよりよい(厳密な制限は D1 の1日上限が受け持つ)。
      while (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next();
        if (oldest.done) break;
        this.buckets.delete(oldest.value);
      }
      bucket = new TokenBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, bucket);
    }
    return bucket.tryRemove(now);
  }

  /**
   * 満タンに戻ったバケットを捨てる。
   *
   * なぜ: 以前はIPごとのバケットを一度作ると二度と消さず、isolate が生きている限り
   * 訪れたIPの数だけメモリが増え続けた。満タンのバケットは新品と同じなので、消しても
   * 制限の挙動は変わらない。全件走査は満タンに戻るまでの時間(容量÷補充速度)に1回だけ行い、
   * 要求ごとのコストを増やさない。
   */
  private sweep(now: number): void {
    const fullRefillMs = (this.capacity / this.refillPerSec) * 1000;
    if (this.lastSweep !== undefined && now - this.lastSweep < fullRefillMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.isFullAt(now)) this.buckets.delete(key);
    }
  }
}
