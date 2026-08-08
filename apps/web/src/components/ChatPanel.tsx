import { useEffect, useState, type FormEvent } from 'react';
import type { ChatCitation, ChatResponse } from '@tmn/schemas';
import { ChatDisabledError, getChatAvailability, getMunicipalities, postChat } from '../api/client';
import { formatDateFromDateTime } from '../lib/format';
import { Card, ErrorMessage, ExternalLink, Loading } from './ui';

/**
 * なぜ: FR-016〜019 / §11。チェックリスト・詳細画面から開く自治体スコープ付きRAGチャット。
 * 冒頭に固定注意文(FR-019: 個人情報を入力しない)+「対象: ○○区の公式情報のみ」を必ず表示し、
 * 回答は端的な回答 → 引用カード(公式根拠)→ 保留時は「確認できません」+公式導線で描画する。
 * RAGが無効(/api/chat 503 disabled)のときはパネルを一切描画しない(既存機能の劣化なし)。
 */

const MAX_LEN = 500;

const confidenceLabel: Record<ChatResponse['confidence'], string> = {
  high: '確度: 高',
  medium: '確度: 中',
  low: '確度: 低',
  unknown: '要確認',
};

function CitationCard({ citation }: { citation: ChatCitation }) {
  const verified = formatDateFromDateTime(citation.lastVerifiedAt);
  return (
    <div className="rounded-lg border border-slate-200 border-l-4 border-l-brand-600 bg-gradient-to-br from-brand-50/70 to-white p-3 text-sm">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-white ring-4 ring-brand-100"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
            <path
              d="M6.5 12.5l3.2 3.2 7-7.4"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-brand-700">
            公式根拠
          </p>
          <p className="font-semibold leading-snug text-slate-900">{citation.title}</p>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-slate-700">
        <dt className="text-slate-500">提供元</dt>
        <dd className="font-medium">{citation.ownerOrganization}</dd>
        {verified && (
          <>
            <dt className="text-slate-500">最終確認日</dt>
            <dd className="font-semibold text-slate-900">{verified}</dd>
          </>
        )}
      </dl>
      <p className="mt-2">
        <ExternalLink href={citation.url}>公式ページを開く</ExternalLink>
      </p>
    </div>
  );
}

export function ChatPanel({
  municipalityCode,
  municipalityName,
  procedureId,
  category,
}: {
  municipalityCode: string;
  municipalityName?: string;
  procedureId?: string;
  category?: string;
}) {
  // null=判定中, false=無効(非表示), true=有効
  const [available, setAvailable] = useState<boolean | null>(null);
  const [name, setName] = useState<string>(municipalityName ?? 'この自治体');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const avail = await getChatAvailability();
      if (!active) return;
      setAvailable(avail);
      // 自治体名が渡されていなければ台帳から解決(スコープ表示を正確にするため)。
      if (avail && !municipalityName) {
        try {
          const munis = await getMunicipalities();
          const found = munis.find((m) => m.code === municipalityCode);
          if (active && found) setName(found.name);
        } catch {
          // 解決に失敗しても既定表示のまま続行(必須ではない)。
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [municipalityCode, municipalityName]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await postChat({
        municipalityCode,
        question: q,
        ...(procedureId ? { procedureId } : {}),
        ...(category ? { category } : {}),
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ChatDisabledError) {
        setAvailable(false);
        return;
      }
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  // 判定中・無効時は何も描画しない(既存UIの劣化なし)。
  if (available !== true) return null;

  return (
    <section aria-labelledby="chat-heading" className="space-y-3">
      <h2 id="chat-heading" className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <path d="M10 1.5l1.9 4.2 4.6.5-3.4 3.1.9 4.5L10 11.9 6 13.8l.9-4.5L3.5 6.2l4.6-.5L10 1.5z" />
          </svg>
        </span>
        AIに質問する（ベータ）
      </h2>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">ご利用上の注意</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            回答は<span className="font-semibold">{name}の公式情報のみ</span>を対象にした目安です。
            最終的な内容は必ず公式ページでご確認ください。
          </li>
          <li>
            <span className="font-semibold">
              氏名・住所の番地・電話番号・マイナンバーなどの個人情報は入力しないでください。
            </span>
          </li>
          {/*
            なぜ書くのか(独立点検 P1-10): チェックリストの入力内容は端末内にしか保存されないが、
            チャットの質問文だけはサーバーへ送信されAIモデルで処理される。実装は質問文・回答を
            ログに残さない設計だが、送信される事実そのものが画面に書かれていなかった。
            誠実な実装を説明不足で損なわないよう、送信と保存の扱いを明示する。
          */}
          <li>
            ご質問の文章はこのサービスのサーバーへ送信され、AIモデルで処理されます。質問文と回答は
            保存もログ記録もしていません。
          </li>
        </ul>
      </div>

      <form onSubmit={onSubmit} className="space-y-2">
        <label htmlFor="chat-input" className="block text-sm font-semibold text-slate-700">
          質問を入力（例: 転入届に必要な持ち物は？）
        </label>
        <textarea
          id="chat-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={MAX_LEN}
          rows={3}
          className="w-full rounded-lg border border-slate-300 p-2 text-sm"
          placeholder="この自治体の手続きについて質問できます"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {question.length}/{MAX_LEN}
          </span>
          <button
            type="submit"
            disabled={loading || question.trim().length === 0}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            質問する
          </button>
        </div>
      </form>

      {loading && <Loading label="回答を生成中です…" />}

      {error != null && (
        <div className="space-y-2">
          <ErrorMessage error={error} />
          <p className="text-sm text-slate-600">
            お手数ですが、少し時間をおいてもう一度「質問する」を押してください。
          </p>
        </div>
      )}

      {result && !loading && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                result.abstained
                  ? 'bg-amber-100 text-amber-900 ring-amber-300'
                  : 'bg-brand-50 text-brand-800 ring-brand-200'
              }`}
            >
              {result.abstained ? '要確認' : confidenceLabel[result.confidence]}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{result.answer}</p>

          {result.citations.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-900">公式の根拠</h3>
              <div className="mt-2 space-y-2">
                {result.citations.map((cite) => (
                  <CitationCard key={cite.sourceId} citation={cite} />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
