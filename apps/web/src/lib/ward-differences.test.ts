import { describe, expect, it } from 'vitest';
import type { WardDifferencesResponse } from '@tmn/schemas';
import {
  cellFor,
  differingTopicCount,
  municipalityNameMap,
  pickContrastMunicipality,
} from './ward-differences';

/**
 * なぜ: 比較ページの初期選択(=最初の1画面で違いが伝わるか)は純関数で決めており、
 * 区が増えても表を書き換えずに追随することを固定する。
 */

function source(id: string) {
  return {
    sourceId: id,
    title: `${id}の出典`,
    url: `https://example.invalid/${id}`,
    lastVerifiedAt: '2026-08-07T00:00:00Z',
  };
}

function cell(code: string, name: string, valueId: string) {
  return {
    municipalityCode: code,
    municipalityName: name,
    valueId,
    valueLabel: valueId,
    tone: 'neutral' as const,
    officialText: `${name}の公式文言`,
    procedureTitle: '手続き',
    sources: [source(`src-${code}-001`)],
  };
}

const report: WardDifferencesResponse = {
  municipalities: [
    { code: '13101', name: 'A区' },
    { code: '13102', name: 'B区' },
    { code: '13103', name: 'C区' },
  ],
  topics: [
    {
      topicId: 't1',
      title: 'T1',
      question: 'Q1',
      procedureId: 'p1',
      derivationNote: 'note',
      valueGroups: [
        { valueId: 'x', label: 'x', tone: 'neutral', municipalityCodes: ['13101', '13102'] },
        { valueId: 'y', label: 'y', tone: 'neutral', municipalityCodes: ['13103'] },
      ],
      cells: [cell('13101', 'A区', 'x'), cell('13102', 'B区', 'x'), cell('13103', 'C区', 'y')],
      omittedMunicipalityCodes: [],
    },
    {
      topicId: 't2',
      title: 'T2',
      question: 'Q2',
      procedureId: 'p2',
      derivationNote: 'note',
      valueGroups: [
        { valueId: 'x', label: 'x', tone: 'neutral', municipalityCodes: ['13101'] },
        { valueId: 'y', label: 'y', tone: 'neutral', municipalityCodes: ['13102', '13103'] },
      ],
      cells: [cell('13101', 'A区', 'x'), cell('13102', 'B区', 'y'), cell('13103', 'C区', 'y')],
      omittedMunicipalityCodes: [],
    },
  ],
};

describe('比較ページの選択ヘルパー', () => {
  it('cellFor は指定トピック・指定自治体のセルだけを返す', () => {
    expect(cellFor(report, 't1', '13103')?.valueId).toBe('y');
    expect(cellFor(report, 't1', '99999')).toBeUndefined();
    expect(cellFor(report, 'unknown-topic', '13101')).toBeUndefined();
  });

  it('differingTopicCount は値が違うトピック数を数える', () => {
    expect(differingTopicCount(report, '13101', '13102')).toBe(1); // t2 のみ違う
    expect(differingTopicCount(report, '13101', '13103')).toBe(2); // 両方違う
    expect(differingTopicCount(report, '13102', '13103')).toBe(1); // t1 のみ違う
  });

  it('pickContrastMunicipality は「いちばん違いが多い区」を選ぶ', () => {
    expect(pickContrastMunicipality(report, '13101')).toBe('13103');
  });

  it('同数のときは自治体コード昇順で決まる(再読み込みでも変わらない)', () => {
    // 13102 から見ると 13101(t2が違う)と 13103(t1が違う)がどちらも1件。
    expect(pickContrastMunicipality(report, '13102')).toBe('13101');
  });

  it('比較相手がいない場合は undefined を返す', () => {
    const only: WardDifferencesResponse = {
      municipalities: [{ code: '13101', name: 'A区' }],
      topics: [],
    };
    expect(pickContrastMunicipality(only, '13101')).toBeUndefined();
  });

  it('自治体名はAPIの一覧から引く(UI側に区名の表を持たない)', () => {
    expect(municipalityNameMap(report).get('13102')).toBe('B区');
  });
});
