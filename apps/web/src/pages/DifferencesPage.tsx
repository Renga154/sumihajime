import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WardDifferenceCell, WardDifferenceTopic } from '@tmn/schemas';
import { getWardDifferences } from '../api/client';
import { useAppState } from '../state/AppState';
import { useAsync } from '../lib/useAsync';
import { formatDateFromDateTime } from '../lib/format';
import { cellFor, pickContrastMunicipality } from '../lib/ward-differences';
import { Badge } from '../components/Badge';
import { Card, ErrorMessage, ExternalLink, Loading } from '../components/ui';
import { useDocumentTitle } from '../lib/navigation';

/**
 * 「区ごとの期限のちがい」(/differences)。
 *
 * このページの存在理由: 23区すべてを整備して初めて見えたのが「同じ手続きでも、区によって
 * 期限や起算日が違う」という事実だった。転入者にとっては実害のある差(申請が数日遅れただけで
 * 助成が遡れない区がある)なので、プロダクトの中で体験できる形にする。
 *
 * 設計上の絶対条件(CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」):
 *   自治体間の比較は、利用者が「区ごとの違いを見る」と明示的に選んで到達したこのページだけで行う。
 *   チェックリスト・手続き詳細・ごみ・RAGの各画面には他区の値を一切出さない
 *   (チェックリストからの導線はこのページへのリンク1つだけ。値は載せない)。
 *   ページ冒頭で「ここは比較ページであり、あなたのチェックリストは選んだ区だけを表示している」
 *   ことを必ず明示する。
 *
 * 表示の設計: 透明性ページで「全部載っているが誰も辿れない(モバイルで12万px)」を経験しているため、
 *   既定は「あなたの区 × くらべる区」の2区だけを縦に並べ、全23区は <details> で到達可能にする。
 *   横スクロールする表は作らない(375px幅で成立させる)。
 *
 * 値は API(/api/ward-differences)が公開済みデータから毎回導出したものをそのまま表示する。
 * このコンポーネントは判定ロジックを持たない(§4 UIとルールの分離)。
 */

/** 値バッジ。要確認系(caution)は色だけでなく文言でも「要確認」と伝える(§15.3)。 */
function ValueBadge({ cell }: { cell: Pick<WardDifferenceCell, 'tone' | 'valueLabel'> }) {
  return <Badge tone={cell.tone === 'caution' ? 'amber' : 'brand'}>{cell.valueLabel}</Badge>;
}

