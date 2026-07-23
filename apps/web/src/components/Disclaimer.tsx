/**
 * なぜ: §16.2「利用者への説明」を入力導線の目立つ位置に表示する。入力目的・保存範囲
 * (端末内のみ)・非公式である旨・公式ページでの最終確認・チャットに個人情報を
 * 入れないこと、の5点を必ず含める。
 */
export function Disclaimer() {
  return (
    <section
      aria-labelledby="disclaimer-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h2 id="disclaimer-heading" className="flex items-center gap-1.5 text-base font-bold">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5 shrink-0 text-amber-600"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 7a1 1 0 112 0 1 1 0 01-2 0zm2 3a1 1 0 10-2 0v4a1 1 0 102 0v-4z"
            clipRule="evenodd"
          />
        </svg>
        ご利用の前に
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <span className="font-semibold">入力の目的：</span>
          引越しに必要な行政手続きを判定し、あなた向けのToDoチェックリストを作るために使います。
        </li>
        <li>
          <span className="font-semibold">保存範囲：</span>
          入力内容はお使いの端末内（ブラウザ）にのみ保存され、サーバーには保存されません。
        </li>
        <li>
          <span className="font-semibold">非公式サービス：</span>
          これは行政の正式なサービスではありません。表示は目安です。
        </li>
        <li>
          <span className="font-semibold">最終確認：</span>
          実際の手続きの前に、必ず各自治体の公式ページで最新情報をご確認ください。
        </li>
        <li>
          <span className="font-semibold">個人情報：</span>
          氏名・住所の番地・電話番号・マイナンバーなどは入力しないでください（このサービスでは求めません）。
        </li>
      </ul>
    </section>
  );
}
