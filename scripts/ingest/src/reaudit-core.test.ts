import { describe, expect, it } from 'vitest';
import {
  checkFacts,
  extractNumericFacts,
  isDateOnlyLine,
  normalizeForFacts,
} from './reaudit-core.js';

describe('normalizeForFacts', () => {
  it('全角数字・月数の表記ゆれ・空白をそろえる', () => {
    expect(normalizeForFacts('３ヶ月 以内')).toBe('3か月以内');
    expect(normalizeForFacts('3カ月')).toBe('3か月');
    expect(normalizeForFacts('3 箇月')).toBe('3か月');
  });
});

describe('extractNumericFacts', () => {
  it('期限・年齢・日付を抜き出し、月日の「日」を日数として二重に数えない', () => {
    expect(extractNumericFacts('18歳に達する日以後の最初の3月31日まで。翌日から3ヶ月以内')).toEqual(
      ['3月31日', '18歳', '3か月'],
    );
  });

  it('日数・週間・円・重複', () => {
    expect(extractNumericFacts('14日以内。14日を過ぎると2週間…手数料300円')).toEqual([
      '14日',
      '2週間',
      '300円',
    ]);
  });

  it('数の無い文からは何も取らない', () => {
    expect(extractNumericFacts('窓口・郵送・マイナポータル')).toEqual([]);
  });
});

describe('checkFacts', () => {
  it('承認時にあって今は無い事実を inOld && !inNew で示す', () => {
    const r = checkFacts(
      ['3ヶ月以内に申請', '18歳'],
      '翌日から３カ月以内。18歳まで',
      '翌日から6か月以内。18歳まで',
    );
    expect(r).toEqual([
      { fact: '3か月', inOld: true, inNew: false },
      { fact: '18歳', inOld: true, inNew: true },
    ]);
  });
});

describe('isDateOnlyLine', () => {
  it('更新日の行だけを読み飛ばし候補にする', () => {
    expect(isDateOnlyLine('更新日：2026年9月11日')).toBe(true);
    expect(isDateOnlyLine('最終更新日 令和8年9月15日')).toBe(true);
    expect(isDateOnlyLine('ページ更新日：2026/08/28')).toBe(true);
    expect(isDateOnlyLine('令和8年10月1日より利用できる医療証を発送しました')).toBe(false);
  });
});
