/**
 * なぜ: registry.csv / coverage.csv を依存追加なしで安全に読む最小CSVパーサ。
 * RFC4180準拠(ダブルクォート囲み・""エスケープ・改行含みセル)を扱いつつ、
 * 台帳が将来クォートやカンマを含む値を持っても壊れないようにする。
 * 列数がヘッダと一致しない行は「静かに壊れる」より早期に検出したいので呼び出し側で検証する。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  // BOM除去(UTF-8 BOM付きCSVがあり得るため)。
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      rows.push(record);
      record = [];
      field = '';
    } else if (ch === '\r') {
      // CRLFのCRは無視(次の\nで確定)。
    } else {
      field += ch;
    }
  }
  // 末尾に改行がない場合の最終レコードを確定。
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

/**
 * なぜ: ヘッダ行をキーにしたオブジェクト配列へ変換。列数不一致は publish を止める
 * (台帳の壊れをそのまま公開しないため)。
 */
export function parseCsvRecords(text: string, sourceLabel: string): Record<string, string>[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
  const [header, ...dataRows] = rows;
  if (!header) return [];
  return dataRows.map((row, idx) => {
    if (row.length !== header.length) {
      throw new Error(
        `${sourceLabel}: row ${idx + 2} has ${row.length} columns but header has ${header.length}. ` +
          `Refusing to publish a malformed ledger.`,
      );
    }
    const rec: Record<string, string> = {};
    header.forEach((key, i) => {
      rec[key] = row[i] ?? '';
    });
    return rec;
  });
}
