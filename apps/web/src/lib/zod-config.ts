import { z } from 'zod';

/**
 * ブラウザでは Zod の JIT コンパイルを使わない。
 *
 * なぜ: Zod v4 は最初の parse のときに「`new Function('')` が動くか」を try/catch で試し、
 * 動くならバリデータを実行時生成(JIT)する。この試行は CSP の `script-src` に引っかかり、
 * 例外は Zod 側で握られるので**動作は正常なまま**、CSP違反レポートとコンソールエラーだけが
 * 全ページで1件ずつ出続ける(実測: index-*.js の Zod 機能検出で `script-src blocked eval`)。
 * 本物の違反がこのノイズに埋もれるのは避けたいので、機能検出そのものを起こさせない。
 * `jitless: true` は Zod 公式の「eval を許さない環境向け」設定で、検証結果は変わらない
 * (JITしないぶん僅かに遅いだけ。本アプリが検証するのは高々数十件のAPI応答)。
 *
 * このモジュールは main.tsx の**最初**に import する。以降のモジュールが parse する前に
 * 設定を効かせる必要があるため、並び順に意味がある。
 */
z.config({ jitless: true });
