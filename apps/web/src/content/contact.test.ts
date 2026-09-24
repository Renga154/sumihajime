import { describe, expect, it } from 'vitest';
import { FEEDBACK_FORM_URL, FEEDBACK_TOPICS, buildReportUrl } from './contact';

describe('誤り報告の窓口', () => {
  it('窓口は公開済みの Google フォーム(回答用URL)を指す', () => {
    expect(FEEDBACK_FORM_URL).toMatch(
      /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/,
    );
  });

  it('手続き詳細からのリンクは種類・対象・ページURLだけを事前入力する', () => {
    const url = new URL(
      buildReportUrl({
        procedureTitle: '児童手当',
        municipalityCode: '13101',
        pageUrl: 'https://app.sumihajime.workers.dev/procedures/procedure_child_allowance',
      })!,
    );
    expect(url.searchParams.get('usp')).toBe('pp_url');
    expect(url.searchParams.get('entry.1595257451')).toBe(FEEDBACK_TOPICS[0]);
    expect(url.searchParams.get('entry.550992746')).toBe('児童手当（自治体コード 13101）');
    expect(url.searchParams.get('entry.242184327')).toBe(
      'https://app.sumihajime.workers.dev/procedures/procedure_child_allowance',
    );
    // 事前入力は上の4つだけ。利用者の入力条件(引越し日・世帯など)を載せない(原則6・7)。
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['entry.1595257451', 'entry.242184327', 'entry.550992746', 'usp'].sort(),
    );
  });
});