/** 出典リンクと最終確認日(原則2: 公開する値には必ず根拠と最終確認日を付ける)。 */
function SourceList({ cell }: { cell: WardDifferenceCell }) {
  return (
    <ul className="mt-2 space-y-1 text-xs text-slate-600">
      {cell.sources.map((s) => (
        <li key={s.sourceId}>
          <ExternalLink href={s.url}>{s.title}</ExternalLink>
          <span className="ml-1.5 whitespace-nowrap text-slate-500">
            （最終確認 {formatDateFromDateTime(s.lastVerifiedAt)}）
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 比較する2区のうち1区ぶんのカード。モバイルでは上下に積む(横スクロールさせない)。 */
function WardCell({
  label,
  cell,
  municipalityName,
}: {
  label: string;
  cell: WardDifferenceCell | undefined;
  municipalityName: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-0.5 text-base font-bold text-slate-900">{municipalityName}</p>
      {!cell ? (
        <p className="mt-2 text-sm text-slate-600">
          この自治体のデータは未整備のため比較できません。公式ページでご確認ください。
        </p>
      ) : (
        <>
          <p className="mt-2">
            <ValueBadge cell={cell} />
          </p>
          <details className="mt-2 text-sm">
            {/* tap-target: 開閉トグルは summary 自体が標的。display は変えない
                (flex にすると開閉の三角マーカーが消え、見た目が変わる)。 */}
            <summary className="tap-target cursor-pointer text-brand-700 underline underline-offset-2">
              公式の文言を読む
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-slate-700">
              {cell.officialText}
            </p>
          </details>
          <SourceList cell={cell} />
        </>
      )}
    </div>
  );
}

/** 全区一覧(既定は折りたたみ)。値ごとにまとめ、各区に出典と最終確認日を添える。 */
function AllWards({ topic }: { topic: WardDifferenceTopic }) {
  const cellByCode = new Map(topic.cells.map((c) => [c.municipalityCode, c]));
  return (
    <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="tap-target cursor-pointer text-sm font-semibold text-brand-700">
        対応している{topic.cells.length}区すべての値を見る
      </summary>
      <div className="mt-3 space-y-4">
        {topic.valueGroups.map((group) => (
          <div key={group.valueId}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={group.tone === 'caution' ? 'amber' : 'brand'}>{group.label}</Badge>
              <span className="text-xs font-semibold text-slate-600">
                {group.municipalityCodes.length}区
              </span>
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {group.municipalityCodes.map((code) => {
                const cell = cellByCode.get(code);
                if (!cell) return null;
                return (
                  <li key={code} className="border-l-2 border-slate-200 pl-2.5 text-sm">
                    <span className="font-medium text-slate-800">{cell.municipalityName}</span>
                    <SourceList cell={cell} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {topic.omittedMunicipalityCodes.length > 0 && (
          <p className="text-xs text-slate-600">
            {topic.omittedMunicipalityCodes.length}
            件の自治体は、この手続きのデータが未整備のため比較に含めていません。
          </p>
        )}
      </div>
    </details>
  );
}

export function DifferencesPage() {
  useDocumentTitle('自治体ごとの期限のちがい');
  const { municipalityCode } = useAppState();
  const state = useAsync(() => getWardDifferences(), []);
  const report = state.data;

  const [mine, setMine] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);

  // 読み込み後に初期値を決める。自分の区は選択済みの自治体、相手は「いちばん違いが多い区」。
  useEffect(() => {
    if (!report || report.municipalities.length === 0) return;
    const fallback = report.municipalities[0]?.code ?? null;
    const known = report.municipalities.some((m) => m.code === municipalityCode);
    const nextMine = known && municipalityCode ? municipalityCode : fallback;
    setMine((prev) => prev ?? nextMine);
    setOther(
      (prev) => prev ?? (nextMine ? (pickContrastMunicipality(report, nextMine) ?? null) : null),
    );
  }, [report, municipalityCode]);

  const nameOf = useMemo(() => {
    const map = new Map((report?.municipalities ?? []).map((m) => [m.code, m.name]));
    return (code: string | null): string => (code ? (map.get(code) ?? code) : '');
  }, [report]);

  /*
   * 左側を「あなたの区」と呼べるのは、それが実際に利用者の選んだ自治体と一致するときだけ。
   *
   * なぜ(2026-08-09): このページをメインメニューへ載せたことで、自治体を一度も選んでいない
   * 初回訪問者が直接到達するようになった。そのとき左側は一覧の先頭(千代田区)が既定で入るが、
   * それを「あなたの区」と呼ぶのは利用者について事実に反する断定になる(原則3)。
   * 選択済みでも、利用者が左側の選択を別の区へ変えれば同じことが起きる。
   * 一致しないときは役割だけを述べる「基準の区」にする。
   */
  const isOwnWard = mine != null && mine === municipalityCode;
  const mineLabel = isOwnWard ? 'あなたの自治体' : '基準の自治体';

  if (state.loading) return <Loading label="自治体ごとの違いを読み込んでいます…" />;
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (!report) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          自治体ごとの期限のちがい
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          同じ名前の手続きでも、申請の期限や、期限を数えはじめる日は自治体ごとに違います。
          対応している{report.municipalities.length}
          自治体すべての公式ページをデータ化して分かった違いを、公開済みデータからそのまま集計しています。
        </p>
      </div>

      {/* 原則4: このページの位置づけを最初に明示する(比較はここだけで行う)。 */}
      <div
        role="note"
        className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm leading-relaxed text-brand-900"
      >
        <p className="font-semibold">これは自治体間の比較ページです。</p>
        <p className="mt-1">
          あなたのチェックリストには、選んだ自治体の情報だけを表示しています。ここで見た他の自治体の値を、
          ご自身の手続きに当てはめないでください。実際の手続きの前に、必ずお住まいの自治体の公式ページでご確認ください。
        </p>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ward-mine" className="block text-sm font-semibold text-slate-800">
              {mineLabel}
            </label>
            <select
              id="ward-mine"
              value={mine ?? ''}
              onChange={(e) => setMine(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {report.municipalities.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ward-other" className="block text-sm font-semibold text-slate-800">
              くらべる区
            </label>
            <select
              id="ward-other"
              value={other ?? ''}
              onChange={(e) => setOther(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {report.municipalities.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {municipalityCode == null && (
          // 未選択のまま到達した人に、左側が既定値であることと次の行動を伝える。
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            まだ自治体を選んでいないため、左は一覧の先頭を仮に表示しています。
            <Link
              to="/"
              className="tap-target-inline font-medium text-brand-700 underline underline-offset-2"
            >
              自治体を選ぶ
            </Link>
            と、お住まいの自治体が最初から入ります。
          </p>
        )}
      </Card>

      {report.topics.map((topic) => {
        const a = mine ? cellFor(report, topic.topicId, mine) : undefined;
        const b = other ? cellFor(report, topic.topicId, other) : undefined;
        const same = a && b && a.valueId === b.valueId;
        return (
          <section key={topic.topicId} aria-labelledby={`topic-${topic.topicId}`}>
            <Card>
              <h2
                id={`topic-${topic.topicId}`}
                className="text-base font-bold text-slate-900 sm:text-lg"
              >
                {topic.title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{topic.question}</p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <WardCell label={mineLabel} cell={a} municipalityName={nameOf(mine)} />
                <WardCell label="くらべる区" cell={b} municipalityName={nameOf(other)} />
              </div>

              <p className="mt-3 text-sm font-medium text-slate-800">
                {same
                  ? 'この2つの自治体は同じ扱いです。'
                  : a && b
                    ? 'この2つの自治体では扱いが違います。'
                    : '選んだ自治体のどちらかにデータがありません。'}
                <span className="ml-1 font-normal text-slate-600">
                  対応している{topic.cells.length}自治体は{topic.valueGroups.length}
                  通りに分かれます。
                </span>
              </p>

              <AllWards topic={topic} />

              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                判定方法: {topic.derivationNote}
              </p>
            </Card>
          </section>
        );
      })}

      <Card>
        <p className="text-sm text-slate-700">
          自分の自治体の手続きは、チェックリストで確認できます（表示されるのは選んだ区の情報だけです）。
        </p>
        <Link
          to="/checklist"
          className="mt-2 inline-block font-semibold text-brand-700 underline underline-offset-2"
        >
          チェックリストへ
        </Link>
      </Card>
    </div>
  );
}
