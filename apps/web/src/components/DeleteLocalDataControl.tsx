import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAllAppData } from '../lib/storage';
import { useAppState } from '../state/AppState';

/**
 * 「この端末に保存した入力を消去」操作(プライバシーポリシー画面・チェックリスト画面で共用)。
 *
 * なぜ2段階の確認にするか: 削除は取り消せない(原則7寄りの操作)。window.confirm はブラウザ
 * ネイティブのダイアログでスクリーンリーダーの読み上げやスタイルを制御できないため使わず、
 * 押下後にインラインで「消去する/やめる」を表示する方式にする。最初のボタンを誤って
 * ダブルクリックしただけでは消えない(2段目は別のボタンで、位置も文言も変わる)。
 *
 * なぜ完了をライブリージョンで告知するか: 消去後は `/` へ遷移するため、画面が切り替わる前に
 * スクリーンリーダー利用者へ「消去しました」を伝える必要がある。遷移を少し遅らせて
 * (ANNOUNCE_BEFORE_NAVIGATE_MS)告知が読み上げられる時間を確保する。
 */

const ANNOUNCE_BEFORE_NAVIGATE_MS = 600;

type Phase = 'idle' | 'confirming' | 'done';

export function DeleteLocalDataControl() {
  const [phase, setPhase] = useState<Phase>('idle');
  const { resetMunicipalityCode } = useAppState();
  const navigate = useNavigate();

  function handleConfirm() {
    clearAllAppData();
    // storage側は既に消し終えている。ここでメモリ上の状態(選択中の自治体)だけを合わせて空にする。
    resetMunicipalityCode();
    setPhase('done');
    // 完了の告知が読み上げられる間だけ待ってから遷移する(画面が消えると告知も読めなくなる)。
    setTimeout(() => navigate('/'), ANNOUNCE_BEFORE_NAVIGATE_MS);
  }

  return (
    <div className="space-y-2">
      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => setPhase('confirming')}
          className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-800"
        >
          この端末に保存した入力を消去
        </button>
      )}

      {phase === 'confirming' && (
        <div
          role="group"
          aria-labelledby="delete-local-data-confirm-heading"
          className="rounded-lg border border-red-300 bg-red-50 p-3"
        >
          <p id="delete-local-data-confirm-heading" className="text-sm font-semibold text-red-900">
            本当に消去しますか？
          </p>
          <p className="mt-1 text-sm text-red-900">
            選択した自治体、入力した条件、チェックリストの完了状態など、この端末に保存した内容がすべて消えます。この操作は取り消せません。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="tap-target inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-800 active:bg-red-900"
            >
              消去する
            </button>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {/* aria-live は常に描画しておく(直前まで無かった要素へ告知を後乗せしても読み上げられない
          ブラウザ/スクリーンリーダーの組み合わせがあるため)。文言が無い間は空文字。
          role="status" にしないのは、チェックリスト画面の進捗表示が既にそのroleを使っており
          (1画面に複数のstatusを置くと読み上げが競合する)、この部品はその画面にも置かれるため。 */}
      <p aria-live="polite" className="sr-only">
        {phase === 'done' ? 'この端末に保存した入力を消去しました。' : ''}
      </p>
    </div>
  );
}
