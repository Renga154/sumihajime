# officialUrl の https 実測検証(2026-08-08)

対象は `scripts/publish/src/municipalities.ts` の `MUNICIPALITIES[].officialUrl`(東京都62市区町村の公式サイト入口。FR-021「未対応でも公式サイトへ誘導」の唯一のマスタ)。
`docs/data-sources/registry.csv`(承認済みソース台帳)には `http://` のエントリが 0 件であり、今回の変更対象外。

## 1. 何を・なぜ変更したか

このマスタは東京都「リンク集／都内区市町村」(<https://www.metro.tokyo.lg.jp/sitemap/link/link04>)の href を出典としており、
スキームも出典の表記どおり `http://` のまま取り込んでいた。結果として62件中20件が平文HTTPの入口を利用者へ提示していた。

利用者を平文HTTPへ誘導しない(中間者による改ざん・盗聴の余地を残さない)ため、**推測ではなく実測**で `https://` 版の到達性を確認し、
条件を満たしたものだけをスキーム変更した。ホスト名・パスは一切変更していない(出典の href と同一。CLAUDE.md 原則3/5「根拠がない場合は推測しない」「非公式サイトを一次根拠にしない」)。

### 更新の採否基準(すべて満たす場合のみ更新)

1. `https://` 版が **HTTP 200** を返す(TLS証明書がホスト名に対して有効であること。証明書検証は無効化していない)。
2. 最終URLの**ホスト名が変更前と同一**である(統合・移転で別ドメインへ飛ぶ場合は対象外)。
3. 取得した**本文に当該自治体名が含まれる**(ホスト名だけでは判定しない。パーキングページ・エラーページを除外するため)。

いずれかを満たさない場合は**変更せず**、理由を本書へ記録する。元の `http://` が切れている場合も勝手に別URLへ差し替えず「要確認」として記録のみ行う。

## 2. 実測の方法(再現手順)

- 実測日: 2026-08-08(Asia/Tokyo)
- 計測は**2つの独立したHTTPスタックで二重に**行い、結果が一致することを確認した。
  - Node.js v22.22.3 の `fetch`。`redirect: 'manual'` で1ホップずつ辿り、**各ホップのステータスと Location をすべて記録**。タイムアウト30秒。
    User-Agent は `tokyo-move-navi-linkcheck/0.0.1 (+official-url https verification)`(ingest と同じく素性を明示するUA)。
    本文は `Content-Type` または `<meta charset>` から判定した文字コードでデコードしてから自治体名を照合した。
  - `curl -L` (`%{http_code}` / `%{url_effective}` / `%{num_redirects}` / 終了コードを記録)。
- 証明書エラーの詳細は `openssl s_client` で提示証明書の subject を確認した。
- 各リクエストの間に1秒の待機を入れ、自治体サーバへの負荷を避けた。
- `data/sources/` の原文スナップショットには一切触れていない(SHA-256 を壊さないため)。

## 3. 結果サマリ

| 区分                           | 件数                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `http://` だったエントリ       | 20                                                                                                 |
| → https へ更新した             | **19**                                                                                             |
| → 据え置いた(https が到達不可) | **1**(御蔵島村 13382)                                                                              |
| 既存 `https://` エントリ       | 42                                                                                                 |
| → 到達を確認                   | **42**(切れているものは0件)                                                                        |
| → 要確認として記録             | 2(調布市 13208 のドメイン移転転送、神津島村 13364 の `www` 補完転送。いずれも稼働中のため変更せず) |

注記: 依頼時の前提「未対応39自治体のうち20件が http」との差異 —
実際には20件のうち **3件(大田区13111・渋谷区13113・豊島区13116)は `supported: true` の対応済み区**であり、未対応は17件だった。
北区(13117)は既に `https://www.city.kita.lg.jp/`(2026-08-07 の人手レビューでドメイン移転を反映済み)で `http://` ではない。
20件という件数自体は一致しており、対象の取りこぼしはない。

## 4. 変更したもの — https 版の実測結果(20件)

| code  | 自治体   | 変更前(http)                                  | https 実測 | 最終URL                                        | 転送 | 本文の自治体名 / title                         | 判定         |
| ----- | -------- | --------------------------------------------- | ---------- | ---------------------------------------------- | ---- | ---------------------------------------------- | ------------ |
| 13111 | 大田区   | `http://www.city.ota.tokyo.jp/`               | 200        | `https://www.city.ota.tokyo.jp/`               | 0回  | あり / 大田区ホームページ：トップページ        | **更新**     |
| 13113 | 渋谷区   | `http://www.city.shibuya.tokyo.jp/`           | 200        | `https://www.city.shibuya.tokyo.jp/`           | 0回  | あり / 渋谷区公式サイト \| 渋谷区ポータル      | **更新**     |
| 13116 | 豊島区   | `http://www.city.toshima.lg.jp/`              | 200        | `https://www.city.toshima.lg.jp/`              | 0回  | あり / 豊島区公式ホームページ                  | **更新**     |
| 13203 | 武蔵野市 | `http://www.city.musashino.lg.jp/`            | 200        | `https://www.city.musashino.lg.jp/`            | 0回  | あり / 武蔵野市公式ホームページ                | **更新**     |
| 13206 | 府中市   | `http://www.city.fuchu.tokyo.jp/index.html`   | 200        | `https://www.city.fuchu.tokyo.jp/index.html`   | 0回  | あり / 東京都府中市ホームページ                | **更新**     |
| 13210 | 小金井市 | `http://www.city.koganei.lg.jp/`              | 200        | `https://www.city.koganei.lg.jp/`              | 0回  | あり / トップページ：小金井市公式WEBへようこそ | **更新**     |
| 13211 | 小平市   | `http://www.city.kodaira.tokyo.jp/`           | 200        | `https://www.city.kodaira.tokyo.jp/`           | 0回  | あり / 東京都小平市公式ホームページ            | **更新**     |
| 13212 | 日野市   | `http://www.city.hino.lg.jp/`                 | 200        | `https://www.city.hino.lg.jp/`                 | 0回  | あり / 日野市公式ホームページ                  | **更新**     |
| 13219 | 狛江市   | `http://www.city.komae.tokyo.jp/`             | 200        | `https://www.city.komae.tokyo.jp/`             | 0回  | あり / ホーム - 狛江市役所                     | **更新**     |
| 13224 | 多摩市   | `http://www.city.tama.lg.jp/`                 | 200        | `https://www.city.tama.lg.jp/`                 | 0回  | あり / 多摩市公式ホームページ                  | **更新**     |
| 13225 | 稲城市   | `http://www.city.inagi.tokyo.jp/`             | 200        | `https://www.city.inagi.tokyo.jp/`             | 0回  | あり / 稲城市公式ウェブサイト                  | **更新**     |
| 13227 | 羽村市   | `http://www.city.hamura.tokyo.jp/`            | 200        | `https://www.city.hamura.tokyo.jp/`            | 0回  | あり / 羽村市公式サイト                        | **更新**     |
| 13229 | 西東京市 | `http://www.city.nishitokyo.lg.jp/`           | 200        | `https://www.city.nishitokyo.lg.jp/`           | 0回  | あり / トップページ 西東京市Web                | **更新**     |
| 13303 | 瑞穂町   | `http://www.town.mizuho.tokyo.jp/`            | 200        | `https://www.town.mizuho.tokyo.jp/`            | 0回  | あり / ホーム \| 瑞穂町ホームページ            | **更新**     |
| 13308 | 奥多摩町 | `http://www.town.okutama.tokyo.jp/`           | 200        | `https://www.town.okutama.tokyo.jp/`           | 0回  | あり / ホーム／奥多摩町                        | **更新**     |
| 13307 | 檜原村   | `http://www.vill.hinohara.tokyo.jp/`          | 200        | `https://www.vill.hinohara.tokyo.jp/`          | 0回  | あり / 檜原村ホームページ                      | **更新**     |
| 13362 | 利島村   | `http://www.toshimamura.org/`                 | 200        | `https://www.toshimamura.org/`                 | 0回  | あり / 利島村                                  | **更新**     |
| 13363 | 新島村   | `http://www.niijima.com/`                     | 200        | `https://www.niijima.com/`                     | 0回  | あり / 東京都新島村ホームページ                | **更新**     |
| 13382 | 御蔵島村 | `http://www.mikurasima.jp/`                   | 到達不可   | —                                              | —    | —                                              | **据え置き** |
| 13402 | 青ヶ島村 | `http://www.vill.aogashima.tokyo.jp/top.html` | 200        | `https://www.vill.aogashima.tokyo.jp/top.html` | 0回  | あり / 青ヶ島村ホームページ                    | **更新**     |

「転送 0回」= `https://` を直接叩いて 200 が返り、リダイレクトが1回も発生しなかったことを意味する(=ホスト・パスが変わっていない)。

### curl による二重確認(同一結果)

19件すべてが `curl_exit=0 / 200 / redirects=0`、御蔵島村のみ `curl_exit=60`。

```
13382 御蔵島村  curl_exit=60
curl: (60) SSL: no alternative certificate subject name matches target host name 'www.mikurasima.jp'
```

## 5. 変更しなかったもの — 御蔵島村(13382)

| 項目                                      | 実測値                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 検証したURL                               | `https://www.mikurasima.jp/`                                                                                  |
| 結果                                      | **到達不可**。Node fetch = `ERR_TLS_CERT_ALTNAME_INVALID` / curl = 終了コード60                               |
| 提示された証明書                          | `subject=/C=JP/ST=TOKYO/L=CHIYODA/O=NTT DOCOMO BUSINESS, Inc./CN=*.bizmw.com`(`www.mikurasima.jp` を含まない) |
| 現行値 `http://www.mikurasima.jp/` の死活 | **稼働中**。301 → `https://www.vill.mikurasima.tokyo.jp/` → 200(title「御蔵島村」・本文に自治体名あり)        |

判断: 採否基準1(https で 200)を満たさないため **`http://` のまま据え置く**。
なお現行値は 301 で移転先へ転送されるため、利用者は公式サイトへ到達できており、リンク切れではない。

**要確認(人手レビュー待ち)**: 移転先 `https://www.vill.mikurasima.tokyo.jp/` は 200 で自治体名も確認できたが、
これは出典(都リンク集)の href と**別ホスト**への差し替えにあたる。ホスト変更は北区(13117)と同様に人手レビュー承認を経てから行う方針とし、
本セッションでは差し替えていない(CLAUDE.md §9「人手承認済みデータだけを公開対象にする」)。

### 参考: 元の `http://` 20件の死活(変更判断の裏取り)

20件すべてが 200 で稼働しており、**切れているものは0件**だった。
うち13件はサイト側が既に `https://` へ 301 転送しており、今回の更新はその転送先を先取りしたことになる。
残り6件(大田・府中・小平・狛江・新島・青ヶ島)は http のままでも 200 を返す(自動転送なし)ため、
今回の更新には「サイト側が転送してくれない分を確実に暗号化する」実利がある。

| code  | 自治体   | 元の http URL                                 | ステータス | 最終URL                                       | 挙動                                                  |
| ----- | -------- | --------------------------------------------- | ---------- | --------------------------------------------- | ----------------------------------------------------- |
| 13111 | 大田区   | `http://www.city.ota.tokyo.jp/`               | 200        | `http://www.city.ota.tokyo.jp/`               | http のまま 200(サイト側の https 自動転送なし)        |
| 13113 | 渋谷区   | `http://www.city.shibuya.tokyo.jp/`           | 200        | `https://www.city.shibuya.tokyo.jp/`          | 301 で `https://www.city.shibuya.tokyo.jp/` へ転送    |
| 13116 | 豊島区   | `http://www.city.toshima.lg.jp/`              | 200        | `https://www.city.toshima.lg.jp/`             | 301 で `https://www.city.toshima.lg.jp/` へ転送       |
| 13203 | 武蔵野市 | `http://www.city.musashino.lg.jp/`            | 200        | `https://www.city.musashino.lg.jp/`           | 301 で `https://www.city.musashino.lg.jp/` へ転送     |
| 13206 | 府中市   | `http://www.city.fuchu.tokyo.jp/index.html`   | 200        | `http://www.city.fuchu.tokyo.jp/index.html`   | http のまま 200(サイト側の https 自動転送なし)        |
| 13210 | 小金井市 | `http://www.city.koganei.lg.jp/`              | 200        | `https://www.city.koganei.lg.jp/`             | 301 で `https://www.city.koganei.lg.jp/` へ転送       |
| 13211 | 小平市   | `http://www.city.kodaira.tokyo.jp/`           | 200        | `http://www.city.kodaira.tokyo.jp/`           | http のまま 200(サイト側の https 自動転送なし)        |
| 13212 | 日野市   | `http://www.city.hino.lg.jp/`                 | 200        | `https://www.city.hino.lg.jp/`                | 301 で `https://www.city.hino.lg.jp/` へ転送          |
| 13219 | 狛江市   | `http://www.city.komae.tokyo.jp/`             | 200        | `http://www.city.komae.tokyo.jp/`             | http のまま 200(サイト側の https 自動転送なし)        |
| 13224 | 多摩市   | `http://www.city.tama.lg.jp/`                 | 200        | `https://www.city.tama.lg.jp/`                | 301 で `https://www.city.tama.lg.jp/` へ転送          |
| 13225 | 稲城市   | `http://www.city.inagi.tokyo.jp/`             | 200        | `https://www.city.inagi.tokyo.jp/`            | 301 で `https://www.city.inagi.tokyo.jp/` へ転送      |
| 13227 | 羽村市   | `http://www.city.hamura.tokyo.jp/`            | 200        | `https://www.city.hamura.tokyo.jp/`           | 301 で `https://www.city.hamura.tokyo.jp/` へ転送     |
| 13229 | 西東京市 | `http://www.city.nishitokyo.lg.jp/`           | 200        | `https://www.city.nishitokyo.lg.jp/`          | 301 で `https://www.city.nishitokyo.lg.jp/` へ転送    |
| 13303 | 瑞穂町   | `http://www.town.mizuho.tokyo.jp/`            | 200        | `https://www.town.mizuho.tokyo.jp/`           | 301 で `https://www.town.mizuho.tokyo.jp/` へ転送     |
| 13308 | 奥多摩町 | `http://www.town.okutama.tokyo.jp/`           | 200        | `https://www.town.okutama.tokyo.jp/`          | 301 で `https://www.town.okutama.tokyo.jp/` へ転送    |
| 13307 | 檜原村   | `http://www.vill.hinohara.tokyo.jp/`          | 200        | `https://www.vill.hinohara.tokyo.jp/`         | 301 で `https://www.vill.hinohara.tokyo.jp/` へ転送   |
| 13362 | 利島村   | `http://www.toshimamura.org/`                 | 200        | `https://www.toshimamura.org/`                | 301 で `https://www.toshimamura.org/` へ転送          |
| 13363 | 新島村   | `http://www.niijima.com/`                     | 200        | `http://www.niijima.com/`                     | http のまま 200(サイト側の https 自動転送なし)        |
| 13382 | 御蔵島村 | `http://www.mikurasima.jp/`                   | 200        | `https://www.vill.mikurasima.tokyo.jp/`       | 301 で `https://www.vill.mikurasima.tokyo.jp/` へ転送 |
| 13402 | 青ヶ島村 | `http://www.vill.aogashima.tokyo.jp/top.html` | 200        | `http://www.vill.aogashima.tokyo.jp/top.html` | http のまま 200(サイト側の https 自動転送なし)        |

## 6. 既存 `https://` エントリ42件の死活確認

**切れているものは0件**。ただし2件で転送が発生していたため、事実として記録する(**いずれも変更していない**)。

| code  | 自治体     | 登録URL                                      | ステータス | 最終URL                                      | 転送 | 本文の自治体名 |
| ----- | ---------- | -------------------------------------------- | ---------- | -------------------------------------------- | ---- | -------------- |
| 13101 | 千代田区   | `https://www.city.chiyoda.lg.jp/`            | 200        | `https://www.city.chiyoda.lg.jp/`            | なし | あり           |
| 13102 | 中央区     | `https://www.city.chuo.lg.jp/`               | 200        | `https://www.city.chuo.lg.jp/`               | なし | あり           |
| 13103 | 港区       | `https://www.city.minato.tokyo.jp/`          | 200        | `https://www.city.minato.tokyo.jp/`          | なし | あり           |
| 13104 | 新宿区     | `https://www.city.shinjuku.lg.jp/`           | 200        | `https://www.city.shinjuku.lg.jp/`           | なし | あり           |
| 13105 | 文京区     | `https://www.city.bunkyo.lg.jp/`             | 200        | `https://www.city.bunkyo.lg.jp/`             | なし | あり           |
| 13106 | 台東区     | `https://www.city.taito.lg.jp/`              | 200        | `https://www.city.taito.lg.jp/`              | なし | あり           |
| 13107 | 墨田区     | `https://www.city.sumida.lg.jp/`             | 200        | `https://www.city.sumida.lg.jp/`             | なし | あり           |
| 13108 | 江東区     | `https://www.city.koto.lg.jp/`               | 200        | `https://www.city.koto.lg.jp/`               | なし | あり           |
| 13109 | 品川区     | `https://www.city.shinagawa.tokyo.jp/`       | 200        | `https://www.city.shinagawa.tokyo.jp/`       | なし | あり           |
| 13110 | 目黒区     | `https://www.city.meguro.tokyo.jp/`          | 200        | `https://www.city.meguro.tokyo.jp/`          | なし | あり           |
| 13112 | 世田谷区   | `https://www.city.setagaya.lg.jp/`           | 200        | `https://www.city.setagaya.lg.jp/`           | なし | あり           |
| 13114 | 中野区     | `https://www.city.tokyo-nakano.lg.jp/`       | 200        | `https://www.city.tokyo-nakano.lg.jp/`       | なし | あり           |
| 13115 | 杉並区     | `https://www.city.suginami.tokyo.jp/`        | 200        | `https://www.city.suginami.tokyo.jp/`        | なし | あり           |
| 13117 | 北区       | `https://www.city.kita.lg.jp/`               | 200        | `https://www.city.kita.lg.jp/`               | なし | あり           |
| 13118 | 荒川区     | `https://www.city.arakawa.tokyo.jp/`         | 200        | `https://www.city.arakawa.tokyo.jp/`         | なし | あり           |
| 13119 | 板橋区     | `https://www.city.itabashi.tokyo.jp/`        | 200        | `https://www.city.itabashi.tokyo.jp/`        | なし | あり           |
| 13120 | 練馬区     | `https://www.city.nerima.tokyo.jp/`          | 200        | `https://www.city.nerima.tokyo.jp/`          | なし | あり           |
| 13121 | 足立区     | `https://www.city.adachi.tokyo.jp/`          | 200        | `https://www.city.adachi.tokyo.jp/`          | なし | あり           |
| 13122 | 葛飾区     | `https://www.city.katsushika.lg.jp/`         | 200        | `https://www.city.katsushika.lg.jp/`         | なし | あり           |
| 13123 | 江戸川区   | `https://www.city.edogawa.tokyo.jp/`         | 200        | `https://www.city.edogawa.tokyo.jp/`         | なし | あり           |
| 13201 | 八王子市   | `https://www.city.hachioji.tokyo.jp/`        | 200        | `https://www.city.hachioji.tokyo.jp/`        | なし | あり           |
| 13202 | 立川市     | `https://www.city.tachikawa.lg.jp/`          | 200        | `https://www.city.tachikawa.lg.jp/`          | なし | あり           |
| 13204 | 三鷹市     | `https://www.city.mitaka.lg.jp/`             | 200        | `https://www.city.mitaka.lg.jp/`             | なし | あり           |
| 13205 | 青梅市     | `https://www.city.ome.tokyo.jp/`             | 200        | `https://www.city.ome.tokyo.jp/`             | なし | あり           |
| 13207 | 昭島市     | `https://www.city.akishima.lg.jp/`           | 200        | `https://www.city.akishima.lg.jp/`           | なし | あり           |
| 13208 | 調布市     | `https://www.city.chofu.tokyo.jp/`           | 200        | `https://www.city.chofu.lg.jp/`              | 1回  | あり           |
| 13209 | 町田市     | `https://www.city.machida.tokyo.jp/`         | 200        | `https://www.city.machida.tokyo.jp/`         | なし | あり           |
| 13213 | 東村山市   | `https://www.city.higashimurayama.tokyo.jp/` | 403        | `https://www.city.higashimurayama.tokyo.jp/` | なし | **なし**       |
| 13214 | 国分寺市   | `https://www.city.kokubunji.tokyo.jp/`       | 200        | `https://www.city.kokubunji.tokyo.jp/`       | なし | あり           |
| 13215 | 国立市     | `https://www.city.kunitachi.tokyo.jp/`       | 200        | `https://www.city.kunitachi.tokyo.jp/`       | なし | あり           |
| 13218 | 福生市     | `https://www.city.fussa.tokyo.jp/`           | 200        | `https://www.city.fussa.tokyo.jp/`           | なし | あり           |
| 13220 | 東大和市   | `https://www.city.higashiyamato.lg.jp/`      | 200        | `https://www.city.higashiyamato.lg.jp/`      | なし | あり           |
| 13221 | 清瀬市     | `https://www.city.kiyose.lg.jp/`             | 200        | `https://www.city.kiyose.lg.jp/`             | なし | あり           |
| 13222 | 東久留米市 | `https://www.city.higashikurume.lg.jp/`      | 200        | `https://www.city.higashikurume.lg.jp/`      | なし | あり           |
| 13223 | 武蔵村山市 | `https://www.city.musashimurayama.lg.jp/`    | 200        | `https://www.city.musashimurayama.lg.jp/`    | なし | あり           |
| 13228 | あきる野市 | `https://www.city.akiruno.tokyo.jp/`         | 200        | `https://www.city.akiruno.tokyo.jp/`         | なし | あり           |
| 13305 | 日の出町   | `https://www.town.hinode.tokyo.jp/`          | 200        | `https://www.town.hinode.tokyo.jp/`          | なし | あり           |
| 13361 | 大島町     | `https://www.town.oshima.tokyo.jp/`          | 200        | `https://www.town.oshima.tokyo.jp/`          | なし | あり           |
| 13401 | 八丈町     | `https://www.town.hachijo.tokyo.jp/`         | 200        | `https://www.town.hachijo.tokyo.jp/`         | なし | あり           |
| 13364 | 神津島村   | `https://vill.kouzushima.tokyo.jp/`          | 200        | `https://www.vill.kouzushima.tokyo.jp/`      | 2回  | あり           |
| 13381 | 三宅村     | `https://www.vill.miyake.tokyo.jp/`          | 200        | `https://www.vill.miyake.tokyo.jp/`          | なし | あり           |
| 13421 | 小笠原村   | `https://www.vill.ogasawara.tokyo.jp/`       | 200        | `https://www.vill.ogasawara.tokyo.jp/`       | なし | あり           |

### 補足1: 東村山市(13213)の 403 は正常

上表の 403 は当方の非ブラウザUAに対する WAF / ボットフィルタの反応であり、サイト障害ではない。
ブラウザUA(Chrome)で再取得すると `200` / title `トップページ | 東村山市` / 本文に「東村山」23回出現を確認した。利用者影響なし、変更不要。

### 補足2: 転送が発生した2件(要確認・今回は変更なし)

| code  | 自治体   | 登録URL                             | 実測の転送                                                                                        | 判断                                                                                                                                                                       |
| ----- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13208 | 調布市   | `https://www.city.chofu.tokyo.jp/`  | 301 → `https://www.city.chofu.lg.jp/`(200・title「調布市公式ホームページ」)                       | ドメイン移転(`tokyo.jp` → `lg.jp`)。旧ドメインは301で稼働中のため利用者影響なし。ホスト変更は人手レビュー承認事項のため**変更せず記録のみ**                                |
| 13364 | 神津島村 | `https://vill.kouzushima.tokyo.jp/` | 301 → `http://www.vill.kouzushima.tokyo.jp/` → 301 → `https://www.vill.kouzushima.tokyo.jp/`(200) | `www` 補完のみで同一サイト。ただし**転送の途中で一度 http へ落ちる**ため、`www` 付きの直リンクにすれば平文HTTPを経由しなくなる。ホスト変更にあたるため**変更せず記録のみ** |

## 7. 差分と検証(CLAUDE.md §9)

- 変更ファイル: `scripts/publish/src/municipalities.ts` のみ(officialUrl 19件のスキーム変更 + 経緯コメント)。
- `docs/data-sources/registry.csv` は変更なし(`http://` エントリが元から0件。承認済みソースのURLには一切手を触れていない)。
- `data/sources/`(原文スナップショット)は変更なし(SHA-256 を保全)。
- リグレッション防止として `scripts/publish/src/municipalities.test.ts` に次の2件を追加した。
  - `http://` で残るのは御蔵島村(13382)ちょうど1件であること(http への巻き戻りを検知する)。
  - 御蔵島村の値が出典どおり `http://www.mikurasima.jp/` のままであること(未承認のホスト差し替えを検知する)。

## 8. 次に人手レビューへ諮る事項

1. 御蔵島村(13382): `http://www.mikurasima.jp/` → `https://www.vill.mikurasima.tokyo.jp/` への差し替え可否。
2. 調布市(13208): `https://www.city.chofu.tokyo.jp/` → `https://www.city.chofu.lg.jp/` への差し替え可否。
3. 神津島村(13364): `https://vill.kouzushima.tokyo.jp/` → `https://www.vill.kouzushima.tokyo.jp/` への差し替え可否(転送途中の平文HTTP経由を回避できる)。

いずれも現行値のままでも利用者は公式サイトへ到達できるため、緊急性はない。

## 9. 追記: §8 の3件を人手レビュー承認のうえ更新した(2026-08-08)

§8 で諮った3件について**利用者の承認を得た**(「検証して移転先へ更新」)。承認後、
移転先URLを実測してから差し替えた。推測では更新していない。

| code  | 自治体   | 変更前                              | 変更後                                  | status | 転送回数 | 本文の自治体名 |
| ----- | -------- | ----------------------------------- | --------------------------------------- | ------ | -------- | -------------- |
| 13382 | 御蔵島村 | `http://www.mikurasima.jp/`         | `https://www.vill.mikurasima.tokyo.jp/` | 200    | 0        | あり           |
| 13208 | 調布市   | `https://www.city.chofu.tokyo.jp/`  | `https://www.city.chofu.lg.jp/`         | 200    | 0        | あり           |
| 13364 | 神津島村 | `https://vill.kouzushima.tokyo.jp/` | `https://www.vill.kouzushima.tokyo.jp/` | 200    | 0        | あり           |

計測条件: ブラウザ相当の User-Agent(当方の既定UAでは WAF が 403 を返す自治体があるため。
§3 の東村山市と同じ理由)、リダイレクトを追跡して最終URLと回数を記録、本文は
`Content-Type` / `<meta charset>` から文字コードを判定してデコードのうえ自治体名を照合。

これで **62自治体すべてが https** になった。`http://` は1件も残っていない。

リグレッション防止テストを現状に合わせて更新した。

- `http://` で残るものが**0件**であること(http への巻き戻りを検知する)。
- 上記3件が実測どおりの移転先を指すこと(出典の旧値への意図しない差し戻しを検知する)。
