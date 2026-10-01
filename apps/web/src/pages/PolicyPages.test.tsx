import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppStateProvider } from '../state/AppState';
import { PrivacyPage, TermsPage } from './PolicyPages';

/**
 * なぜ: 利用規約・プライバシーポリシー(A-1-3)は「実装の事実」を書いた文書であり、
 * 内容が実装からずれると利用者への説明が嘘になる。ここでは文章そのものではなく、
 * 実装と結びついた約束(集めない項目・保存場所・外部送信先・広告の現状)が
 * 画面に出ていることを固定する。
 */

function renderPage(node: React.ReactElement) {
  return render(
    <AppStateProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </AppStateProvider>,
  );
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

  /**
   * なぜ(2026-10-02 監査): 3節は「回答の生成のため」とだけ書き、検索のための送信(埋め込み)と
   * 送信先の国が抜けていた。またモデル名(gpt-4o-mini)を固定で書いており、設定を変えると
   * 黙って事実と食い違う。送信の目的2つ・送信先の国・保存しないことを正確に書く。
   */
  it('AIチャットの質問文は検索と回答作成の両方のため OpenAI 社(米国)へ送ると明記し、モデル名を固定で書かない', () => {
    renderPage(<PrivacyPage />);
    const server = screen.getByText(/AIチャットをお使いの場合/);
    expect(server).toHaveTextContent('OpenAI 社（米国）');
    expect(server).toHaveTextContent('検索');
    expect(server).toHaveTextContent('回答文の作成');
    expect(server).toHaveTextContent('保存もログ記録もしません');
    expect(screen.queryByText(/gpt-4o-mini/)).toBeNull();
    expect(screen.getByText(/AIチャットの質問文 —/)).toHaveTextContent('米国');
  });

  /**
   * なぜ: 「サイトデータを削除」しか案内していなかったが、ボタン1つでこのアプリの
   * 保存内容だけを消せるようになった(§2消去操作)。文面とボタンの両方が実装と一致することを
   * 固定する。改定にあわせて最終改定日も進んでいること(規約の日付は変えない)も固定する。
   */
  it('端末内保存の節に「この端末に保存した入力を消去」ボタンがあり、案内文もそれに触れる', () => {
    renderPage(<PrivacyPage />);
    expect(
      screen.getByRole('button', { name: 'この端末に保存した入力を消去' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/この端末に保存した\s*入力を消去」からも/)).toBeInTheDocument();
  });

  it('プライバシーポリシーの最終改定日だけが進み、利用規約の日付は変わらない', () => {
    const { unmount } = renderPage(<PrivacyPage />);
    expect(screen.getByText('最終改定日: 2026年10月2日')).toBeInTheDocument();
    unmount();

    renderPage(<TermsPage />);
    expect(screen.getByText('最終改定日: 2026年9月24日')).toBeInTheDocument();
  });
});

describe('問い合わせ窓口', () => {
  it('公開済みの窓口が規約・ポリシーの両方に出る', () => {
    for (const page of [<TermsPage key="t" />, <PrivacyPage key="p" />]) {
      const { unmount } = renderPage(page);
      const link = screen.getByRole('link', { name: /お問い合わせフォームを開く/ });
      expect(link.getAttribute('href')).toMatch(/^https:\/\/docs\.google\.com\/forms\/d\/e\//);
      unmount();
    }
  });

  it('窓口URLが未設定なら節ごと出さない(「準備中」の窓口を公開しない)', async () => {
    vi.resetModules();
    vi.doMock('../content/contact', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../content/contact')>()),
      FEEDBACK_FORM_URL: undefined,
    }));
    const mod = await import('./PolicyPages');
    renderPage(<mod.TermsPage />);
    expect(screen.queryByText(/お問い合わせフォームを開く/)).not.toBeInTheDocument();
    vi.doUnmock('../content/contact');
  });

  it('ポリシーはフォームで送られる内容の扱いと、事前入力する項目を明示する', () => {
    renderPage(<PrivacyPage />);
    expect(screen.getByText(/メールアドレスを収集せず/)).toBeInTheDocument();
    expect(screen.getByText(/引越し日や世帯などの入力条件は/)).toBeInTheDocument();
  });
});
