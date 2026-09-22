/**
 * なぜ: csv/xlsx の差分は生バイトの SHA-256 で見る(台帳 content_hash と同一方式。ADR-014)。
 * Worker には node:crypto が無いため WebCrypto(crypto.subtle)で計算する。Node ≥20 でも
 * 同じ API が使えるので、publish/ingest 側のテストからも同じ関数を呼べる。
 */
export async function sha256HexWeb(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // なぜ ArrayBuffer へ複写するか: Uint8Array が共有バッファの一部(byteOffset≠0)や
  // SharedArrayBuffer 上にある場合でも、digest へ渡す型を環境差なく ArrayBuffer に揃えるため。
  const buffer: ArrayBuffer =
    bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
