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

/**
 * レート制限のキー(CF-Connecting-IP の値 → 数える単位)。
 *
 * なぜ IPv6 を /64 にまとめるのか: IPv6 では1契約(1家庭・1端末)に /64 がまるごと割り当てられる
 * のが普通で、末尾64ビットは利用者側で自由に変えられる(プライバシー拡張で自動的にも変わる)。
 * アドレス単位で数えると、同じ相手がアドレスを替えるだけで制限を素通りできる。/64 より広く
 * まとめると、同じ事業者の別の契約者まで巻き込む。
 * IPv4 は従来どおりアドレス単位(CGNAT で複数人が1アドレスを共有し得るが、それは /64 化と無関係)。
 *
 * 値はキーとしてだけ使い、ログ・応答には出さない(IP は個人に紐づき得る。原則7)。
 * 解釈できない値は落とさずに原文(小文字)をキーにする: CF-Connecting-IP は Cloudflare が付ける
 * ヘッダで利用者は書き換えられないため、形が崩れていても「制限を外す」方向には倒さない。
 */
export function rateLimitKeyForIp(raw: string | undefined | null): string {
  const ip = (raw ?? '').trim().toLowerCase();
  if (ip.length === 0) return 'unknown';
  if (!ip.includes(':')) return ip;
  const hextets = expandIpv6(ip);
  if (!hextets) return ip;
  // ::ffff:a.b.c.d(IPv4 射影)は IPv4 の利用者なので、IPv4 と同じキーにする。
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const hi = hextets[6] ?? 0;
    const lo = hextets[7] ?? 0;
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(':')}::/64`;
}

/** IPv6 文字列 → 16ビット×8。"::" の省略・末尾の埋め込み IPv4・ゾーンID(%eth0)を扱う。 */
function expandIpv6(ip: string): number[] | null {
  let text = ip.split('%')[0] ?? '';
  const tail: number[] = [];
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1, 5).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((o) => o > 255)) return null;
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, v4.index);
    // "::ffff:1.2.3.4" は末尾に ":" が1つ残る("::1.2.3.4" の "::" は省略記号なので残す)。
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s.length === 0) return [];
    const out: number[] = [];
    for (const h of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = parse(parts[0] ?? '');
  const rest = parts.length === 2 ? parse(parts[1] ?? '') : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (parts.length === 2) {
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
  }
  return known === 8 ? [...head, ...tail] : null;
}
