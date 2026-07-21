import { createHash } from 'node:crypto';

/**
 * なぜ: registry.csv の content_hash と同一方式で生バイトのSHA-256を16進で得る。
 * 復号や整形を挟まず「取得した生バイトそのもの」をハッシュすることで、
 * 既存スナップショットの記録値と再現可能に一致する(T-005で記録済みの値と突き合わせる)。
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
