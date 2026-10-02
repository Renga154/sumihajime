import { useEffect, useState, type FormEvent } from 'react';
import { PERSONAL_INFO_MESSAGE, detectPersonalInfo } from '@tmn/domain';
import type { ChatCitation, ChatResponse } from '@tmn/schemas';
import {
  ChatDisabledError,
  getChatAvailability,
  getMunicipalities,
  postChat,
  type ChatAvailability,
} from '../api/client';
import { formatDateFromDateTime } from '../lib/format';
import { AnswerText } from './AnswerText';
import { DriftNotice } from './DriftNotice';
import { Card, ErrorMessage, ExternalLink, Loading } from './ui';

/**
 * なぜ: FR-016〜019 / §11。チェックリスト・詳細画面から開く自治体スコープ付きRAGチャット。
 * 冒頭に固定注意文(FR-019: 個人情報を入力しない)+「対象: ○○区の公式情報のみ」を必ず表示し、
 * 回答は端的な回答 → 引用カード(公式根拠)→ 保留時は「確認できません」+公式導線で描画する。
 * RAGが無効(/api/chat 503 disabled)のときはパネルを一切描画しない(既存機能の劣化なし)。
 */

const MAX_LEN = 500;

/**
 * なぜ「確度: 高/中/低」を表示しないか(ADR-010):
 * API の confidence は検索スコア(cosine類似度)だけから算出される値で、**回答の正しさを表していない**。
 * 実際、複数ブロックの持ち物を統合し損ねた誤答(江戸川・葛飾)にも「確度: 高」が付いていた。
 * 正しさを保証しない指標を確度として見せることは、公式根拠つきという本プロダクトの約束に反する。
 * 利用者に示すのは「保留かどうか(要確認)」と「公式根拠(出典・最終確認日)」だけにする。
 * confidence はAPIの内部値として残し、評価・計測にのみ用いる。
 */

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
      {/* ADR-014 / §11.5: チェックリストの根拠カードと同じ1行を、公式リンクの直下に添える。 */}
      <DriftNotice
        kind={citation.driftKind}
        detectedOn={citation.driftDetectedOn}
        className="mt-2"
      />
    </div>
  );
}

/**
 * 根拠の公式ページに巡回が更新・不達を検知している回答への警告(§11.5「ソースが古い: stale警告を表示」)。
 *
 * なぜ回答の直上に置くのか: 引用カードの1行(DriftNotice)だけでは、回答本文を読み終えて満足した
 * 利用者が見落とす。回答の内容が公式ページの最新と食い違っている可能性は、本文より先に知るべき
 * 事実なので、本文の前に置く。断定はしない(内容が変わったかは人が再監査するまで分からない=原則3)。
 *
 * role="note" + aria-label: チェックリスト画面には既に live region があり、role="status"/"alert" を
 * 重ねると読み上げが競合する(この画面の他の注意書きと同じ判断)。名前付きの note にして辿れるようにする。
 */
function DriftWarning({ count }: { count: number }) {
  const title = '根拠の公式ページが更新された可能性があります';
  return (
    <div
      role="note"
      aria-label={title}
      className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">
        この回答の根拠にした公式ページのうち{count}
        件で、当サービスが内容を確認した日より後に、ページの更新または接続できない状態を検知しています。回答の内容が古くなっているおそれがあるため、下の「公式ページを開く」から、公式ページで最新の内容を必ずご確認ください。
      </p>
    </div>
  );
}

/**
 * チャットの描画が失敗したときの代替表示(ErrorBoundary の fallback)。
 *
 * 文面の方針(§7「次の行動が分かる文面」): 原因は推測しない。代わりに、
 * (a)いま何が使えないか、(b)何がそのまま使えるか、(c)いま押せる操作、を書く。
 * ここを「エラーが発生しました」で終わらせると、利用者はチェックリストごと
 * 壊れたのかどうかを判断できない。
 */
