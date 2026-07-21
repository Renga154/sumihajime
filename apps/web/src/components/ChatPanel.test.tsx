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
    getChatAvailability.mockResolvedValue(false);
    render(<ChatPanel municipalityCode="13112" municipalityName="世田谷区" />);
    await waitFor(() => expect(getChatAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /AIに質問する/ })).toBeNull();
    expect(postChat).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — RAG有効時', () => {
  it('固定注意文(PII)+スコープを表示し、引用付き回答を描画する', async () => {
    getChatAvailability.mockResolvedValue(true);
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
    expect(screen.getByText('確度: 高')).toBeInTheDocument();
    // サーバーへは選択自治体コードが送られる。
    expect(postChat).toHaveBeenCalledWith(
      expect.objectContaining({ municipalityCode: '13112', question: '転入届の持ち物は？' }),
    );
  });

  it('保留応答(abstained)は「確認できません」と要確認バッジを表示し、引用を出さない', async () => {
    getChatAvailability.mockResolvedValue(true);
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
});
