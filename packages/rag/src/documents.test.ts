import { describe, expect, it } from 'vitest';
import {
  hasDocumentIntent,
  isoDatePart,
  mentionsOtherMunicipality,
  renderVerifiedDocumentAnswer,
  renderVerifiedDocumentAnswers,
  type VerifiedProcedureFacts,
} from './documents.js';

/**
 * なぜ: 必要書類の回答は「検証済み構造をそのまま提示する」ことが唯一の正しさの根拠なので、
 * required/conditional の分離・required の欠落なし・conditional の断定なし を純関数レベルで固定する
 * (ADR-010)。ケース非依存の一般規則としてテストし、特定区の文言に依存させない。
 */

describe('hasDocumentIntent', () => {
  it.each([
    '転入届に必要な持ち物は？',
    '転入届の必要書類を教えてください',
    '転入届に必要なものは何ですか',
    '転入届のとき何を持っていけばいいですか',
    '国民健康保険の手続きで何が必要ですか',
    '転入届に必要な書類を教えて',
    '窓口に持参するものはありますか',
  ])('書類・持ち物を尋ねる質問を検出する: %s', (q) => {
    expect(hasDocumentIntent(q)).toBe(true);
  });

  it.each([
    '転入届はいつまでに出せばよいですか？',
    '転入に必要な手続きを教えてください',
    'ペットボトルは何ごみですか',
    '子ども医療費助成の対象年齢は？',
  ])('書類を尋ねていない質問は検出しない: %s', (q) => {
    expect(hasDocumentIntent(q)).toBe(false);
  });
});

describe('mentionsOtherMunicipality', () => {
  const others = ['世田谷区', '江東区', '八王子市'];

  it('選択自治体以外の名前を含めば true(越境の疑い)', () => {
    expect(mentionsOtherMunicipality('世田谷区の転入届の持ち物は？', '新宿区', others)).toBe(true);
  });

  it('選択自治体の名前しか含まなければ false', () => {
    expect(mentionsOtherMunicipality('新宿区の転入届の持ち物は？', '新宿区', others)).toBe(false);
  });

  it('自治体名を含まない質問は false', () => {
    expect(mentionsOtherMunicipality('転入届の持ち物は？', '新宿区', others)).toBe(false);
  });

  it('自分自身の名前は others に含まれていても越境扱いしない', () => {
    expect(mentionsOtherMunicipality('江東区の転入届の持ち物は？', '江東区', others)).toBe(false);
  });
});

describe('isoDatePart', () => {
  it('ISO datetime から日付部分のみを取り出す(年月日の漢字を含めない)', () => {
    expect(isoDatePart('2026-08-07T00:00:00Z')).toBe('2026-08-07');
    expect(isoDatePart('2026-08-07T00:00:00Z')).not.toMatch(/[年月日]/u);
  });
});

const facts: VerifiedProcedureFacts = {
  title: '転入届(区外から本区へ引越した方)',
  requiredDocuments: [
    { label: '転出証明書(前住所地が発行。特例転出をした方は不要)', status: 'conditional' },
    { label: '窓口にお越しになる方の本人確認できるもの', status: 'required' },
    { label: '(お持ちの方)マイナンバーカード', status: 'conditional' },
    { label: '追加書類(要確認)', status: 'unknown' },
  ],
  dueDescription: '住みはじめた日から14日以内です。',
  contact: '区民課戸籍住民係 電話 00-0000-0000',
  lastVerifiedAt: '2026-08-07T00:00:00Z',
};

