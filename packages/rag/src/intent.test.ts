import { describe, it, expect } from 'vitest';
import {
  orderedQuestionCategories,
  questionCategories,
  rerankByProcedureIntent,
} from './intent.js';

/**
 * なぜ: 決定論的リランクの意図判定と昇格が「一般規則」として正しいことを固定する。
 * とくに回帰の中心である「転入届の一般質問で学校/保育チャンクを主根拠にしない」を検証する。
 */

describe('questionCategories', () => {
  it('転入届の質問は resident_registration のみを主題とする(転入学=schoolに巻き込まれない)', () => {
    const cats = questionCategories('世田谷区に引っ越したら、転入届はいつまでに出せばいいですか？');
    expect(cats.has('resident_registration')).toBe(true);
    expect(cats.has('school_transfer')).toBe(false);
    expect(cats.has('childcare')).toBe(false);
  });

  it('学校の転入学の質問は school_transfer で、resident_registration を主題にしない', () => {
    const cats = questionCategories(
      '江東区へ小・中学校の転入学をするとき、前の学校から受け取る書類は何ですか？',
    );
    expect(cats.has('school_transfer')).toBe(true);
    expect(cats.has('resident_registration')).toBe(false);
  });

  it('主要カテゴリを各代表語で判定できる', () => {
    expect(
      questionCategories('国民健康保険の届出はいつまで').has('national_health_insurance'),
    ).toBe(true);
    expect(questionCategories('マイナンバーカードの継続利用').has('my_number')).toBe(true);
    expect(questionCategories('児童手当の15日特例').has('child_benefits')).toBe(true);
    expect(questionCategories('子ども医療費助成は何歳まで').has('child_medical')).toBe(true);
    expect(questionCategories('飼い犬の鑑札はどうなりますか').has('dog_registration')).toBe(true);
    expect(questionCategories('保育園の申込みについて').has('childcare')).toBe(true);
    expect(questionCategories('粗大ごみの収集日').has('waste_schedule')).toBe(true);
  });

  it('辞書に無い主題(住民税額など)は空集合', () => {
    expect(questionCategories('住民税は年間いくらですか').size).toBe(0);
  });
});

describe('rerankByProcedureIntent', () => {
  const mk = (id: string, category: string) => ({ id, category });

  it('転入届の質問で、下位に沈んだ resident_registration を先頭へ昇格(学校/保育を後段へ)', () => {
    // 検索スコア順: 学校・保育が上位を占有し、resident_registration が末尾(回帰の再現)。
    const retrieved = [
      mk('childcare-1', 'childcare'),
      mk('school-1', 'school_transfer'),
      mk('school-2', 'school_transfer'),
      mk('childcare-2', 'childcare'),
      mk('mynumber-1', 'my_number'),
      mk('resident-1', 'resident_registration'),
    ];
    const out = rerankByProcedureIntent('転入届はいつまでに出せばいいですか？', retrieved);
    expect(out[0]!.id).toBe('resident-1');
    // 昇格は安定: 非一致は元の相対順序を保つ。
    expect(out.map((c) => c.id)).toEqual([
      'resident-1',
      'childcare-1',
      'school-1',
      'school-2',
      'childcare-2',
      'mynumber-1',
    ]);
  });

  it('一致カテゴリが複数チャンクあるとき、それらの相対順序(スコア順)を保って先頭へ', () => {
    const retrieved = [
      mk('school-1', 'school_transfer'),
      mk('resident-hi', 'resident_registration'),
      mk('childcare-1', 'childcare'),
      mk('resident-lo', 'resident_registration'),
    ];
    const out = rerankByProcedureIntent('転入届に必要な書類は？', retrieved);
    expect(out.map((c) => c.id)).toEqual(['resident-hi', 'resident-lo', 'school-1', 'childcare-1']);
  });

  it('主題カテゴリが無ければ検索順のまま(no-op)', () => {
    const retrieved = [mk('a', 'child_medical'), mk('b', 'waste_schedule')];
    const out = rerankByProcedureIntent('住民税は年間いくらですか', retrieved);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('入力を破壊しない(新配列を返す)', () => {
    const retrieved = [mk('x', 'childcare'), mk('y', 'resident_registration')];
    const copy = [...retrieved];
    rerankByProcedureIntent('転入届', retrieved);
    expect(retrieved).toEqual(copy);
  });
  it('maxPromoted を超える一致チャンクは昇格させず、検索スコア上位の枠を残す', () => {
    // なぜ: 1カテゴリのチャンク数が生成窓以上ある区で、昇格だけで窓が埋まり検索最上位が
    // 1件も渡らない回帰(本番実測: 練馬区。答えは別カテゴリのページ側にあった)への回帰ガード。
    const retrieved = [
      mk('mynum-1', 'my_number'),
      mk('resident-top', 'resident_registration'),
      mk('mynum-2', 'my_number'),
      mk('mynum-3', 'my_number'),
      mk('mynum-4', 'my_number'),
      mk('mynum-5', 'my_number'),
    ];
    const out = rerankByProcedureIntent('マイナンバーカードの継続利用はいつまで？', retrieved, 2);
    // 昇格は上位2件まで。残りは検索順のまま(resident-top が窓の3番手に残る)。
    expect(out.map((c) => c.id)).toEqual([
      'mynum-1',
      'mynum-2',
      'resident-top',
      'mynum-3',
      'mynum-4',
      'mynum-5',
    ]);
  });

  it('maxPromoted 未指定なら従来どおり一致カテゴリを全件昇格させる', () => {
    const retrieved = [mk('a', 'childcare'), mk('b', 'my_number'), mk('c', 'my_number')];
    expect(
      rerankByProcedureIntent('マイナンバーカードの継続利用', retrieved).map((c) => c.id),
    ).toEqual(['b', 'c', 'a']);
  });
});

/**
 * なぜ: 1文で複数の手続きを尋ねる質問(本番実測「転入届に必要な持ち物は？マイナンバーカードは
 * 必要ですか？」)で、以前は構造化データ経路を諦めてRAGへ戻り、必須の本人確認書類を落としていた。
 * 「主題は先に述べられる」という一般規則を、文字位置ベースの決定論的な並べ替えとして固定する。
 */
describe('orderedQuestionCategories', () => {
  it('一致カテゴリを質問文の言及順に返す', () => {
    expect(
      orderedQuestionCategories('転入届に必要な持ち物は？マイナンバーカードは必要ですか？'),
    ).toEqual(['resident_registration', 'my_number']);
  });

  it('言及順が逆なら結果も逆になる(文字位置だけで決まる)', () => {
    expect(
      orderedQuestionCategories('マイナンバーカードの継続利用と転入届の持ち物を教えて'),
    ).toEqual(['my_number', 'resident_registration']);
  });

  it('1つだけ一致すればその1件', () => {
    expect(orderedQuestionCategories('転入届に必要な持ち物は？')).toEqual([
      'resident_registration',
    ]);
  });

  it('一致が無ければ空配列(手続きを推測しない)', () => {
    expect(orderedQuestionCategories('引っ越しの手続きに必要な持ち物は？')).toEqual([]);
  });

  it('questionCategories と同じ集合を返す(順序の有無だけが違う)', () => {
    const q = '転入届と国民健康保険の持ち物は？';
    expect(new Set(orderedQuestionCategories(q))).toEqual(questionCategories(q));
  });
});
