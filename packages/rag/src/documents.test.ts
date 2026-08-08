import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DOCUMENT_PROCEDURES,
  hasDocumentIntent,
  isoDatePart,
  mentionsOtherMunicipality,
  renderVerifiedDocumentAnswer,
  renderVerifiedDocumentAnswers,
  selectDocumentProcedures,
  type DocumentProcedureLike,
  type UnresolvedTopic,
  type VerifiedProcedureFacts,
} from './documents.js';
import { orderedQuestionCategories } from './intent.js';

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
    // 2026-08-09 本番実測で漏れていた言い回し。目的語が「書類」だと以前は検出できず、
    // 必要書類を落としうるRAG経路へ流れていた。動詞側で拾うようにして塞いだ。
    '転入届のときに持っていく書類を教えてください',
    '世田谷区への転入届のときに持っていく書類を教えてください。',
    '転入届に持って行く書類は何ですか',
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

/**
 * なぜ: 本番実測(2026-08-08 / 世田谷区)で「犬の登録に必要な持ち物と、粗大ごみの出し方を教えて
 * ください」に対し、犬の登録だけを答え**粗大ごみには一言も触れずに**200を返していた。
 * 落選したcategoryが値として残らず捨てられていたため、利用者は片方が無視されたことに気づけない。
 * 「答えられないなら答えられないと言う」(CLAUDE.md 原則3)を、選択の戻り値と本文の両方で固定する。
 */
describe('selectDocumentProcedures', () => {
  const proc = (
    canonicalType: string,
    opts: { docs?: number; dataStatus?: string; sourceIds?: string[]; id?: string } = {},
  ): DocumentProcedureLike & { id: string } => ({
    id: opts.id ?? `procedure_${canonicalType}`,
    canonicalType,
    dataStatus: opts.dataStatus ?? 'verified',
    requiredDocuments: Array.from({ length: opts.docs ?? 1 }, (_, i) => ({ label: `d${i}` })),
    sourceIds: opts.sourceIds ?? [`src-13112-${canonicalType}-001`],
  });

  it('該当レコードが1件のcategoryを言及順に採用する', () => {
    const { selected, unresolved } = selectDocumentProcedures(
      ['resident_registration', 'my_number'],
      [proc('my_number'), proc('resident_registration')],
    );
    expect(selected.map((p) => p.id)).toEqual([
      'procedure_resident_registration',
      'procedure_my_number',
    ]);
    expect(unresolved).toEqual([]);
  });

  it('書類一覧を持つ検証済みレコードが無いcategoryは no_verified_record として残る(黙って消えない)', () => {
    // 本番の再現: 世田谷のごみ収集日レコードは検証済みだが requiredDocuments が空。
    const { selected, unresolved } = selectDocumentProcedures(
      ['dog_registration', 'waste_schedule'],
      [
        proc('dog_registration', { docs: 2 }),
        proc('waste_schedule', { docs: 0, sourceIds: ['src-13112-waste_schedule-001'] }),
      ],
    );
    expect(selected.map((p) => p.id)).toEqual(['procedure_dog_registration']);
    expect(unresolved).toEqual([
      {
        category: 'waste_schedule',
        reason: 'no_verified_record',
        sourceIds: ['src-13112-waste_schedule-001'],
      },
    ]);
  });

  it('候補が2件以上のcategoryは断定せず ambiguous_records として残る', () => {
    const { selected, unresolved } = selectDocumentProcedures(
      ['child_medical'],
      [
        proc('child_medical', { id: 'a', sourceIds: ['src-13112-child_medical-001'] }),
        proc('child_medical', { id: 'b', sourceIds: ['src-13112-child_medical-002'] }),
      ],
    );
    expect(selected).toEqual([]);
    expect(unresolved).toEqual([
      {
        category: 'child_medical',
        reason: 'ambiguous_records',
        sourceIds: ['src-13112-child_medical-001', 'src-13112-child_medical-002'],
      },
    ]);
  });

  it('検証済みでないレコードは採用しない(dataStatusでの絞り込みが効く)', () => {
    const { selected, unresolved } = selectDocumentProcedures(
      ['national_pension'],
      [proc('national_pension', { dataStatus: 'partial' })],
    );
    expect(selected).toEqual([]);
    expect(unresolved[0]!.reason).toBe('no_verified_record');
    // 検証済みでないレコードの出典は導線に使わない(未承認データへ誘導しない)。
    expect(unresolved[0]!.sourceIds).toEqual([]);
  });

  it('上限に達した以降のcategoryは limit_reached として残る(break で捨てない)', () => {
    const { selected, unresolved } = selectDocumentProcedures(
      ['resident_registration', 'my_number', 'national_health_insurance'],
      [proc('resident_registration'), proc('my_number'), proc('national_health_insurance')],
      2,
    );
    expect(selected).toHaveLength(2);
    expect(unresolved).toEqual([
      {
        category: 'national_health_insurance',
        reason: 'limit_reached',
        sourceIds: ['src-13112-national_health_insurance-001'],
      },
    ]);
  });

  it('既定の上限は2件', () => {
    expect(DEFAULT_MAX_DOCUMENT_PROCEDURES).toBe(2);
  });

  it('categories が空なら何も選ばず、落選も作らない(構造化経路を使わない判断は呼び出し側)', () => {
    expect(selectDocumentProcedures([], [proc('resident_registration')])).toEqual({
      selected: [],
      unresolved: [],
    });
  });

  it('入力を破壊しない', () => {
    const procedures = [proc('resident_registration'), proc('waste_schedule', { docs: 0 })];
    const copy = JSON.parse(JSON.stringify(procedures));
    selectDocumentProcedures(['resident_registration', 'waste_schedule'], procedures);
    expect(JSON.parse(JSON.stringify(procedures))).toEqual(copy);
  });
});

