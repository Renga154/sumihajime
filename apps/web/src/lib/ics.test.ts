import { describe, expect, it } from 'vitest';
import type { GeneratedTask } from '@tmn/schemas';
import { buildChecklistIcs, datedTasks, escapeIcsText, foldIcsLine } from './ics';

/**
 * なぜ: ICS生成は純関数(サーバー非依存)。エスケープ・75オクテット折返し・UID安定性という
 * カレンダー互換性の要を固定する。dtstamp を注入して決定論的に検証する。
 */

function makeTask(o: Partial<GeneratedTask>): GeneratedTask {
  return {
    id: o.id ?? 'id',
    procedureId: o.procedureId ?? 'procedure_x',
    title: o.title ?? 'タスク',
    category: 'c',
    priority: o.priority ?? 'normal',
    applicabilityReason: o.applicabilityReason ?? '理由',
    dueDate: o.dueDate,
    requiredDocuments: [],
    channels: ['counter'],
    sources: o.sources ?? [
      {
        sourceId: 's1',
        title: '公式ページ',
        url: 'https://example.lg.jp/a',
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      },
    ],
    dataStatus: 'partial',
    ruleVersion: 'v1',
    procedureVersion: 'v1',
    ...o,
  };
}

const DTSTAMP = { dtstamp: new Date('2026-07-23T09:00:00Z') };

describe('escapeIcsText', () => {
  it('バックスラッシュ・セミコロン・カンマ・改行をエスケープする', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });
  it('コロン(URL)はエスケープしない', () => {
    expect(escapeIcsText('https://example.lg.jp/x')).toBe('https://example.lg.jp/x');
  });
  it('CRLF・CRも \\n に正規化する', () => {
    expect(escapeIcsText('a\r\nb\rc')).toBe('a\\nb\\nc');
  });
});

describe('foldIcsLine', () => {
  it('75オクテット以下はそのまま返す', () => {
    const line = 'SUMMARY:short';
    expect(foldIcsLine(line)).toBe(line);
  });

  it('75オクテット超は CRLF+空白 で折り、各物理行は75オクテット以下', () => {
    const line = 'DESCRIPTION:' + 'あ'.repeat(60); // 'あ'=3バイト → 180+12=192オクテット
    const folded = foldIcsLine(line);
    expect(folded).toContain('\r\n ');
    const enc = new TextEncoder();
    for (const physical of folded.split('\r\n')) {
      expect(enc.encode(physical).length).toBeLessThanOrEqual(75);
    }
  });

  it('折返しは文字(コードポイント)境界を壊さない(元テキストが復元できる)', () => {
    const line = 'DESCRIPTION:' + 'あ'.repeat(60);
    // 継続行の先頭空白1つを取り除いて連結すると元に戻る。
    const restored = foldIcsLine(line).split('\r\n ').join('');
    expect(restored).toBe(line);
    // マルチバイト文字が分割されて文字化けしていないこと。
    expect(restored).not.toContain('�');
  });
});

describe('buildChecklistIcs', () => {
  it('dueDate を持つタスクだけを VEVENT にする', () => {
    const ics = buildChecklistIcs(
      [
        makeTask({ procedureId: 'p_with', dueDate: '2026-08-29' }),
        makeTask({ procedureId: 'p_without', dueDate: undefined }),
      ],
      '13112',
      DTSTAMP,
    );
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain('UID:13112-p_with@tokyo-move-navi');
    expect(ics).not.toContain('p_without');
  });

  it('終日イベント(DATE)で DTSTART と翌日 DTEND を出力する', () => {
    const ics = buildChecklistIcs(
      [makeTask({ procedureId: 'p', dueDate: '2026-08-29' })],
      '13112',
      DTSTAMP,
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20260829');
    expect(ics).toContain('DTEND;VALUE=DATE:20260830');
  });

  it('DESCRIPTION に理由・公式URL・最終確認日を含める', () => {
    const ics = buildChecklistIcs(
      [
        makeTask({
          procedureId: 'p',
          dueDate: '2026-08-29',
          applicabilityReason: '転入日から14日以内に届け出が必要です',
          sources: [
            {
              sourceId: 's1',
              title: '転入届',
              url: 'https://www.city.setagaya.lg.jp/02233/88.html',
              lastVerifiedAt: '2026-07-21T00:00:00Z',
            },
          ],
        }),
      ],
      '13112',
      DTSTAMP,
    );
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('転入日から14日以内に届け出が必要です');
    expect(unfolded).toContain('公式: https://www.city.setagaya.lg.jp/02233/88.html');
    expect(unfolded).toContain('最終確認日: 2026年7月21日');
  });

  it('SUMMARY の特殊文字をエスケープする', () => {
    const ics = buildChecklistIcs(
      [makeTask({ procedureId: 'p', dueDate: '2026-08-29', title: '国保; 加入, 手続き' })],
      '13112',
      DTSTAMP,
    );
    expect(ics).toContain('SUMMARY:国保\\; 加入\\, 手続き');
  });

  it('UID は dtstamp に依存せず安定する(再生成で同一)', () => {
    const task = makeTask({
      procedureId: 'procedure_resident_registration',
      dueDate: '2026-08-29',
    });
    const uidOf = (ics: string) => ics.split('\r\n').find((l) => l.startsWith('UID:'));
    const a = buildChecklistIcs([task], '13112', { dtstamp: new Date('2026-07-23T00:00:00Z') });
    const b = buildChecklistIcs([task], '13112', { dtstamp: new Date('2027-01-01T12:34:56Z') });
    expect(uidOf(a)).toBe('UID:13112-procedure_resident_registration@tokyo-move-navi');
    expect(uidOf(a)).toBe(uidOf(b));
  });

  it('CRLF 行末で VCALENDAR を開閉する', () => {
    const ics = buildChecklistIcs([], '13112', DTSTAMP);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('datedTasks', () => {
  it('dueDate を持つタスクのみ返す', () => {
    const list = [makeTask({ dueDate: '2026-08-29' }), makeTask({ dueDate: undefined })];
    expect(datedTasks(list)).toHaveLength(1);
  });
});
