import { beforeEach, describe, expect, it } from 'vitest';
import { profileSchema, type ChecklistResponse, type Profile } from '@tmn/schemas';
import {
  cacheAgeInDays,
  clearChecklistCache,
  loadChecklistCache,
  profileDigest,
  saveChecklistCache,
} from './checklist-cache';

/**
 * なぜ: 端末内の控えは「APIへ届かないときの唯一の表示元」であり、同時に
 * 「古い判定を出し続けない」ための門でもある。通す条件と落とす条件を境界で固定する。
 * 保存してよいもの/いけないものの線引き(プロフィール本体を持たない)も検査対象にする。
 */

const CODE = '13112';

function makeProfile(over: Partial<{ hasDog: boolean; moveDate: string }> = {}): Profile {
  return profileSchema.parse({
    destination: { municipalityCode: CODE },
    moveDate: over.moveDate ?? '2026-08-01',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: over.hasDog ?? true,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    },
  });
}

const CHECKLIST: ChecklistResponse = {
  ruleVersion: 'setagaya-2026-07',
  generatedAt: '2026-08-01T00:00:00Z',
  tasks: [
    {
      id: 't-res',
      procedureId: 'procedure_resident_registration',
      title: '転入届',
      category: 'resident_registration',
      priority: 'urgent',
      applicabilityReason: '転入したため',
      dueDate: '2026-08-15',
      requiredDocuments: [],
      channels: ['counter'],
      sources: [
        {
          sourceId: 's-1',
          title: '世田谷区 転入届',
          url: 'https://www.city.setagaya.lg.jp/02233/88.html',
          lastVerifiedAt: '2026-07-21T00:00:00Z',
        },
      ],
      dataStatus: 'verified',
      ruleVersion: 'setagaya-2026-07',
      procedureVersion: 'v1',
    },
  ],
};

beforeEach(() => localStorage.clear());

describe('profileDigest — 照合用の指紋', () => {
  it('同じ内容なら同じ指紋になる', () => {
    expect(profileDigest(makeProfile())).toBe(profileDigest(makeProfile()));
  });

  it('条件が1つでも違えば別の指紋になる', () => {
    expect(profileDigest(makeProfile({ hasDog: true }))).not.toBe(
      profileDigest(makeProfile({ hasDog: false })),
    );
    expect(profileDigest(makeProfile({ moveDate: '2026-08-01' }))).not.toBe(
      profileDigest(makeProfile({ moveDate: '2026-08-02' })),
    );
  });

  it('キーの並び順が違っても同じ指紋になる(並びで控えを無効にしない)', () => {
    const a = makeProfile();
    // 同じ値・違う列挙順のオブジェクトを作る。
    const reordered = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as Profile;
    expect(profileDigest(shuffled)).toBe(profileDigest(a));
  });

  it('指紋からプロフィールの中身が読み取れない(条件を複製しない)', () => {
    const digest = profileDigest(makeProfile());
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    for (const leak of ['2026-08-01', 'outside_tokyo', 'hasDog', 'adult']) {
      expect(digest).not.toContain(leak);
    }
  });
});

describe('保存する内容', () => {
  it('タスク・自治体名・取得時刻を持ち、プロフィール本体は持たない(§13 データ最小化)', () => {
    saveChecklistCache({
      municipalityCode: CODE,
      municipalityName: '世田谷区',
      profile: makeProfile(),
      checklist: CHECKLIST,
      now: new Date('2026-08-05T09:00:00Z'),
    });

    const raw = localStorage.getItem(`tmn:checklist-cache:${CODE}`) ?? '';
    const entry = JSON.parse(raw) as Record<string, unknown>;

    expect(entry['municipalityName']).toBe('世田谷区');
    expect(entry['cachedAt']).toBe('2026-08-05T09:00:00.000Z');
    expect(JSON.stringify(entry['checklist'])).toContain('転入届');
    // 公式URLと最終確認日が控えにも残る(窓口の前で根拠を辿れる。原則2)。
    expect(raw).toContain('https://www.city.setagaya.lg.jp/02233/88.html');
    expect(raw).toContain('2026-07-21T00:00:00Z');

    // プロフィール本体は入っていない(指紋だけ)。
    expect(entry['profile']).toBeUndefined();
    expect(entry['profileDigest']).toBe(profileDigest(makeProfile()));
    expect(raw).not.toContain('outside_tokyo');
    expect(raw).not.toContain('ageBands');
  });

  it('チャットの質問文・回答は控えの対象にしない(保存しないという画面上の約束を守る)', () => {
    saveChecklistCache({
      municipalityCode: CODE,
      municipalityName: '世田谷区',
      profile: makeProfile(),
      checklist: CHECKLIST,
    });
    // 控えの形式に会話を入れる場所そのものが無い。
    const entry = JSON.parse(localStorage.getItem(`tmn:checklist-cache:${CODE}`) ?? '{}');
    expect(Object.keys(entry).sort()).toEqual([
      'cachedAt',
      'checklist',
      'formatVersion',
      'municipalityCode',
      'municipalityName',
      'profileDigest',
    ]);
  });

  it('控えは最後に見た1自治体ぶんだけ残す', () => {
    saveChecklistCache({
      municipalityCode: CODE,
      municipalityName: '世田谷区',
      profile: makeProfile(),
      checklist: CHECKLIST,
    });
    saveChecklistCache({
      municipalityCode: '13108',
      municipalityName: '江東区',
      profile: makeProfile(),
      checklist: CHECKLIST,
    });

    expect(localStorage.getItem(`tmn:checklist-cache:${CODE}`)).toBeNull();
    expect(localStorage.getItem('tmn:checklist-cache:13108')).not.toBeNull();
  });
});