export function ChatUnavailable({ retry }: { retry: () => void }) {
  return (
    <section
      aria-labelledby="chat-unavailable-heading"
      className="rounded-lg border border-slate-300 bg-slate-50 p-4"
    >
      <h2 id="chat-unavailable-heading" className="font-bold text-slate-900">
        AIへの質問は、ただいまご利用いただけません
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        この部分を表示できませんでした。
        <span className="font-semibold">
          チェックリストと、各手続きの公式ページへのリンクはこのままご利用いただけます。
        </span>
      </p>
      <p className="mt-1 text-sm text-slate-700">
        手続きの内容は、各タスクの「詳細・必要書類・公式根拠」から公式ページでご確認ください。
      </p>
      <p className="mt-3">
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-100"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <path d="M10 3a7 7 0 016.32 4h-2.2a5 5 0 100 6h2.2A7 7 0 1110 3z" />
            <path d="M17 3v5h-5l1.9-1.9A5 5 0 0010 5V3h7z" />
          </svg>
          もう一度読み込む
        </button>
      </p>
    </section>
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
  // null=判定中, enabled=false=無効(非表示)
  const [availability, setAvailability] = useState<ChatAvailability | null>(null);
  const [name, setName] = useState<string>(municipalityName ?? 'この自治体');
  // 選択自治体の公式トップ(台帳由来)。公式ホストの許可リストに無い地域ドメインでも、
  // このURLだけは回答本文でリンクにしてよい(対応対象外自治体の案内が指す先)。
  const [officialUrl, setOfficialUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  // 直近に送った質問。再試行のとき、入力欄が編集されていても「失敗したその操作」をやり直す。
  const [lastAsked, setLastAsked] = useState<string | null>(null);
  // 送信前の個人情報チェックで止めたか(原則6)。入力を直したら消す。
  const [personalInfoBlocked, setPersonalInfoBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const avail = await getChatAvailability();
      if (!active) return;
      setAvailability(avail);
      // 台帳から自治体名(渡されていなければ。スコープ表示を正確にするため)と公式トップURL
      // (回答本文のリンク化で信頼してよいURL)を解決する。
      if (avail.enabled) {
        try {
          const munis = await getMunicipalities();
          const found = munis.find((m) => m.code === municipalityCode);
          if (active && found) {
            if (!municipalityName) setName(found.name);
            setOfficialUrl(found.officialUrl ?? null);
          }
        } catch {
          // 解決に失敗しても続行する(必須ではない)。公式ホストのURLは引き続きリンクになり、
          // 地域ドメインの公式トップだけが文字表示に倒れる=安全側。
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [municipalityCode, municipalityName]);

  async function ask(q: string) {
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLastAsked(q);
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
        setAvailability({ enabled: false, mode: 'disabled' });
        return;
      }
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    // 原則6: 電話番号・メールアドレス・マイナンバーを含む質問は、サーバーへも外部AIへも送らない。
    // 判定は API の 422 と同じ純関数(@tmn/domain)。ここで止めるのは、送ってから断られるより先に、
    // 入力欄のすぐ下で直し方を伝えるため(送信そのものを起こさない)。入力欄の文面は消さない。
    if (detectPersonalInfo(q).length > 0) {
      setPersonalInfoBlocked(true);
      return;
    }
    void ask(q);
  }

  // 判定中・無効時は何も描画しない(既存UIの劣化なし)。
  if (availability?.enabled !== true) return null;
  const documentsOnly = availability.mode === 'documents_only';
  const driftedCount = result
    ? result.citations.filter((cite) => cite.driftKind !== undefined).length
    : 0;

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

      {/*
        なぜ送信前に伝えるのか(独立点検 P1): 検索・生成の依存(APIキー・検索索引)が欠けている間、
        答えられるのは人手で確認済みの「必要な持ち物・書類」だけになる。以前は同じ入力欄が出て、
        利用者は質問を書いて送ってはじめてエラーに出会っていた。できないことは、手を動かす前に言う。
      */}
      {/*
        role="status" は付けない。チェックリスト画面では進捗表示が既に live region を
        持っており、1画面に2つ置くと読み上げが競合する(ChecklistPage の同じ判断に倣う)。
        代わりに見出しにして、見出し移動でも辿れるようにする。
      */}
      {documentsOnly && (
        <div className="rounded-lg border border-slate-400 bg-slate-100 p-3 text-sm text-slate-900">
          <h3 className="font-semibold">今おこたえできる範囲がかぎられています</h3>
          <p className="mt-1">
            ただいまは<span className="font-semibold">必要な持ち物・書類についてのご質問</span>
            にのみおこたえできます（例:
            転入届に必要な持ち物は？）。それ以外のご質問にはおこたえできませんので、
            {name}の公式ページでご確認ください。
          </p>
        </div>
      )}

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">ご利用上の注意</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            回答は<span className="font-semibold">{name}の公式情報のみ</span>
            を対象にした目安です。最終的な内容は必ず公式ページでご確認ください。
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
          {/*
            2026-10-02: 送信先が外部(OpenAI 社・米国)であること、検索(埋め込み)と回答の作成の
            両方に使うことを明記した。以前の「AIモデルで処理」では、国外の事業者へ送ることが
            読み取れなかった。保存・記録しないのは「このサービスでは」であり、OpenAI 社での
            取り扱いは同社の条件による(断定できない保持期間などは書かない)。
          */}
          <li>
            ご質問の文章は、回答に使う公式情報の検索と回答文の作成のため、OpenAI社（米国）のAPIへ送信されます。このサービスでは、質問文と回答を保存もログ記録もしません。
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
          onChange={(e) => {
            setQuestion(e.target.value);
            setPersonalInfoBlocked(false);
          }}
          aria-invalid={personalInfoBlocked || undefined}
          aria-describedby={personalInfoBlocked ? 'chat-input-personal-info' : undefined}
          maxLength={MAX_LEN}
          rows={3}
          className="w-full rounded-lg border border-slate-300 p-2 text-sm"
          placeholder="この自治体の手続きについて質問できます"
        />
        {personalInfoBlocked && (
          // role="alert": 送信ボタンを押した直後の、その操作に対する結果を即座に読み上げる。
          // 入力値は引用しない(個人情報を画面へ複製しない)。
          <p
            id="chat-input-personal-info"
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            {PERSONAL_INFO_MESSAGE}
          </p>
        )}
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
          {/* 入力欄を編集していても、失敗したその質問をやり直せるようにする
              (押した時点の文面を lastAsked に控えてある)。 */}
          <ErrorMessage
            error={error}
            retryLabel="この質問をもう一度送る"
            {...(lastAsked ? { onRetry: () => void ask(lastAsked) } : {})}
          />
          <p className="text-sm text-slate-600">
            回答が出せない間も、チェックリストと各手続きの公式ページはこれまでどおりご利用いただけます。
          </p>
        </div>
      )}

      {result && !loading && (
        <Card className="space-y-3">
          {/* 要確認: 保留したとき、または根拠の公式ページに巡回が更新・不達を検知しているとき。 */}
          {(result.abstained || driftedCount > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-300">
                要確認
              </span>
            </div>
          )}
          {/*
            回答本文には公式URLが地の文に埋め込まれて返ることがある(対応対象外自治体の案内、
            回答へ載せられなかった話題の注記)。AnswerText がそのうち信頼できるURL(公式ホスト、
            またはこの回答の引用URL・選択自治体の公式トップと完全一致)だけをリンクに変える。
            生成回答には質問文から写り込んだURLが混ざり得るため、それ以外は文字のまま出す。
            ここへ渡すのは API 由来の result.answer のみで、質問欄の入力は通さない。
          */}
          {driftedCount > 0 && <DriftWarning count={driftedCount} />}
          <AnswerText
            text={result.answer}
            trustedUrls={[
              ...result.citations.map((cite) => cite.url),
              ...(officialUrl ? [officialUrl] : []),
            ]}
          />

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
