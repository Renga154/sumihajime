import { useEffect, useId, useState } from 'react';
import { WASTE_SORTING_QUERY_MAX_LENGTH, type WasteSortingItem } from '@tmn/schemas';
import { ApiError, getWasteSortingSummary, searchWasteSorting } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge } from './Badge';
import { Card, ErrorMessage, ExternalLink, Loading } from './ui';

/**
 * なぜ: FR-014 補強。ごみの分別区分を品目名で調べる検索UI(GET /api/waste-sorting)。
 * 入力はテキストのみ(氏名・番地等のPII欄は持たない=§13)。q未指定はカテゴリ別件数チップで
 * 検索を促し、q指定は品目・分別区分・注意点・料金備考+出典(CC BY 4.0の帰属)を表示する。
 * 0件時は「見つかりません+公式分別ページへの導線」で誠実に締める(推測しない=CLAUDE.md原則3)。
 * データ未整備の自治体(404)は原則9に沿って公式サイトへ誘導する。
 */

const DEBOUNCE_MS = 300;

interface Props {
  municipalityCode: string;
  municipalityName: string;
  officialUrl?: string;
}

type SearchResult =
  | { kind: 'summary'; categories: { category: string; count: number }[]; total: number }
  | { kind: 'search'; query: string; items: WasteSortingItem[]; total: number };

export function WasteSortingSearch({ municipalityCode, municipalityName, officialUrl }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const inputId = useId();
  const statusId = useId();

  // デバウンス: 入力停止後 DEBOUNCE_MS で確定クエリを更新し、過剰なAPI呼び出しを抑える。
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const result = useAsync<SearchResult>(async () => {
    if (query.length === 0) {
      const summary = await getWasteSortingSummary(municipalityCode);
      return { kind: 'summary', categories: summary.categories, total: summary.total };
    }
    const search = await searchWasteSorting(municipalityCode, query);
    return { kind: 'search', query: search.query, items: search.items, total: search.total };
  }, [municipalityCode, query]);

  const unavailable =
    result.error instanceof ApiError && result.error.code === 'waste_sorting_data_unavailable';

  return (
    <section aria-labelledby="waste-sorting-heading" className="print-hide">
      <h2
        id="waste-sorting-heading"
        className="flex items-center gap-2 text-lg font-bold text-slate-900"
      >
        <span className="h-5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
        分別を調べる
      </h2>
      {/*
        なぜ出し分けるのか(独立点検 P1-11): 分別データ未整備の区でも「{区名}のオープンデータより
        表示します」という断定の導入文と、動くのに何も返らない検索欄が出ていた。同じ画面の下では
        「まだ整備されていません」と正しく告知しており、画面内で矛盾していた。存在しないデータを
        約束しない(原則3・原則9)ため、未整備と分かった時点で導入文と検索欄を出さない。
      */}
      {!unavailable && (
        <p className="mt-0.5 pl-3.5 text-xs text-slate-500">
          品目名を入力すると、分別区分・注意点の目安を表示します（{municipalityName}
          のオープンデータより）。
        </p>
      )}

      {!unavailable && (
        <Card className="mt-2.5">
          <label htmlFor={inputId} className="block font-semibold text-slate-900">
            品目名で調べる
          </label>
          <div className="relative mt-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 103.4 9.82l3.14 3.14a1 1 0 001.42-1.42l-3.14-3.14A5.5 5.5 0 009 3.5zM5.5 9a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z"
                clipRule="evenodd"
              />
            </svg>
            <input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              // サーバー(GET /api/waste-sorting)と同じ上限。超える語は API が 400 で断るため、
              // 画面で先に止めて「入力できたのにエラー」にしない(最長の品目名46字に余裕を持たせた値)。
              maxLength={WASTE_SORTING_QUERY_MAX_LENGTH}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例：ペットボトル、乾電池、傘"
              aria-describedby={statusId}
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 transition-colors focus:border-brand-500"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            入力された品目名はこの端末内でのみ使われ、サーバーへ保存されません。
          </p>
        </Card>
      )}

      <div className="mt-3" role="status" aria-live="polite" id={statusId}>
        {result.loading && <Loading label="分別情報を検索中です…" />}

        {result.error != null &&
          (unavailable ? (
            <UnavailableNote municipalityName={municipalityName} officialUrl={officialUrl} />
          ) : (
            <ErrorMessage error={result.error} onRetry={result.reload} />
          ))}

        {result.data?.kind === 'summary' && (
          <SummaryChips categories={result.data.categories} total={result.data.total} />
        )}

        {result.data?.kind === 'search' &&
          (result.data.items.length === 0 ? (
            <NoResults
              query={result.data.query}
              municipalityName={municipalityName}
              officialUrl={officialUrl}
            />
          ) : (
            <ResultList
              items={result.data.items}
              total={result.data.total}
              municipalityName={municipalityName}
              officialUrl={officialUrl}
            />
          ))}
      </div>
    </section>
  );
}