describe('控えを使ってよい条件', () => {
  function seed(profile = makeProfile()) {
    saveChecklistCache({
      municipalityCode: CODE,
      municipalityName: '世田谷区',
      profile,
      checklist: CHECKLIST,
      now: new Date('2026-08-05T09:00:00Z'),
    });
  }

  it('同じ条件なら読み出せる', () => {
    seed();
    const cached = loadChecklistCache(CODE, makeProfile());
    expect(cached?.checklist.tasks[0]?.title).toBe('転入届');
    expect(cached?.cachedAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('条件を変えたら使わない(修正前の判定を復活させない)', () => {
    seed(makeProfile({ hasDog: true }));
    expect(loadChecklistCache(CODE, makeProfile({ hasDog: false }))).toBeNull();
    // 使えない控えはその場で消す(古い判定を端末に残さない)。
    expect(localStorage.getItem(`tmn:checklist-cache:${CODE}`)).toBeNull();
  });

  it('保存形式が違えば読まずに捨てる', () => {
    localStorage.setItem(
      `tmn:checklist-cache:${CODE}`,
      JSON.stringify({ formatVersion: 999, municipalityCode: CODE }),
    );
    expect(loadChecklistCache(CODE, makeProfile())).toBeNull();
    expect(localStorage.getItem(`tmn:checklist-cache:${CODE}`)).toBeNull();
  });

  it('中身の自治体コードがキーと食い違えば使わない(原則4の多重防御)', () => {
    seed();
    const raw = JSON.parse(localStorage.getItem(`tmn:checklist-cache:${CODE}`) ?? '{}');
    localStorage.setItem(
      `tmn:checklist-cache:${CODE}`,
      JSON.stringify({ ...raw, municipalityCode: '13108' }),
    );
    expect(loadChecklistCache(CODE, makeProfile())).toBeNull();
  });

  it('壊れたJSONは捨てる(例外を投げない)', () => {
    localStorage.setItem(`tmn:checklist-cache:${CODE}`, '{壊れている');
    expect(loadChecklistCache(CODE, makeProfile())).toBeNull();
  });

  it('スキーマに合わないタスクを含む控えは丸ごと捨てる(想定外の形をUIへ流さない)', () => {
    seed();
    const raw = JSON.parse(localStorage.getItem(`tmn:checklist-cache:${CODE}`) ?? '{}');
    raw.checklist.tasks[0].sources = []; // sources は1件以上が必須(原則2)。
    localStorage.setItem(`tmn:checklist-cache:${CODE}`, JSON.stringify(raw));
    expect(loadChecklistCache(CODE, makeProfile())).toBeNull();
  });

  it('明示的に消せる', () => {
    seed();
    clearChecklistCache(CODE);
    expect(loadChecklistCache(CODE, makeProfile())).toBeNull();
  });
});

describe('cacheAgeInDays — 「いつ時点か」を伝えるための経過日数', () => {
  it('経過日数を切り捨てで返す', () => {
    expect(cacheAgeInDays('2026-08-05T09:00:00Z', new Date('2026-08-05T21:00:00Z'))).toBe(0);
    expect(cacheAgeInDays('2026-08-05T09:00:00Z', new Date('2026-08-06T10:00:00Z'))).toBe(1);
    expect(cacheAgeInDays('2026-08-05T09:00:00Z', new Date('2026-09-04T09:00:00Z'))).toBe(30);
  });

  it('端末時計が過去にずれていても負の日数を出さない', () => {
    expect(cacheAgeInDays('2026-08-05T09:00:00Z', new Date('2026-08-01T09:00:00Z'))).toBe(0);
  });

  it('不正な値でも落ちない', () => {
    expect(cacheAgeInDays('not-a-date')).toBe(0);
  });
});
