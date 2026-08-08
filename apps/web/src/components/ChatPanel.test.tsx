import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * なぜ: FR-016〜019 / §11.5。RAG無効時はパネルを描画しない(既存機能の劣化なし)、
 * 有効時は固定注意文(PII)+スコープ表示・引用付き回答・保留(確認できません)を固定する。
 */

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  ChatDisabledError: class ChatDisabledError extends Error {},
  getChatAvailability: vi.fn(),
  postChat: vi.fn(),
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, coverage: [] },
  ]),
}));

import {
  getChatAvailability as getChatAvailabilityRaw,
  postChat as postChatRaw,
} from '../api/client';
import { ChatPanel } from './ChatPanel';

const getChatAvailability = vi.mocked(getChatAvailabilityRaw);
const postChat = vi.mocked(postChatRaw);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatPanel — RAG無効時', () => {
  it('availability=false なら何も描画しない', async () => {
    getChatAvailability.mockResolvedValue({ enabled: false, mode: 'disabled' });
    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await waitFor(() => expect(getChatAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /AIに質問する/ })).toBeNull();
    expect(postChat).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — RAG有効時', () => {
  it('固定注意文(PII)+スコープを表示し、引用付き回答を描画する', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'full' });
    postChat.mockResolvedValue({
      answer: '転入届は引越し日から14日以内に窓口へ提出してください。',
      citations: [
        {
          sourceId: 'src-13112-resident_registration-001',
          title: '世田谷区 転入届',
          ownerOrganization: '世田谷区',
          url: 'https://www.city.setagaya.lg.jp/02233/88.html',
          lastVerifiedAt: '2026-07-21T00:00:00Z',
        },
      ],
      confidence: 'high',
      abstained: false,
    });

    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    // PII注意文が表示される(FR-019)。
    expect(screen.getByText(/個人情報は入力しないでください/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/質問を入力/), '転入届の持ち物は？');
    await user.click(screen.getByRole('button', { name: '質問する' }));

    expect(await screen.findByText(/14日以内に窓口へ提出/)).toBeInTheDocument();
    expect(screen.getByText('世田谷区 転入届')).toBeInTheDocument();
    // なぜ確度を出さないか(ADR-010): confidence は検索スコアだけから算出され回答の正しさを
    // 表さないため、UIから削除した。非保留の回答にはバッジ自体を出さない。
    expect(screen.queryByText(/確度/)).toBeNull();
    expect(screen.queryByText('要確認')).toBeNull();
    // サーバーへは選択自治体コードが送られる。
    expect(postChat).toHaveBeenCalledWith(
      expect.objectContaining({ municipalityCode: '13112', question: '転入届の持ち物は？' }),
    );
  });

  it('保留応答(abstained)は「確認できません」と要確認バッジを表示し、引用を出さない', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'full' });
    postChat.mockResolvedValue({
      answer: 'ご質問の内容については、確認できませんでした。公式ページでご確認ください。',
      citations: [],
      confidence: 'unknown',
      abstained: true,
    });

    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/質問を入力/), '保育園の空きは？');
    await user.click(screen.getByRole('button', { name: '質問する' }));

    expect(await screen.findByText(/確認できませんでした/)).toBeInTheDocument();
    expect(screen.getByText('要確認')).toBeInTheDocument();
    expect(screen.queryByText('公式の根拠')).toBeNull();
  });

  /**
   * なぜ: 対応対象外自治体の案内(apps/api/src/chat.ts)は公式URLを地の文へ埋め込んで返す。
   * 素の <p> に流すとコピー待ちの文字列で終わるため、次の行動(公式サイトを開く)へ進めない。
   * 境界条件(括弧の食い込み等)は AnswerText.test.tsx が持ち、ここでは配線だけを固定する。
   */
  it('回答本文に埋め込まれた公式URLをリンクとして描画する', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'full' });
    postChat.mockResolvedValue({
      answer:
        '八丈町は現在このチャットの対応対象外です。お手続きは八丈町の公式サイト(https://www.town.hachijo.tokyo.jp/)でご確認ください。',
      citations: [],
      confidence: 'unknown',
      abstained: true,
    });

    render(<ChatPanel municipalityCode="13401" municipalityName="八丈町" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/質問を入力/), '転入届は？');
    await user.click(screen.getByRole('button', { name: '質問する' }));

    const link = await screen.findByRole('link', { name: /www\.town\.hachijo\.tokyo\.jp/ });
    expect(link).toHaveAttribute('href', 'https://www.town.hachijo.tokyo.jp/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

/**
 * なぜ(独立点検 P1): 検索・生成の依存(APIキー・検索索引)が欠けている間も、人手で確認済みの
 * 「必要な持ち物・書類」だけは答えられる。以前はどちらの状態でも同じ入力欄が出るだけで、
 * 利用者は質問を書いて送ってはじめてエラーに出会っていた。できないことは送信前に伝える。
 */
describe('ChatPanel — 一部の依存が欠けているとき(documents_only)', () => {
  it('答えられる範囲を送信前に伝える', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'documents_only' });

    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    expect(screen.getByText('今おこたえできる範囲がかぎられています')).toBeInTheDocument();
    expect(screen.getByText(/必要な持ち物・書類についてのご質問/)).toBeInTheDocument();
    // 使える経路は残すので、入力欄は出したまま。
    expect(screen.getByLabelText(/質問を入力/)).toBeInTheDocument();
  });

  it('全機能が使えるときは、その注意は出さない', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'full' });

    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    expect(screen.queryByText('今おこたえできる範囲がかぎられています')).toBeNull();
  });
});

/**
 * なぜ(独立点検 P1): 失敗時の文面は「もう一度お試しください」と言うのに、押せるものが
 * 画面に無かった。失敗したその質問をその場でやり直せるようにする。
 */
describe('ChatPanel — 失敗したときの再試行', () => {
  it('失敗した質問を、入力欄を触らずに送り直せる', async () => {
    getChatAvailability.mockResolvedValue({ enabled: true, mode: 'full' });
    postChat.mockRejectedValueOnce(
      new Error('ただいまチャットの回答を生成できませんでした。時間をおいて再度お試しください。'),
    );

    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await screen.findByRole('heading', { name: /AIに質問する/ });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/質問を入力/), '転入届の持ち物は？');
    await user.click(screen.getByRole('button', { name: '質問する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('回答を生成できませんでした');
    // チャットが答えられなくても本体は使えることを伝える(原則8)。
    expect(screen.getByText(/チェックリストと各手続きの公式ページはこれまでどおり/)).toBeVisible();

    postChat.mockResolvedValue({
      answer: '本人確認書類が必要です。',
      citations: [
        {
          sourceId: 's-1',
          title: '世田谷区 転入届',
          ownerOrganization: '世田谷区',
          url: 'https://www.city.setagaya.lg.jp/02233/88.html',
          lastVerifiedAt: '2026-07-21T00:00:00Z',
        },
      ],
      confidence: 'high',
      abstained: false,
    });

    await user.click(screen.getByRole('button', { name: 'この質問をもう一度送る' }));

    expect(await screen.findByText(/本人確認書類が必要です/)).toBeInTheDocument();
    // 送り直したのは失敗したその質問。
    expect(postChat).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: '転入届の持ち物は？' }),
    );
  });
});