describe('落選した話題の明示(renderVerifiedDocumentAnswers の unresolved)', () => {
  const dog: VerifiedProcedureFacts = {
    title: '飼い犬の登録事項変更届(他区市町村から世田谷区への転入)',
    requiredDocuments: [{ label: '前住所地の鑑札', status: 'required' }],
    lastVerifiedAt: '2026-08-08T00:00:00Z',
  };

  const wasteDropped: UnresolvedTopic = {
    category: 'waste_schedule',
    reason: 'no_verified_record',
    sourceIds: ['src-13112-waste_schedule-001'],
    officialUrl: 'https://www.city.setagaya.lg.jp/02182/1234.html',
  };

  it('落選した話題を利用者向けの名前で名指しし、次の行動を示す', () => {
    const answer = renderVerifiedDocumentAnswers('世田谷区', [dog], [wasteDropped]);
    expect(answer).toContain('■ この回答でご案内できなかったこと');
    expect(answer).toContain('ごみ・資源の出し方と収集日');
    expect(answer).toContain('この回答ではご案内できませんでした');
    // 次の行動(公式ページで確認)と、その導線となるURLが本文に出る。
    expect(answer).toContain('https://www.city.setagaya.lg.jp/02182/1234.html');
    expect(answer).toContain('でご確認ください');
  });

  it('落選が無ければ注記を出さない(要らない不安を与えない)', () => {
    const answer = renderVerifiedDocumentAnswers('世田谷区', [dog]);
    expect(answer).not.toContain('■ この回答でご案内できなかったこと');
  });

  it('注記は回答できた内容の後・共通注記(最終確認日)の前に置く', () => {
    const answer = renderVerifiedDocumentAnswers('世田谷区', [dog], [wasteDropped]);
    const body = answer.indexOf('・前住所地の鑑札');
    const notice = answer.indexOf('■ この回答でご案内できなかったこと');
    const footer = answer.indexOf('最終確認日');
    expect(notice).toBeGreaterThan(body);
    expect(footer).toBeGreaterThan(notice);
  });

  it('公式URLが解決できなければ自治体公式サイトへの一般的な誘導へ退避する(URLを捏造しない)', () => {
    const answer = renderVerifiedDocumentAnswers(
      '世田谷区',
      [dog],
      [{ category: 'waste_schedule', reason: 'no_verified_record', sourceIds: [] }],
    );
    expect(answer).toContain('世田谷区の公式サイトでご確認ください');
    expect(answer).not.toContain('http');
  });

  it('上限到達は「確認できなかった」と書かない(確認できているものを否定しない)', () => {
    // なぜ: limit_reached では該当レコードが存在する。ここで「確認できませんでした」と述べるのは
    // 事実に反する断定。分けて尋ねれば答えが得られることを案内する。
    const answer = renderVerifiedDocumentAnswers(
      '世田谷区',
      [dog],
      [
        {
          category: 'national_health_insurance',
          reason: 'limit_reached',
          sourceIds: ['src-13112-national_health_insurance-001'],
        },
      ],
    );
    expect(answer).toContain('国民健康保険');
    expect(answer).not.toContain('ご案内できませんでした');
    expect(answer).toContain('分けてお尋ね');
  });

  it('落選が複数あれば全件を並べる(1件だけ示して残りを消さない)', () => {
    const answer = renderVerifiedDocumentAnswers(
      '世田谷区',
      [dog],
      [
        wasteDropped,
        { category: 'childcare', reason: 'ambiguous_records', sourceIds: [] },
        { category: 'national_pension', reason: 'limit_reached', sourceIds: [] },
      ],
    );
    expect(answer).toContain('ごみ・資源の出し方と収集日');
    expect(answer).toContain('保育園等の入園申込');
    expect(answer).toContain('国民年金');
  });

  it('注記に内部用語(経路名・変数名・enum名・ADR/案の呼称)を出さない', () => {
    const answer = renderVerifiedDocumentAnswers(
      '世田谷区',
      [dog],
      [
        wasteDropped,
        { category: 'childcare', reason: 'ambiguous_records', sourceIds: [] },
        { category: 'national_pension', reason: 'limit_reached', sourceIds: [] },
      ],
    );
    const notice = answer.slice(answer.indexOf('■ この回答でご案内できなかったこと'));
    for (const forbidden of [
      'waste_schedule',
      'childcare',
      'national_pension',
      'no_verified_record',
      'ambiguous_records',
      'limit_reached',
      'canonicalType',
      'dataStatus',
      'requiredDocuments',
      'MAX_DOCUMENT_PROCEDURES',
      '経路',
      '案A',
      '案C',
      'ADR-',
      'RAG',
      'LLM',
    ]) {
      expect(notice, `注記に内部用語「${forbidden}」が混入`).not.toContain(forbidden);
    }
    // URL以外にASCII識別子らしい断片が無いこと(URL行を除いて英数字ゼロ)。
    const withoutUrls = notice.replace(/https?:\/\/\S+/g, '');
    expect(withoutUrls).not.toMatch(/[A-Za-z_]{3,}/u);
  });

  it('注記は保留判定と衝突しない(本文の先頭が保留語にならない)', () => {
    const answer = renderVerifiedDocumentAnswers('世田谷区', [dog], [wasteDropped]);
    expect(answer.startsWith('確認でき')).toBe(false);
    expect(answer.startsWith('世田谷区の')).toBe(true);
  });

  it('回答できた手続きが0件なら本文は空(注記だけの回答を作らない)', () => {
    // なぜ: 全話題が落選したときは構造化経路を使わず従来のRAG経路(保留を含む)へ委ねる。
    // 注記だけを回答として返すと、保留すべき質問に「回答」の形を与えてしまう。
    expect(renderVerifiedDocumentAnswers('世田谷区', [], [wasteDropped])).toBe('');
  });

  it('本番の再現ケース: 犬の登録+粗大ごみ で粗大ごみ側が本文に必ず現れる', () => {
    const question = '犬の登録に必要な持ち物と、粗大ごみの出し方を教えてください';
    expect(hasDocumentIntent(question)).toBe(true);
    const categories = orderedQuestionCategories(question);
    expect(categories).toEqual(['dog_registration', 'waste_schedule']);

    const { selected, unresolved } = selectDocumentProcedures(categories, [
      {
        canonicalType: 'dog_registration',
        dataStatus: 'verified',
        requiredDocuments: [{ label: '前住所地の鑑札' }],
        sourceIds: ['src-13112-dog_registration-001'],
      },
      {
        canonicalType: 'waste_schedule',
        dataStatus: 'verified',
        requiredDocuments: [],
        sourceIds: ['src-13112-waste_schedule-001'],
      },
    ]);
    expect(selected).toHaveLength(1);
    expect(unresolved.map((u) => u.category)).toEqual(['waste_schedule']);

    const answer = renderVerifiedDocumentAnswers('世田谷区', [dog], unresolved);
    // 修正前はこの行が存在せず、粗大ごみについて一言も無かった(=無言の欠落)。
    expect(answer).toContain('ごみ・資源の出し方と収集日');
  });
});
