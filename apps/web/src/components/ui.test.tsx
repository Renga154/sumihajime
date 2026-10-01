import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '../api/client';
import { ErrorMessage, ExternalLink, safeHttpsHref } from './ui';

/**
 * なぜ(2026-10-02 監査): ExternalLink と ErrorMessage の公式サイト導線は、データや API 応答の
 * URL をそのまま href に入れていた。台帳・応答の検証(httpsUrlSchema)を通った値が来る前提だが、
 * その前提が崩れた(スキーマ変更・別経路の値)とき `javascript:` が href になればクリックで
 * スクリプトが動く。表示側でも https の URL 以外はリンクにしない(多層防御)。
 */
describe('safeHttpsHref', () => {
  it('https の URL だけを返す', () => {
    expect(safeHttpsHref('https://www.city.setagaya.lg.jp/x.html')).toBe(
      'https://www.city.setagaya.lg.jp/x.html',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://www.city.setagaya.lg.jp/',
    '//evil.example/',
    '/relative/path',
    'not a url',
    '',
  ])('%s はリンクにしない', (url) => {
    expect(safeHttpsHref(url)).toBeNull();
  });
});

describe('ExternalLink', () => {
  it('(正常系)https はリンクとして別タブ・rel 付きで描画する', () => {
    render(<ExternalLink href="https://www.city.setagaya.lg.jp/">公式ページを開く</ExternalLink>);
    const link = screen.getByRole('link', { name: /公式ページを開く/ });
    expect(link).toHaveAttribute('href', 'https://www.city.setagaya.lg.jp/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('javascript: / http: はリンクにせず文字として描画する', () => {
    const { container } = render(
      <>
        <ExternalLink href="javascript:alert(1)">公式ページA</ExternalLink>
        <ExternalLink href="http://www.city.setagaya.lg.jp/">公式ページB</ExternalLink>
      </>,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('公式ページA')).toBeInTheDocument();
    expect(screen.getByText('公式ページB')).toBeInTheDocument();
  });

  it('データ中の HTML らしい文字列はタグとして解釈せず、そのまま文字で出す', () => {
    const { container } = render(
      <>
        <ExternalLink href="https://www.city.setagaya.lg.jp/">
          {'<strong>XSS</strong>'}
        </ExternalLink>
        <ExternalLink href="javascript:alert(1)">{'1 < 2 && 3 > 2'}</ExternalLink>
      </>,
    );
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.getByText('<strong>XSS</strong>')).toBeInTheDocument();
    expect(screen.getByText('1 < 2 && 3 > 2')).toBeInTheDocument();
  });
});

describe('ErrorMessage の公式サイト導線', () => {
  it('(正常系)https の officialUrl はリンクにする', () => {
    render(
      <ErrorMessage
        error={
          new ApiError(
            409,
            'municipality_not_supported',
            '対象外です。',
            'https://www.town.hachijo.tokyo.jp/',
          )
        }
      />,
    );
    expect(screen.getByRole('link', { name: /公式サイトを開く/ })).toHaveAttribute(
      'href',
      'https://www.town.hachijo.tokyo.jp/',
    );
  });

  it('https 以外の officialUrl はリンクを出さない', () => {
    render(
      <ErrorMessage
        error={
          new ApiError(409, 'municipality_not_supported', '対象外です。', 'javascript:alert(1)')
        }
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('対象外です。')).toBeInTheDocument();
  });
});
