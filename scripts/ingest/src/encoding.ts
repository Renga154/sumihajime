/**
 * なぜ: 対象自治体CSV/HTMLは文字コードが混在する(docs/research/audit-verification.md)。
 *   - UTF-8 BOM付き(世田谷ごみ分別・施設、新宿ごみ分別 等)
 *   - UTF-16LE BOM付き(新宿GIF施設CSV。UTF-8想定で読むと全滅する)
 *   - BOM無し Shift-JIS(世田谷ごみ収集曜日CSV、江東区CSV)
 * これらを自動判定せずに読むと文字化けし、本文抽出・差分・正規化が全て壊れる。
 * BOM検出を最優先し、BOMが無い場合は「厳格UTF-8として復号できるか」で
 * UTF-8 と Shift-JIS を切り分ける(日本語Shift-JISはほぼ確実に厳格UTF-8復号に失敗する)。
 */

export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis';

export interface EncodingDetection {
  encoding: DetectedEncoding;
  /** BOMを検出したか(判定根拠の可視化・レポート用)。 */
  hadBom: boolean;
}

export interface DecodeResult extends EncodingDetection {
  /** BOMを取り除いた復号済みテキスト。 */
  text: string;
}

/** 厳格(fatal)UTF-8として復号できるか。失敗すれば非UTF-8とみなす。 */
function isStrictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * バイト列から文字コードを判定する(復号はしない)。
 * 判定順: UTF-8 BOM → UTF-16LE BOM → UTF-16BE BOM → 厳格UTF-8 → Shift-JIS。
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', hadBom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', hadBom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', hadBom: true };
  }
  // BOM無し: 厳格UTF-8で通ればUTF-8(ASCIIも含む)、通らなければShift-JISとみなす。
  if (isStrictUtf8(bytes)) {
    return { encoding: 'utf-8', hadBom: false };
  }
  return { encoding: 'shift_jis', hadBom: false };
}

/**
 * 文字コードを自動判定して復号する。先頭のBOM(U+FEFF)は取り除く。
 * なぜ: content_hash は生バイトに対して計算する(この関数は使わない)。復号は
 * HTML本文抽出・差分・レポート表示のためだけに使う。
 */
export function decodeBuffer(bytes: Uint8Array): DecodeResult {
  const detected = detectEncoding(bytes);
  // TextDecoder は既定(ignoreBOM=false)で先頭BOMを除去するが、取りこぼしに備え明示的にも除去。
  const raw = new TextDecoder(detected.encoding).decode(bytes);
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return { ...detected, text };
}
