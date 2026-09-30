# ADR-017: 独自ドメイン sumihajime.com に一本化する

- Status: **Accepted — 2026-10-01**
- Date: 2026-10-01
- 関連: ADR-008（正典は個人アカウントの Workers Free）、ADR-011（セキュリティヘッダと SPA フォールバック）

## Context

公開URLが `https://app.sumihajime.workers.dev` のままだった。ポートフォリオとして見せ、将来は事業者や自治体に
紹介してもらう前提では、プラットフォームのサブドメインは覚えにくく、サービスの入口として弱い。

候補は `sumihajime.jp` と `sumihajime.com`。.jp は国内の登録事業者で取得し、DNS を Cloudflare へ移し、
WHOIS の登録者名の非表示を別途申請する必要がある。.com は Worker と同じ Cloudflare アカウントで
仕入れ値（2026年時点で年 $10.46、更新も同額）で取得でき、DNS と証明書が自動で揃い、WHOIS の個人情報は
標準で伏せられる。行政の公式サイトは .lg.jp / .go.jp なので、.com は「非公式サービス」の打ち出しとも衝突しない。

## Decision

1. **`sumihajime.com` を Cloudflare Registrar で取得した**（2026-10-01、持ち主が購入）。正典の Worker に
   `sumihajime.com` と `www.sumihajime.com` を custom domain として割り当てる（`apps/api/wrangler.jsonc` の `routes`）。
2. **画面は独自ドメインへ 301 で一本化する**（`apps/api/src/canonical-host.ts`）。対象は旧URL（workers.dev）と
   www への GET / HEAD。トップ等の画面は静的配信で Worker を通らないため、`run_worker_first` に画面のパス
   （`SPA_ROUTES`）を並べて Worker が先に受ける。一致はテストで固定する。
3. **`/api/*` は転送しない。** 外形監視・評価の道具・デプロイ前に開いたタブが旧URLの API を叩いても、
   移行の間はどちらのホストでも同じ応答を返す（POST を 301 すると GET に変わる実装がある）。
4. **ミラー（ハッカソンの提供環境）は転送しない。** `CANONICAL_ORIGIN` を空にして、提供環境の URL のまま残す。

## Consequences

- 共有カードの画像、巡回の User-Agent、外形監視、評価の既定の宛先、README などを独自ドメインに変えた。
- 画面の要求が Worker を通るようになり、Workers Free の1日の要求数（10万）にわずかに近づく
  （ハッシュ付きの JS/CSS・画像は従来どおり静的配信のまま）。
- 旧URLの API はいずれ転送か廃止を決める。外部から旧URLで使われていないことを確かめてからにする。