/** q未指定時: カテゴリ別件数チップで「どんな区分があるか」を示し、検索を促す。 */
function SummaryChips({
  categories,
  total,
}: {
  categories: { category: string; count: number }[];
  total: number;
}) {
  if (categories.length === 0) return null;
  return (
    <div>
      <p className="text-sm text-slate-700">
        登録品目 <span className="font-bold tabular-nums">{total}</span>{' '}
        件。品目名を入力して検索してください。
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <li key={c.category}>
            <Badge tone="brand">
              {c.category}
              <span className="ml-1 tabular-nums text-brand-600">{c.count}</span>
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 検索結果一覧(品目名・分別区分バッジ・注意点・料金備考)。末尾に出典(帰属)を明記する。 */
function ResultList({
  items,
  total,
  municipalityName,
  officialUrl,
}: {
  items: WasteSortingItem[];
  total: number;
  municipalityName: string;
  officialUrl?: string;
}) {
  return (
    <div>
      <p className="text-sm text-slate-700">
        <span className="font-bold tabular-nums">{total}</span> 件見つかりました
        {total > items.length && (
          <span className="text-slate-500">（先頭 {items.length} 件を表示）</span>
        )}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.itemId}>
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                {/* 品目名は見出し要素にする(検索セクション見出し h2 の下位=h3)。
                    flex の子なので span から h3 に替えてもレイアウトは変わらない。 */}
                <h3 className="font-bold text-slate-900">{item.name}</h3>
                <Badge tone="blue">{item.category}</Badge>
                {item.feeNote && (
                  <span className="text-xs text-slate-500">料金区分：{item.feeNote}</span>
                )}
              </div>
              {item.reading && <p className="mt-0.5 text-xs text-slate-400">{item.reading}</p>}
              {item.notes && <p className="mt-1.5 text-sm text-slate-700">{item.notes}</p>}
            </Card>
          </li>
        ))}
      </ul>
      <Attribution
        municipalityName={municipalityName}
        officialUrl={officialUrl}
        sourceId={items[0]?.sourceId}
      />
    </div>
  );
}

/** 0件時: 推測せず「見つかりません」と公式分別ページへの導線を示す(CLAUDE.md原則3)。 */
function NoResults({
  query,
  municipalityName,
  officialUrl,
}: {
  query: string;
  municipalityName: string;
  officialUrl?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
      <p className="font-semibold text-slate-800">
        「{query}」に一致する品目は見つかりませんでした
      </p>
      <p className="mt-1 text-sm text-slate-600">
        別の言い方（例：正式名称や素材名）でお試しいただくか、公式の分別ページでご確認ください。
      </p>
      {officialUrl && (
        <p className="mt-3">
          <ExternalLink href={officialUrl}>
            {municipalityName}の公式サイトで分別を調べる
          </ExternalLink>
        </p>
      )}
    </div>
  );
}

/** データ未整備の自治体(404)向けの誠実表示。対応済みに見せない(原則9)。 */
function UnavailableNote({
  municipalityName,
  officialUrl,
}: {
  municipalityName: string;
  officialUrl?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center">
      <p className="font-semibold text-slate-800">
        この自治体のごみ分別データはまだ整備されていません
      </p>
      <p className="mt-1 text-sm text-slate-600">分別区分は公式の分別ページでご確認ください。</p>
      {officialUrl && (
        <p className="mt-3">
          <ExternalLink href={officialUrl}>{municipalityName}の公式サイトを見る</ExternalLink>
        </p>
      )}
    </div>
  );
}

/**
 * 出典表示(FR-020 帰属)。ごみ分別辞書はいずれも自治体オープンデータ(CC BY 4.0)由来のため、
 * ライセンスと帰属先を明記し、公式ページへ1タップで到達できるようにする(SourceCardと同じ流儀)。
 */
function Attribution({
  municipalityName,
  officialUrl,
  sourceId,
}: {
  municipalityName: string;
  officialUrl?: string;
  sourceId?: string;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 border-l-4 border-l-brand-600 bg-brand-50/50 p-3 text-xs text-slate-600">
      <p className="font-semibold text-brand-700">出典</p>
      <p className="mt-0.5">
        {municipalityName} オープンデータ「ごみの分別」（ライセンス：CC BY 4.0）
      </p>
      {sourceId && <p className="mt-0.5 text-slate-400">ソースID：{sourceId}</p>}
      {officialUrl && (
        <p className="mt-1">
          <ExternalLink href={officialUrl}>公式の分別ページで最新情報を確認する</ExternalLink>
        </p>
      )}
    </div>
  );
}
