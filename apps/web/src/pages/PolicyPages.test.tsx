import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPage, TermsPage } from './PolicyPages';

/**
 * なぜ: 利用規約・プライバシーポリシー(A-1-3)は「実装の事実」を書いた文書であり、
 * 内容が実装からずれると利用者への説明が嘘になる。ここでは文章そのものではなく、
 * 実装と結びついた約束(集めない項目・保存場所・外部送信先・広告の現状)が
 * 画面に出ていることを固定する。
 */

function renderPage(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('利用規約', () => {
  it('非公式であること・免責・コードとデータでライセンスが分かれることを明示する', () => {
    renderPage(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1, name: '利用規約' })).toBeInTheDocument();
    expect(screen.getByText(/非公式/)).toBeInTheDocument();
    expect(screen.getByText(/MIT ライセンス/)).toBeInTheDocument();
    expect(screen.getByText(/出典元の規約に従います/)).toBeInTheDocument();
    // 広告は「現時点では表示していない」と書く(将来の予定を現在形で書かない)。
    expect(screen.getByText(/現時点では広告を表示していません/)).toBeInTheDocument();
  });
});

describe('プライバシーポリシー', () => {
  it('集めない項目・端末内保存・ログ許可リスト・Cookie不使用を明示する', () => {
    renderPage(<PrivacyPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'プライバシーポリシー' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/氏名・電話番号・メールアドレス・完全な生年月日・マイナンバー/),
    ).toBeInTheDocument();
    expect(screen.getByText(/localStorage/)).toBeInTheDocument();
    expect(screen.getByText(/Cookie を使用していません/)).toBeInTheDocument();
  });

  it('外部へ出る通信(AIモデル・地理院タイル)を具体的に挙げる', () => {
    renderPage(<PrivacyPage />);
    // 3節(サーバーでの処理)と7節(外部送信先)の両方に出る。どちらも必要なので件数で固定する。
    expect(screen.getAllByText(/OpenAI/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('https://cyberjapandata.gsi.go.jp')).toBeInTheDocument();
  });
});

describe('問い合わせ窓口', () => {
  it('窓口URLが未設定のあいだは節ごと出さない(「準備中」の窓口を公開しない)', () => {
    renderPage(<TermsPage />);
    expect(screen.queryByText(/お問い合わせフォームを開く/)).not.toBeInTheDocument();
  });

  it('窓口URLを設定すると両方のページに出る', async () => {
    vi.resetModules();
    vi.doMock('../content/contact', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../content/contact')>()),
      FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/TEST/viewform',
    }));
    const mod = await import('./PolicyPages');
    renderPage(<mod.PrivacyPage />);
    const link = screen.getByRole('link', { name: /お問い合わせフォームを開く/ });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/forms/d/e/TEST/viewform');
    vi.doUnmock('../content/contact');
  });
});
