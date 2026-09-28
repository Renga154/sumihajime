import { z } from 'zod';

/**
 * 公開データ・API応答に載せるURLの唯一の定義: https かつドメイン名のホストだけを許す。
 *
 * なぜ z.url() ではだめか: z.url() は WHATWG URL として解釈できれば通すため、`javascript:alert(1)`・
 * `data:text/html,...`・`http://` も受け付ける。これらのURLは画面で <a href> になる(根拠カードの
 * 「公式ページを開く」、未対応自治体の公式サイト導線)ので、台帳の誤記や改ざんがそのまま
 * スクリプト実行・平文通信の導線になる。公式の自治体・国のサイトは実測ですべて https であり
 * (registry.csv・municipalities.ts に http は無い)、https 限定で正当なデータは落ちない。
 * ホストを z.regexes.domain に限るのは、IPアドレス直書きや localhost を根拠URLにさせないため。
 */
export const httpsUrlSchema = z.url({ protocol: /^https$/, hostname: z.regexes.domain });
