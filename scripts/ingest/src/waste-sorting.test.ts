import { describe, expect, it } from 'vitest';
import { parseWasteSortingCsv } from './waste-sorting.js';

describe('parseWasteSortingCsv — 世田谷形式(接頭辞付き列名、地方公共団体名列なし)', () => {
  const header =
    'ごみの分別方法_全国地方公共団体コード,ごみの分別方法_ID,ごみの分別方法_品目,' +
    'ごみの分別方法_分別区分,ごみの分別方法_注意点,ごみの分別方法_料金種別,' +
    'ごみの分別方法_料金,ごみの分別方法_料金備考,ごみの分別方法_備考';
  // なぜ: 実際の世田谷CSVは「品目」列に分別区分相当(不燃ごみ)、「分別区分」列に品目名相当
  // (アイスピック)が入る(実データ確認済み。waste-sorting.ts 冒頭コメント参照)。
  const csv =
    `${header}\n` +
    '131121,131121S00001,不燃ごみ,アイスピック,,無料,,,新聞紙等に包んで「キケン」と表示してください\n' +
    '131121,131121S00002,不燃ごみ,アイロン,,無料,,,\n';

  it('itemCategorySwapped=false(誤指定)だと品目/カテゴリが逆転する(実データの列内容は逆)', () => {
    const items = parseWasteSortingCsv(csv, {
      municipalityCode: '13112',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(items[0]?.name).toBe('不燃ごみ');
    expect(items[0]?.category).toBe('アイスピック');
  });

  it('itemCategorySwapped=true で品目名とカテゴリを正しく入れ替えて割り当てる', () => {
    const items = parseWasteSortingCsv(csv, {
      municipalityCode: '13112',
      sourceId: 'src-13112-waste_sorting-001',
      itemCategorySwapped: true,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      itemId: '131121S00001',
      municipalityCode: '13112',
      name: 'アイスピック',
      category: '不燃ごみ',
      notes: '新聞紙等に包んで「キケン」と表示してください',
      feeNote: '無料',
      sourceId: 'src-13112-waste_sorting-001',
    });
  });

  it('omits notes/feeNote when the source columns are blank (no fabrication)', () => {
    const items = parseWasteSortingCsv(csv, {
      municipalityCode: '13112',
      sourceId: 'src-13112-waste_sorting-001',
      itemCategorySwapped: true,
    });
    expect(items[1]?.notes).toBeUndefined();
    // 2行目は料金種別「無料」が入っているのでfeeNoteは付く。
    expect(items[1]?.feeNote).toBe('無料');
  });
});

describe('parseWasteSortingCsv — 江東/新宿形式(接頭辞なし、地方公共団体名列あり)', () => {
  const header =
    '全国地方公共団体コード,ID,地方公共団体名,ゴミの品目,分別区分,注意点,料金種別,料金,料金備考,備考';
  const csv =
    `${header}\n` +
    '131083,131083S00001,江東区,IH調理器,粗大ごみ,,,,,\n' +
    '131083,131083S00002,江東区,空き缶(アルミ・スチール),資源,,,,,中をすすいでください\n';

  it('finds columns by suffix match despite the extra 地方公共団体名 column', () => {
    const items = parseWasteSortingCsv(csv, {
      municipalityCode: '13108',
      sourceId: 'src-13108-waste_sorting-001',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      itemId: '131083S00001',
      municipalityCode: '13108',
      name: 'IH調理器',
      category: '粗大ごみ',
      sourceId: 'src-13108-waste_sorting-001',
    });
    expect(items[1]?.notes).toBe('中をすすいでください');
    // 料金種別が空欄の行はfeeNoteを持たない(捏造禁止)。
    expect(items[1]?.feeNote).toBeUndefined();
  });
});

describe('parseWasteSortingCsv — 異常系', () => {
  it('throws when a data row has a different column count than the header', () => {
    const header =
      '全国地方公共団体コード,ID,地方公共団体名,ゴミの品目,分別区分,注意点,料金種別,料金,料金備考,備考';
    const badRow = '131041,131041S00001,新宿区,アイスピック,金属・陶器・ガラスごみ';
    expect(() =>
      parseWasteSortingCsv(`${header}\n${badRow}\n`, {
        municipalityCode: '13104',
        sourceId: 'src-13104-waste_sorting-001',
      }),
    ).toThrow(/columns/);
  });

  it('throws when an expected column is missing', () => {
    const header = 'ID,品目'; // 分別区分・料金種別・備考が欠落
    expect(() =>
      parseWasteSortingCsv(`${header}\nS1,アイロン\n`, {
        municipalityCode: '13112',
        sourceId: 'src-13112-waste_sorting-001',
      }),
    ).toThrow(/分別区分/);
  });

  it('returns an empty array for a header-only CSV', () => {
    const header = 'ID,品目,分別区分,料金種別,備考';
    const items = parseWasteSortingCsv(`${header}\n`, {
      municipalityCode: '13112',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(items).toEqual([]);
  });

  it('handles a UTF-8 BOM prefix (as present in the real snapshots)', () => {
    const header = 'ID,品目,分別区分,料金種別,備考';
    const csv = `\uFEFF${header}\nS1,アイロン,不燃ごみ,,\n`;
    const items = parseWasteSortingCsv(csv, {
      municipalityCode: '13112',
      sourceId: 'src-13112-waste_sorting-001',
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.itemId).toBe('S1');
  });
});
