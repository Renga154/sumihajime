import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Facility } from '@tmn/schemas';
import { FacilityMap, applyMarkerAccessibility } from './FacilityMap';

/**
 * なぜ(独立点検 P1-6): 施設地図のマーカーは maplibre 既定で tabindex=0 / aria-label="Map marker"
 * になる。施設が46件ある区では同一・英語のタブストップが46個ページ先頭付近に並び、窓口一覧へ
 * 到達するまでにTabを57回押す必要があった。axeはこれを検出しない(個々の要素は違反ではない)ため、
 * 「マーカーはタブ順に入らない」「ラベルは日本語の施設名」「地図を飛ばす導線がある」の3点を
 * ここで機械的に固定する。
 *
 * 注: jsdom には WebGL が無いため maplibre の初期化は必ず失敗する。地図そのものの描画ではなく、
 * DOM契約(スキップリンク・代替手段の説明・マーカー属性の純関数)だけを検証する。
 */

function facility(overrides: Partial<Facility> = {}): Facility {
  return {
    facilityId: 'fac-1',
    municipalityCode: '13112',
    name: '世田谷区役所 区民課',
    category: '区役所・出張所',
    address: '東京都世田谷区世田谷4-21-27',
    lat: 35.646,
    lng: 139.653,
    ...overrides,
  } as Facility;
}

describe('applyMarkerAccessibility', () => {
  it('マーカーをタブ順から外す(tabindex=-1)', () => {
    const el = document.createElement('div');
    applyMarkerAccessibility(el, '世田谷区役所');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.tabIndex).toBe(-1);
  });

  it('英語の既定ラベルではなく日本語の施設名でラベル付けする', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Map marker');
    applyMarkerAccessibility(el, '梅丘まちづくりセンター');
    expect(el.getAttribute('aria-label')).toBe('梅丘まちづくりセンターの地図上の位置');
  });

  it('tabindex を先に立てるため、maplibre の setPopup が 0 を上書きしない前提を満たす', () => {
    // maplibre は tabindex 未設定のマーカーにだけ 0 を付ける。属性が既にあることが条件。
    const el = document.createElement('div');
    applyMarkerAccessibility(el, 'テスト窓口');
    expect(el.hasAttribute('tabindex')).toBe(true);
  });
});

describe('FacilityMap', () => {
  it('地図を飛ばして一覧へ移動するリンクを、地図領域より前に置く', () => {
    const { container } = render(
      <FacilityMap facilities={[facility()]} skipTargetId="facility-list" />,
    );
    const link = screen.getByRole('link', { name: '地図を飛ばして窓口の一覧へ' });
    expect(link).toHaveAttribute('href', '#facility-list');

    // DOM順で地図領域より前にあること(タブ順で地図の前に来る)。
    const region = container.querySelector('section[aria-label]');
    expect(region).not.toBeNull();
    expect(link.compareDocumentPosition(region!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('飛び先が指定されていなければリンクを出さない', () => {
    render(<FacilityMap facilities={[facility()]} />);
    expect(screen.queryByRole('link', { name: '地図を飛ばして窓口の一覧へ' })).toBeNull();
  });

  it('一覧が地図の完全な代替であることを読み上げ利用者へ説明する', () => {
    const { container } = render(<FacilityMap facilities={[facility()]} />);
    const note = container.querySelector('.sr-only');
    expect(note?.textContent).toContain('この下の窓口一覧');
    expect(note?.textContent).toContain('マウス操作専用');
  });

  it('座標を持つ施設が無ければ地図領域自体を描画しない', () => {
    const { container } = render(
      <FacilityMap
        facilities={[facility({ lat: undefined, lng: undefined })]}
        skipTargetId="facility-list"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