describe('renderVerifiedDocumentAnswer', () => {
  const answer = renderVerifiedDocumentAnswer('テスト区', facts);

  it('required と conditional を別の見出しの下に分ける', () => {
    expect(answer).toContain('■ 必ず必要なもの');
    expect(answer).toContain('■ 場合により必要なもの（あてはまる方のみ）');
    const reqIdx = answer.indexOf('■ 必ず必要なもの');
    const conIdx = answer.indexOf('■ 場合により必要なもの（あてはまる方のみ）');
    const identity = answer.indexOf('窓口にお越しになる方の本人確認できるもの');
    const mynumber = answer.indexOf('(お持ちの方)マイナンバーカード');
    // 必須項目は必須見出しの直後、条件付き項目は条件見出しの後(=条件付きが必須欄に混ざらない)。
    expect(identity).toBeGreaterThan(reqIdx);
    expect(identity).toBeLessThan(conIdx);
    expect(mynumber).toBeGreaterThan(conIdx);
  });

  it('required の項目を落とさない(公式文言のまま)', () => {
    expect(answer).toContain('・窓口にお越しになる方の本人確認できるもの');
  });

  it('unknown は「確認が必要」として別扱いにする(未知を必須にも条件付きにもしない)', () => {
    const unknownIdx = answer.indexOf('■ 公式ページでの確認が必要なもの');
    expect(unknownIdx).toBeGreaterThan(-1);
    expect(answer.indexOf('追加書類(要確認)')).toBeGreaterThan(unknownIdx);
  });

  it('期限・問い合わせ先・最終確認日を添える', () => {
    expect(answer).toContain('住みはじめた日から14日以内です。');
    expect(answer).toContain('区民課戸籍住民係 電話 00-0000-0000');
    expect(answer).toContain('最終確認日: 2026-08-07');
  });

  it('保留語で始まらない(§11.6 の保留判定と衝突しない)', () => {
    expect(answer.startsWith('確認でき')).toBe(false);
    expect(answer.length).toBeGreaterThan(0);
  });

  it('required が0件なら「必ず必要なもの」見出しを出さない(空の必須を装わない)', () => {
    const onlyConditional = renderVerifiedDocumentAnswer('テスト区', {
      ...facts,
      requiredDocuments: [{ label: '(お持ちの方)マイナンバーカード', status: 'conditional' }],
    });
    expect(onlyConditional).not.toContain('■ 必ず必要なもの');
    expect(onlyConditional).toContain('■ 場合により必要なもの（あてはまる方のみ）');
  });

  it('複数手続きを手続き名つきで並べ、どちらの必須書類も落とさない(1文に複数の手続き)', () => {
    const multi = renderVerifiedDocumentAnswers('テスト区', [
      facts,
      {
        title: 'マイナンバーカードの継続利用',
        requiredDocuments: [
          { label: 'マイナンバーカード(異動者全員分)', status: 'required' },
          { label: '代理人が来る場合は委任状', status: 'conditional' },
        ],
        lastVerifiedAt: '2026-08-01T00:00:00Z',
      },
    ]);
    // 手続き名つきの見出しが2つ並ぶ(どちらの手続きの持ち物かが必ず分かる=誤帰属しない)。
    expect(multi).toContain('「転入届(区外から本区へ引越した方)」に必要なもの');
    expect(multi).toContain('「マイナンバーカードの継続利用」に必要なもの');
    // 双方の required が残る。
    expect(multi).toContain('・窓口にお越しになる方の本人確認できるもの');
    expect(multi).toContain('・マイナンバーカード(異動者全員分)');
    // 共通注記は1回だけ、最終確認日は最も古い方(保守的表示)。
    expect(multi.match(/最終確認日/g)).toHaveLength(1);
    expect(multi).toContain('最終確認日: 2026-08-01');
  });

  it('期限・問い合わせ先が無くても壊れない', () => {
    const minimal = renderVerifiedDocumentAnswer('テスト区', {
      title: '手続き',
      requiredDocuments: [{ label: '本人確認書類', status: 'required' }],
      lastVerifiedAt: '2026-08-07T00:00:00Z',
    });
    expect(minimal).toContain('・本人確認書類');
    expect(minimal).not.toContain('■ 届出の期限');
    expect(minimal).not.toContain('■ お問い合わせ');
  });
});
