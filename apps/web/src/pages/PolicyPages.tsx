import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GSI_TILE_ORIGIN } from '@tmn/domain';
import { ExternalLink } from '../components/ui';
import { useDocumentTitle } from '../lib/navigation';
import { FEEDBACK_FORM_URL, FEEDBACK_TOPICS } from '../content/contact';

/**
 * 利用規約(/terms)とプライバシーポリシー(/privacy)。
 *
 * なぜ必要か: 常時公開のサービスとして最低限そろえる文書であり、免責が各ページに散っているだけの
 * 状態を解消する(docs/ROADMAP.md A-1-3)。
 *
 * なぜこの書き方か: プライバシーポリシーは一般論ではなく**実装の事実**を書く。保存先の
 * localStorage キー、サーバーへ送る項目、ログに残す項目、外部へ出す通信先は、いずれもコードで
 * 確かめられる範囲だけを書き、将来の予定を現在形で書かない(CLAUDE.md 原則3・原則9)。
 * 実装を変えたらこのページも変える必要がある——それが分かるように、対応する仕組みの名前を
 * 括弧で添えてある。
 */

const REVISED_ON = '2026年9月24日';

function PolicyLayout({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm leading-relaxed text-slate-600">{lead}</p>
        <p className="text-xs text-slate-500">最終改定日: {REVISED_ON}</p>
      </header>
      {children}
      <ContactSection />
      <nav className="border-t border-slate-200 pt-4 text-sm">
        <Link
          to="/terms"
          className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          利用規約
        </Link>
        <span className="mx-2 text-slate-300">/</span>
        <Link
          to="/privacy"
          className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          プライバシーポリシー
        </Link>
        <span className="mx-2 text-slate-300">/</span>
        <Link
          to="/about-data"
          className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          このサービスのデータについて
        </Link>
      </nav>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="border-l-4 border-brand-500 pl-2 text-lg font-bold text-slate-900">
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

/**
 * 誤り報告・問い合わせの窓口(docs/ROADMAP.md A-1-2)。
 * URL 未設定のあいだは節ごと描画しない——「準備中」とだけ書かれた窓口を公開しないため。
 */
function ContactSection() {
  if (!FEEDBACK_FORM_URL) return null;
  return (
    <Section id="contact-heading" title="誤りのご報告・お問い合わせ">
      <p>
        正確さがこのサービスの核であり、誤りのご報告は何より助かります。次の内容を受け付けています。
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {FEEDBACK_TOPICS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p>
        <ExternalLink href={FEEDBACK_FORM_URL}>お問い合わせフォームを開く</ExternalLink>
      </p>
      <p className="text-slate-600">
        フォームは外部サービス（Google フォーム）で提供しています。お名前や連絡先の入力は必須では
        ありません。お急ぎの手続きについては、このサービスではなく各自治体の窓口へ直接お問い合わせ
        ください。
      </p>
    </Section>
  );
}

export function TermsPage() {
  useDocumentTitle('利用規約');
  return (
    <PolicyLayout
      title="利用規約"
      lead="「スミハジメ」（以下「本サービス」）をご利用いただく前にお読みください。"
    >
      <Section id="terms-about" title="1. 本サービスについて">
        <p>
          本サービスは、東京都内へ転入する方が必要な手続きを調べるための
          <strong>非公式</strong>のウェブサービスです。行政機関が提供する公式サービスではなく、
          個人（しがないVibeCoder）が無償で開発・運営しています。行政機関からの委託・後援・
          監修は受けていません。
        </p>
      </Section>

      <Section id="terms-accuracy" title="2. 情報の正確性と免責">
        <p>
          掲載しているすべての手続きに、自治体・官公庁の公式ページを出典として示し、最終確認日を
          表示しています。それでも本サービスの表示内容は<strong>目安</strong>です。制度改正や
          ページ更新により実際と異なる場合があります。手続きの前に、必ず出典として示した公式ページ、
          または各自治体の窓口で最新の内容をご確認ください。
        </p>
        <p>
          本サービスの利用、または利用できなかったことによって生じた損害について、運営者は責任を
          負いません。
        </p>
        <p>
          出典ページの更新を機械で定期的に検知しており、内容が変わった可能性のある手続きには
          「再確認中」と表示します（
          <Link
            to="/about-data"
            className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
          >
            このサービスのデータについて
          </Link>
          ）。表示は消さず、公式ページへのリンクも残します。
        </p>
      </Section>

      <Section id="terms-scope" title="3. 対応範囲">
        <p>
          対応している自治体・分野は限られています。未対応のものは「未対応」と明示し、対応済みの
          ように見せることはしません。対応状況は「このサービスのデータについて」で公開しています。
        </p>
      </Section>

      <Section id="terms-prohibited" title="4. 禁止事項">
        <ul className="list-disc space-y-1 pl-5">
          <li>本サービスの運営を妨げる行為（過度な連続アクセス、不正なアクセスなど）</li>
          <li>表示内容を、出典を示さずに転載し、あたかも公式情報であるかのように示す行為</li>
          <li>法令または公序良俗に反する行為</li>
        </ul>
      </Section>

      <Section id="terms-license" title="5. 著作権とライセンス">
        <p>
          本サービスの<strong>ソースコード</strong>は MIT ライセンスで公開します（リポジトリの
          LICENSE ファイル）。
        </p>
        <p>
          <strong>データ</strong>は扱いが異なります。手続きの内容は各自治体・官公庁の公式ページを
          出典としており、その利用条件は出典元の規約に従います。クリエイティブ・コモンズ 表示 （CC
          BY）等のライセンスで提供されているデータには、出典一覧で提供元・帰属表示・
          ライセンスを明記しています。再利用される場合は、出典元の条件をご確認ください。
        </p>
        <p>地図は国土地理院の地理院タイルを利用しています（同院の利用規約に従います）。</p>
      </Section>

      <Section id="terms-changes" title="6. サービスの変更・中断">
        <p>
          本サービスは無償・無保証で提供しており、予告なく内容の変更・提供の中断・終了を行う場合が
          あります。
        </p>
      </Section>

      <Section id="terms-ads" title="7. 広告について">
        <p>
          現時点では広告を表示していません。将来的に運営費を賄うために広告を導入する場合は、
          本規約とプライバシーポリシーを改定したうえで、広告であることが分かる表示とともに掲出します。
          手続きの根拠や最終確認日と混同されない場所に限って掲出し、特定の事業者を推奨することは
          しません。
        </p>
      </Section>

      <Section id="terms-law" title="8. 準拠法">
        <p>本規約は日本法に準拠します。</p>
      </Section>
    </PolicyLayout>
  );
}

export function PrivacyPage() {
  useDocumentTitle('プライバシーポリシー');
  return (
    <PolicyLayout
      title="プライバシーポリシー"
      lead="本サービスが何を集めず、何を端末内に保存し、何をサーバーで処理するかを、実装のとおりに書いています。"
    >
      <Section id="privacy-not-collected" title="1. そもそも集めない情報">
        <p>
          本サービスは、
          <strong>氏名・電話番号・メールアドレス・完全な生年月日・マイナンバー</strong>
          を入力する欄を設けていません。住所についても、番地や部屋番号は尋ねず、
          <strong>自治体（区）の選択</strong>のみを使います。会員登録もログインもありません。
        </p>
      </Section>

      <Section id="privacy-local" title="2. お使いの端末内にだけ保存する情報">
        <p>
          入力条件と進捗は、ブラウザの保存領域（localStorage）に保存します。サーバーには保存しません。
          保存するのは次の情報です。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>選択した自治体</li>
          <li>引越し日、前住所地の転出予定日（任意入力）、世帯人数と年齢帯、該当条件の回答</li>
          <li>チェックリストの完了状態</li>
          <li>通信できないときにも一覧を開けるようにするための、チェックリストの控え</li>
        </ul>
        <p>
          これらはブラウザの設定から「サイトデータを削除」すると消えます。別の端末やブラウザには
          引き継がれません。
        </p>
      </Section>

      <Section id="privacy-server" title="3. サーバーで処理する情報">
        <p>
          チェックリストを作るとき、選択した自治体・引越し日・世帯構成・該当条件はサーバーへ送られ、
          どの手続きが必要かの判定に使われます。<strong>保存もログ記録もしません</strong>（応答を
          返し終えた時点で破棄されます）。
        </p>
        <p>
          AIチャットをお使いの場合、質問文はサーバーで処理され、回答の生成のために外部のAIモデル
          （OpenAI 社の gpt-4o-mini）へ送信されます。質問文と回答は
          <strong>保存もログ記録もしません</strong>。質問欄には氏名・住所の番地・電話番号などの
          個人情報を入力しないでください（画面上でもご案内しています）。
        </p>
      </Section>

      <Section id="privacy-logs" title="4. ログに残す情報">
        <p>
          障害の調査のために、サーバーは限られた項目だけを記録します。記録する項目はコード上で
          許可リストとして固定されており、それ以外は記録されません。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>リクエストID（毎回ランダムに採番する番号）</li>
          <li>処理の種類（例: チェックリスト作成）と結果のHTTPステータス、処理時間、件数</li>
          <li>選択された自治体コード</li>
        </ul>
        <p>引越し日・世帯構成・チャットの質問文・IPアドレスは記録しません。</p>
      </Section>

      <Section id="privacy-ip" title="5. IPアドレスの扱い">
        <p>
          AIチャットには連続利用の制限（1分あたり10回）があり、その判定のためにIPアドレスを
          サーバーのメモリ上で一時的に使います。保存もログ記録もせず、一定時間で消えます。
        </p>
        <p>
          なお、本サービスは Cloudflare のネットワーク上で動作しており、通信の配送・保護の過程で
          同社がIPアドレス等の通信情報を取り扱います。
        </p>
      </Section>

      <Section id="privacy-cookies" title="6. Cookie・アクセス解析">
        <p>
          本サービスは Cookie を使用していません。アクセス解析ツールも導入していないため、
          利用者個人の行動を追跡していません。
        </p>
      </Section>

      <Section id="privacy-external" title="7. 外部へ送信される情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>AIチャットの質問文 — 回答生成のため OpenAI 社へ送信します（上記3）。</li>
          <li>
            地図の表示 — 窓口の地図を表示すると、ブラウザが国土地理院（
            <ExternalLink href={GSI_TILE_ORIGIN}>{GSI_TILE_ORIGIN}</ExternalLink>
            ）へ地図画像を直接取得しにいきます。その際、通信に伴うIPアドレス等が同院へ伝わります。
          </li>
          <li>
            お問い合わせフォーム — フォームを開いて送信した内容は Google 社へ送られます（下記8）。
          </li>
          <li>
            公式ページへのリンク — リンクを開くと、その先は各自治体・官公庁のサイトであり、
            本ポリシーの適用範囲外です。
          </li>
        </ul>
      </Section>

      <Section id="privacy-form" title="8. 誤りのご報告・お問い合わせフォーム">
        <p>
          お問い合わせは Google フォームで受け付けています。フォームに入力された内容は Google 社の
          サービス上に保存され、運営者だけが閲覧し、データの修正とお問い合わせへの対応にのみ使います。
          フォームはメールアドレスを収集せず、Google へのログインも求めない設定にしています。
          入力欄に氏名・住所・連絡先などの個人情報は書かないでください。
        </p>
        <p>
          手続きの詳細画面から「この手続きの誤りを報告する」を開くと、手続き名・自治体コード・
          その画面のURLが入力済みの状態でフォームが開きます。引越し日や世帯などの入力条件は
          含めません。
        </p>
      </Section>

      <Section id="privacy-ads" title="9. 広告について">
        <p>
          現時点では広告を表示しておらず、広告事業者へ情報を渡していません。将来的に広告を導入する
          場合は、事前に本ポリシーを改定し、どの事業者にどの情報が渡るかを明記します。
        </p>
      </Section>

      <Section id="privacy-changes" title="10. 本ポリシーの改定">
        <p>仕組みを変更したときは、本ポリシーも合わせて改定し、最終改定日を更新します。</p>
      </Section>
    </PolicyLayout>
  );
}
