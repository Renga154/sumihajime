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

describe('parseWasteSortingCsv — 中野形式(layout=nakano_gis。GIS配信の独自列構成)', () => {
  const header = 'ごみの品目,インデックス,種別,説明,GIS搭載用住所,経度,緯度,分類';
  const opts = {
    municipalityCode: '13114',
    sourceId: 'src-13114-waste_sorting-001',
    layout: 'nakano_gis' as const,
  };

  it('品目/よみ/種別/説明を name/reading/category/notes へ割り当て、座標列は捨てる', () => {
    const csv =
      // 実スナップショットと同じく UTF-8 BOM 付きで与える。
      `\uFEFF${header}\n` +
      'アイスピック,あいすぴっく,陶器・ガラス・金属ごみ,危険のないよう紙などで包んでください。,' +
      '中野区中野4-11-19,139.662926236846,35.7088740640065,ごみ分別一覧\n';
    const items = parseWasteSortingCsv(csv, opts);
    expect(items).toEqual([
      {
        itemId: '13114R00001',
        municipalityCode: '13114',
        name: 'アイスピック',
        reading: 'あいすぴっく',
        category: '陶器・ガラス・金属ごみ',
        notes: '危険のないよう紙などで包んでください。',
        sourceId: 'src-13114-waste_sorting-001',
      },
    ]);
  });

  it('説明が空欄の行は notes を作らない(空文字を入れない)', () => {
    const csv = `${header}\nアイロン,あいろん,陶器・ガラス・金属ごみ,,中野区中野4-11-19,139.6,35.7,ごみ分別一覧\n`;
    const items = parseWasteSortingCsv(csv, opts);
    expect(items[0]?.notes).toBeUndefined();
    // 出典に料金列が無いため feeNote は作らない(他区の「無料/有料」を持ち込まない)。
    expect(items[0]?.feeNote).toBeUndefined();
  });

  it('itemId は出典の行順から採番する(出典にID列が無いため)', () => {
    const csv =
      `${header}\n` +
      'アイロン,あいろん,陶器・ガラス・金属ごみ,,中野区中野4-11-19,139.6,35.7,ごみ分別一覧\n' +
      'アイロン台,あいろんだい,粗大ごみ,,中野区中野4-11-19,139.6,35.7,ごみ分別一覧\n';
    expect(parseWasteSortingCsv(csv, opts).map((i) => i.itemId)).toEqual([
      '13114R00001',
      '13114R00002',
    ]);
  });

  it('セル内改行は品目名・よみでは「／」に、説明では連結して1行へ畳む', () => {
    const csv =
      `${header}\n` +
      '"アンプ\n※オーディオ機器","あんぷ\n※おーでぃおきき",粗大ごみ,' +
      '"一辺が30㎝以下の場合は\n陶器・ガラス・金属ごみです。",中野区中野4-11-19,139.6,35.7,ごみ分別一覧\n';
    const item = parseWasteSortingCsv(csv, opts)[0];
    expect(item?.name).toBe('アンプ／※オーディオ機器');
    expect(item?.reading).toBe('あんぷ／※おーでぃおきき');
    expect(item?.notes).toBe('一辺が30㎝以下の場合は陶器・ガラス・金属ごみです。');
  });

  it('既定(layout未指定)では中野の列構成を解釈できない — 自治体標準の必須列が無いため例外', () => {
    // なぜ: 分岐を足しても既定の経路は従来どおりであること(既存区の出力不変)の裏書き。
    const csv = `${header}\nアイロン,あいろん,陶器・ガラス・金属ごみ,,中野区中野4-11-19,139.6,35.7,ごみ分別一覧\n`;
    expect(() => parseWasteSortingCsv(csv, { municipalityCode: '13114', sourceId: 'x' })).toThrow(
      /ID/,
    );
  });

  it('列数が合わない行は正規化せず例外(壊れた出典を黙って通さない)', () => {
    const csv = `${header}\nアイロン,あいろん,陶器・ガラス・金属ごみ\n`;
    expect(() => parseWasteSortingCsv(csv, opts)).toThrow(/columns but/);
  });

  it('ヘッダのみのCSVは空配列', () => {
    expect(parseWasteSortingCsv(`${header}\n`, opts)).toEqual([]);
  });
});
