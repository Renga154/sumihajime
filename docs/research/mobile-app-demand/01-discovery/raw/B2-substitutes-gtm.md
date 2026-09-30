# B2 (merged B2+B3): Indirect competitors, substitutes & go-to-market for a native iOS/Android version of スミハジメ

Research date: 2026-09-30. Method: read-only web research (WebSearch / WebFetch / public store lookup APIs). Radical Honesty labels: [Data] = sourced number/fact, [Estimate] = derived from data, [Assumption] = unsourced premise, [Opinion] = analyst judgement. **STALE** = source older than 18 months (before 2025-03-30). **DATA GAP** = not found and not guessed.

Caveat on search dominance: the WebSearch tool is not Google Japan. SERP observations below show what ranks on the tool's index, not measured Google JP positions or click share. No keyword-volume tool (Google Keyword Planner, App Store search popularity) was available → **DATA GAP** for absolute search volumes.

---

## 0. Market frame (for scale only)

- [Data] Tokyo received 451,843 in-migrants from other prefectures in 2025 (net in-migration 65,219). The 23 wards received 394,031. Source: 総務省統計局 住民基本台帳人口移動報告 2025年結果 (published 2026-02), https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf ; Nikkei summary https://www.nikkei.com/article/DGXZQOCC031RS0T00C26A2000000/
- [Data] Moving searches start rising in January and peak in March. The top-20 moving queries include 「引っ越し やること」「引越し 手続き リスト」「印鑑登録 引っ越し」「車庫証明 引っ越し」. People in their 40s and 50s make up a large share of these searches, which LINEヤフー reads as parents searching for their children. Source: LINEヤフー for Business, 2025-02-14, https://www.lycbiz.com/jp/column/ly-ads/searchads/service-information/search_trends_moving/ (**STALE** by 1.5 months, but seasonality is structural)

---

## 1. Substitutes people use instead of an app

| #   | Substitute                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Dominance (my read)                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Municipal pages for 転入 procedures + window guidance at the 区役所**                               | For a query like 「世田谷区 引っ越し 手続き やること 転入」, 5 of the 9 results were 世田谷区 official pages. The official pages include a 「転入・転居届に伴う関連手続きの案内」 page, https://www.city.setagaya.lg.jp/02233/84.html. The 転入届 can only be filed in person, so every in-mover meets staff once.                                                                                                                                                                                                                                                                                           | [Estimate] **Dominant for municipality-specific intent** and the final authority. Weakness: split across many pages, no personal deadline ordering.                                                                                                |
| 2   | **Municipal "procedure navigator" SaaS (question → list of procedures)**                              | Meguro links to **Graffer 手続きガイド** (ttzk.graffer.jp/ward-meguro). Kita links to 「くらしの手続きナビ」 at nicotto-navi.jp. Edogawa has its own 手続きナビ (updated 2026-04-05) with no private links. Graffer says it serves **200+ municipalities**, and its page lists **16 Tokyo entities** (undated). Sources: https://www.city.meguro.tokyo.jp/kurashi/hikkoshi/index.html , https://www.city.kita.lg.jp/living/registration/1001564/index.html , https://www.city.edogawa.tokyo.jp/tetsuzukinavi/hikkoshi/index.html , https://graffer.jp/governments/solution-guides , https://ttzk.graffer.jp/ | [Estimate] Present in a large minority of Tokyo municipalities. **This is the incumbent for the "hand over to a municipality" exit.** Municipalities buy it from vendors. They do not adopt free private apps.                                     |
| 3   | **Commercial SEO checklists** (SUUMO引越し, LIFULL/HOME'S, 引越し侍, 電力・ガス会社, 引越し業者 PDFs) | Query 「引っ越し 手続き チェックリスト 転入 やること 一覧」: all 9 results were commercial (日通 PDF, 中部電力カテエネ, SUUMO "2026年6月最新", idemitsuでんき, 関西電力, アート, HOME'S web + PDF, サカイ). None were municipal. Query 「上京 引っ越し 手続き 役所」: TEPCO×2, 引越し侍, SUUMO×2, 引越れんらく帳, UQ WiMAX and others. 引越し侍 has programmatic per-ward pages, e.g. https://hikkoshizamurai.jp/useful/procedure/prefecture-tokyo/setagaya/, which say 「掲載情報は2020年4月現在」 and are wrapped in 見積もり CTAs.                                                                        | [Estimate] **Dominant for generic "what do I need to do" intent.** Every result is a funnel to 見積もり or 電気/ガス/回線 sign-ups. The per-municipality pages are stale (2020), which is the gap スミハジメ targets.                              |
| 4   | **Lifeline one-stop portal 「引越れんらく帳」** (TEPCO i-フロンティアズ)                              | [Data] **4.4M+ unique users** in FY2023 (2023-04 to 2024-03), per the 2024-06-05 release https://www.tepco-if.com/info/3480 (**STALE**). Since 2024-03-01 it accepts online 転出届 and 来庁予定連絡 for all **1,741 municipalities** through NTT Data BizMINT and the マイナポータル API: https://www.nttdata.com/global/ja/news/topics/2024/022600/ (**STALE**).                                                                                                                                                                                                                                            | [Estimate] **The largest digital substitute** for the utilities and address-change half of the job. It has national brand reach and ranks for Tokyo-specific guides, e.g. https://www.hikkoshi-line.com/navi/decision/tokyo-moving-procedures.html |
| 5   | **Checklists and calls handed out by 不動産会社 / 管理会社 / 引越し業者**                             | See §2 and §3. Every major mover publishes a checklist, e.g. サカイ https://www.hikkoshi-sakai.co.jp/guide/checklist.html , アート 「引越便利帳」 https://www.the0123.com/benri/ , 日通 PDF. Moving companies use LINE for estimates (サカイ, アート). The 引越し侍 LINE gives away a 「やることリスト」 as a perk.                                                                                                                                                                                                                                                                                          | [Estimate] Reaches almost everyone who uses a mover or an agent, but the content is generic and not tailored to the municipality.                                                                                                                  |
| 6   | **Short video (TikTok / YouTube)**                                                                    | [Data] TikTok 「【引っ越し後】役所の手続き、一発で終わらせる方法3選！」 (@life_24g, 2023): **722,700 plays, 29,800 likes, 13,455 saves**. YouTube 「引越し決まったらやること25選」 (a real-estate channel, 2022-02-28): **424,595 views**. YouTube 「引っ越し前にやるべきこと6選」 (ハウスドゥ official, 2024-02-23): 16,325 views. Counts pulled from the page HTML on 2026-09-30.                                                                                                                                                                                                                          | [Estimate] Large reach among people in their 20s and a high save rate, which shows checklist intent. Content is generic and has no deadline tracking.                                                                                              |
| 7   | **Generative AI (ChatGPT, etc.)**                                                                     | [Data] Generative AI use in Japan was 38.9% overall and **53% among people in their 20s** (Sept 2025). The top use was 「情報収集、調べもの、検索内容の要約」 at 50.6% of users. NRC, https://www.nrc.co.jp/report/251009.html (2025-09, not stale). **DATA GAP**: no survey found on AI use for 転入 procedures specifically.                                                                                                                                                                                                                                                                               | [Estimate] A fast-growing substitute for young in-movers. It is the main threat to the "AI chat" part of スミハジメ, and it does not give deadlines grounded in official sources.                                                                  |
| 8   | **Notion / spreadsheet templates**                                                                    | Several free Notion Marketplace templates exist, e.g. https://www.notion.com/templates/moving , https://www.notion.com/templates/moving-todo , plus note.com write-ups.                                                                                                                                                                                                                                                                                                                                                                                                                                      | [Estimate] Niche (Notion users). Generic and not tied to a municipality.                                                                                                                                                                           |
| 9   | **Dedicated checklist apps** (the native-app benchmark)                                               | [Data, store lookups 2026-09-30] 引越し手続きガイド (PATHFINDER, iOS since 2018-12): **52 iOS ratings, Android 10K+**. らくらくMOVING (SAILING PAY FORWARD, 2022): **650 iOS ratings, Android 10K+**. 引越しやることナビ (キャリアインデックス, 2026-01): **7 iOS ratings, Android 500+**. 引越しAI秘書 by ミツモア (2026-01-06): **4 iOS ratings**. Solo-developer apps: 引っ越しTodo (individual developer, 2026-06): **0 ratings**; 引越しやることチェックリスト (StackWorks LLC, 2025-10): **2 ratings**. Sources: iTunes Lookup API (country=jp) and Google Play listings.                              | [Estimate] **Small.** After 7 years the best-known standalone checklist app has only 10K+ Android installs. Every commercial one earns money from 見積もり or lifeline referrals, not from the checklist.                                          |

**Ranking by reach (my synthesis)** [Estimate/Opinion]:

1. Commercial SEO articles (generic intent).
2. Municipal official pages and the window (specific intent, the final authority).
3. 引越れんらく帳 (4.4M UU/yr).
4. Agent and mover checklists plus lifeline calls (§2).
5. Short video.
6. Generative AI (rising).
7. Municipal procedure navigators.
8. Templates and dedicated apps (both tiny).

---

## 2. How existing moving-procedure services acquire users, and the money behind it

### 2a. Lifeline referral (取次) is the main economic engine of the move-in moment

- [Data] Referral fee to 不動産会社: **up to ¥8,000 per referral**, 買取型 (no signed contract needed; paid when the referral company reaches the tenant by phone), paid at the end of the following month. Source: 日本情報クリエイト (リアプロBB integration), https://www.n-create.co.jp/pr/product/lifeline/ (undated page). Other referral companies advertise both 買取型 and 成約型 models but do not publish amounts, e.g. レプリス https://www.lepris.co.jp/lifeline/
- [Data] **スマサポ (TSE Growth 9342)** runs 「サンキューコール」, a post-move-in call to new tenants made on behalf of 管理会社 that introduces internet, utilities and water servers. FY2025/9 figures: **285,404 contacts, ¥7,147 revenue per contact, ¥2.04bn revenue** out of ¥2.816bn total. Source: logmi Finance, 2025-11-19, https://finance.logmi.jp/articles/383226
  - [Estimate] Incumbents earn roughly **¥7,000 per new tenant** at exactly the moment スミハジメ targets, and they share part of it with the 管理会社. A free, ad-light tool that pays the 管理会社 nothing competes for the same "first week in the new home" attention.
- [Data] 引越れんらく帳 earns money through partner ads (e.g. CHEER証券 ad tie-up, 2024-06, **STALE**) on top of lifeline processing.

### 2b. Estimate-lead referral (一括見積もり)

- [Data] Published affiliate rates for moving-estimate leads: ズバット引越し比較 ¥700 per completed quote request; LIFULL引越し ¥1,000 per 一括見積 completed; 引越し侍 ¥1,000 (quote) to **¥3,870** (reservation) depending on the ASP; 引越し価格ガイド ¥1,629. Source: Affisearch aggregator, https://media-analytics.jp/affisearch/categories/hikkoshi (undated, fetched 2026-09-30; treat as indicative).
- [Data] Scale of the lead channel: at サカイ引越センター (818,932 moves in FY2025/3), the 「インターネット」 channel is **34.4% of revenue** (¥35.7bn) and 法人 (corporate relocation) is **50.8%**. サカイ applied 受注制限 on 一括見積サイト leads. Source: サカイ FY2025/3 決算説明会資料, https://www.hikkoshi-sakai.co.jp/ir/r2mrro00000013e1-att/20250514_fre.pdf
- [Data] 引越し手続きガイド, らくらくMOVING (about 60 movers), 引越しAI秘書 (ミツモア) and 引越しやることナビ (キャリアインデックス, which runs estimate sites) all bundle a free checklist with estimate or lifeline funnels. The checklist is the acquisition hook and the referral is the revenue.

### 2c. Municipal handouts

- [Data] 「くらしの便利帳」 booklets, produced by 株式会社サイネックス with municipalities and funded by business ads, are **handed to in-movers at the 転入 window** in many municipalities (e.g. 小平市 recruits advertisers for its 便利帳). Sources: https://www.scinex.co.jp/business/pppwork.html , https://www.city.kodaira.tokyo.jp/kurashi/054/054478.html
  - [Opinion] This is the only channel that reaches 100% of in-movers. Access requires a formal public-private partnership, which takes months and is procurement-bound. It is not realistic for a solo developer's first 1,000 users.

### 2d. Paid app acquisition

- [Data] Apple Ads, Japan, year to July 2026: **CPT $0.73, CPA $1.49, TTR 9.2%, tap-to-install CR 49.28%** (below the 62% global median). Source: Adapty, https://adapty.io/blog/apple-ads-benchmarks-2026/ (2026, all categories; no Japan Lifestyle split, so **DATA GAP** at category level).
  - [Estimate] 1,000 iOS installs would cost about **$1,500 (about ¥220K at ¥150/$)**, and only if enough App Store search volume exists for 「引越し 手続き」-type keywords. **DATA GAP**: no App Store keyword popularity data was obtained. The low rating counts of niche apps suggest the volume is small.

### 2e. SEO and content (how the checklist apps actually grow)

- [Estimate] Every scaled player (SUUMO, 引越し侍, LIFULL, electricity companies, 引越れんらく帳) acquires users through long-form SEO articles and funnels them to monetized actions. SUUMO, for example, shows its article as 「2026年6月最新」. The app store is not their main acquisition channel.

---

## 3. B2B distribution signals (不動産 / 管理会社 / 引越し業者 / 自治体)

### 3a. 管理会社 already push native "入居者アプリ", with weak uptake

- **totono (スマサポ):**
  - [Data] 300K cumulative downloads as of 2024-12-04 (https://prtimes.jp/main/html/rd/p/000000084.000049968.html, **STALE**).
  - [Data] FY2025: **83 client companies**, monthly price ¥468K per company, MRR ¥38.9M; Phase 2.0 (resident-facing monetization) **64,687 users, ARPU ¥103** (logmi 2025-11-19).
  - [Data] Public price: initial fee from ¥330,000, monthly from ¥143,000 (https://www.chintaikanri.biz/item/1419, per search snippet).
  - [Data] Store sentiment: **iOS 2.2★ (794 ratings), Android 1.5★ (298 reviews), 100K+ installs** (iTunes Lookup / Google Play, 2026-09-30).
- **くらさぽコネクト** (日本情報クリエイト, now Japan PropTech): **iOS 1.8★ (120 ratings)**. **GMO賃貸DX 入居者アプリ/Web** offers both an app and a web version (https://chintaidx.com/resident/); new client companies were announced on 2026-09-28 and 2026-09-30.
- **Uptake:**
  - [Data] Registration was about **30%** of tenants at four management companies using totono, くらさぽコネクト, パレット管理 and pocketpost home, even where registration was required. Source: 全国賃貸住宅新聞, 2022-01-31, https://www.zenchin.com/news/post-7018.php (**STALE**).
  - [Data] Newer: エスティケイ reached 56% of tenants on totono after 2.5 years (as of 2024-11), per https://trend.zenchin-fair.com/archives/23007 (search snippet; **STALE** by 4 months).
- **Retreat from native to LINE:**
  - [Data] **明和不動産管理 shut down its native resident app on 2023-12-31 and moved tenants to "入居者LINE"** (https://www.meiwakanri.jp/information/article/?id=yoy7tx1u0o, 2023-11-30, **STALE**).
- [Estimate/Opinion] Implications:
  - Management companies that already have a resident app or LINE would **embed a link or QR inside it** rather than ask tenants to install a second native app.
  - Tenants already rate forced apps poorly.
  - A web URL is the lowest-friction B2B unit. A native app adds nothing to the B2B pitch and adds a second install.

### 3b. Movers

- [Data] サカイ, アート and 日通 each publish their own checklist (web and PDF). アート's estimate app 「単身引越スイスイ！お見積り」 includes a TODO checklist (per https://www.homes.co.jp/hikkoshi/cont/prepare/hikkoshi_app/). サカイ and アート use LINE for estimates.
- [Opinion] Large movers keep the post-contract relationship in-house (their own checklist, option sales, reuse, 電気工事). A third-party app is unlikely to be pushed unless it pays them or reduces their workload. **DATA GAP**: no evidence found of any mover distributing a third-party procedure app.

### 3c. Municipalities recommending private services

- [Data] **Precedent exists but is narrow.** 川崎市 has officially promoted 引越れんらく帳 since 2025-03-03 for utilities and 転出届, with the disclaimer 「引越れんらく帳の操作方法や申請取消などを含む各種お問い合わせについては川崎市や区役所では回答ができません」. The page was published 2025-01-23 and updated 2026-05-01: https://www.city.kawasaki.jp/170/page/0000172462.html
  - [Opinion] The service is a TEPCO-group portal integrated with マイナポータル and dating back to 2002 and METI. That is a very different standing from a solo developer's non-official app.
- [Data] The Tokyo ward pages checked (目黒, 北, 江戸川) link only to their own or vendor navigators (Graffer, nicotto-navi). None links to a private checklist app.
- **DATA GAP**: no Tokyo ward link policy (外部リンク基準) was retrieved, because the search budget ran out. The neutrality stance is therefore inferred, not quoted.
- [Opinion] The realistic municipal path is a **procurement or partnership competing with Graffer-type SaaS**, where a web deliverable, not a native app, is the unit being bought.

### 3d. Watch item for B1 (direct competitor surfaced here)

- [Data] **くらしぽーたル** (株式会社ゼットリンカー), https://kurashi-portal.com/ :
  - covers **53 Tokyo + 33 Kanagawa municipalities**;
  - its procedure pages cite **official municipal URLs with 「確認日」 dates** (e.g. 港区, 確認日 2026-07-17);
  - the site was relaunched 2026-07-19;
  - **a native app is "in development"** (ごみ出し通知 etc.).
- [Opinion] This is a web-first competitor with near-identical "official source + checked date" positioning and wider coverage (86 vs 24 municipalities), also heading to native. Handing to B1 for a head-to-head.

---

## 4. Solo developer: which channel could bring the first 1,000 users, and does native help?

[Assumption] Target: 1,000 real users (not installs) within one spring season (Jan–Apr), zero or near-zero budget, one person.

| Channel                                                                                                                                                                         | Realistic yield to first 1,000                                                                                                                                                                                                                                                                                                                                                 | Web                                                          | Native                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Short video / SNS (TikTok, X, Instagram)** — 「上京したら14日以内にやること」 content aimed at students and new graduates, plus parents (the searchers aged 40–50)            | [Estimate] **Best free channel.** The sample TikTok got 722K plays and 13K saves. At a 0.1–0.3% click-through from views, one hit video could deliver about 700–2,000 visits. [Assumption] on CTR.                                                                                                                                                                             | Link opens instantly; no store step.                         | [Data proxy] Even high-intent App Store ad tappers in Japan install only **49%** of the time (Adapty). A "link in bio → store → install → open" flow loses roughly half or more. **Hurts.** |
| **Long-tail SEO** (「◯◯区 転入 手続き 期限」, per-municipality pages with checked dates)                                                                                        | [Estimate] Slow: 3–9 months to rank [Assumption]. Incumbent per-ward pages are stale (引越し侍 "2020年4月現在"), so there is a gap, but 引越れんらく帳, SUUMO and くらしぽーたル already occupy this space.                                                                                                                                                                    | Only the web is indexable.                                   | Store pages do not rank for these queries. **Irrelevant or hurts** if effort is diverted.                                                                                                   |
| **Small local 不動産仲介 / 管理会社 QR in the move-in packet**                                                                                                                  | [Estimate] 3–5 small agencies × 20–50 move-ins per month in peak season → about 200–700 handouts per season, perhaps 30–50% scanned [Assumption] → about 100–350 users. The agencies' incentive is weak because the lifeline call pays about ¥7–8K per tenant (§2a). Pitch it as complementary: no lifeline sales, and fewer "what do I do at the 区役所" calls to the agency. | A QR to a URL works on paper, LINE and inside resident apps. | Requires an install; tenants already reject forced apps (totono 1.5–2.2★). **Hurts.**                                                                                                       |
| **Universities / employers** (上京 students via student associations or clubs, new-graduate HR; 法人 is 50.8% of サカイ revenue, which shows relocation runs through companies) | [Estimate] One cooperative HR team or student group can move 100–500 users in a single March. **DATA GAP**: no data on HR onboarding packets that include procedure tools.                                                                                                                                                                                                     | Link in an onboarding email or Slack.                        | Install friction again.                                                                                                                                                                     |
| **Hackathon / Tokyo DX community, note / Qiita / X build-in-public**                                                                                                            | [Estimate] 100–500 early users, mostly curious rather than moving. Useful for feedback, weak for retention.                                                                                                                                                                                                                                                                    | Web demo shares instantly.                                   | TestFlight or store review adds delay.                                                                                                                                                      |
| **Apple Ads**                                                                                                                                                                   | [Estimate] About ¥220K for 1,000 installs if volume exists (it may not).                                                                                                                                                                                                                                                                                                       | n/a                                                          | The only channel where native is required. Paid, with a volume **DATA GAP**.                                                                                                                |
| **App Store organic discovery**                                                                                                                                                 | [Data] Solo-developer apps in this niche have 0–2 ratings. The seven-year-old category leader has 52 iOS ratings and 10K+ Android installs. [Estimate] Store organic would deliver **far fewer than 1,000 users per season** without SEO or ads.                                                                                                                               | n/a                                                          | **Does not deliver.**                                                                                                                                                                       |

**Verdict** [Opinion, moderate confidence]:

- The first 1,000 users come from **link-shareable channels**: short video, a QR in move-in packets, community or HR distribution, and long-tail SEO. A **web URL is the carrier** in every one of them.
- A native app **adds a lossy install step** (about 50% drop even for high-intent ad taps in Japan) to each of these channels. It unlocks only App Store organic, which is empirically tiny for this category, and paid Apple Ads.
- Native-only features (push reminders for 14-day deadlines, widgets, reliable offline use) are real retention benefits. Most can be approximated with the existing .ics calendar export and a PWA (Web Push on iOS works only for home-screen web apps, iOS 16.4+ [Data, general platform knowledge, not re-verified this session]).
- **Recommendation for GTM:** stay web-first for acquisition. Consider a native wrapper only once there is evidence that retained users want push reminders, or when a B2B partner explicitly asks for an SDK or app. None of the B2B signals found point that way; they point toward LINE, web and in-app links.

---

## 5. Red / Yellow flags

**RED**

1. **The move-in moment is already monetized at about ¥7,000 per tenant** (スマサポ ¥7,147 per contact across 285K contacts; referral fees up to ¥8,000 per referral to agents). The B2B buyers you plan to sell to are _paid_ by incumbents for the same attention. A free non-official checklist has no money to share, so "B2B as main business" faces an incentive mismatch unless the tool itself earns lifeline or estimate referral fees. That would clash with the non-commercial, official-source positioning and with the eventual municipal hand-over.
2. **Native app hurts the acquisition channels that actually work** (QR, link, short video, SEO), and store organic is empirically tiny (the category leader has 10K+ Android installs in 7 years; solo apps have 0–2 ratings).
3. **Municipal exit competes with procurement SaaS** (Graffer at 200+ municipalities and about 16 Tokyo entities, nicotto-navi, in-house navis). The only private-service endorsement found (川崎 × 引越れんらく帳) went to a TEPCO-group, マイナポータル-integrated service, and even then with a "we don't support it" disclaimer.

**YELLOW** 4. **A close web competitor exists and is going native**: くらしぽーたル covers 86 Tokyo and Kanagawa municipalities with official links and 確認日 dates, and has an app in development. This erodes the "only one with official sources and checked dates" claim. 5. **引越れんらく帳** (4.4M UU/yr, **STALE** figure) now does online 転出届 for all municipalities and ranks for Tokyo guides. It covers the utilities and address half of the checklist with a trusted brand. 6. **Generative AI** is used by 53% of people in their 20s, mainly for look-ups (NRC 2025-09). スミハジメ's AI chat is a thin differentiator unless the deadline logic and official citations are clearly better than ChatGPT's. 7. **Resident-app fatigue**: tenant registration is about 30% (**STALE** 2022) and totono is rated 1.5–2.2★. At least one 管理会社 abandoned its native app for LINE. Partners will likely want a link inside their LINE or app, not a new app. 8. **Seasonality**: searches peak in March and スマサポ revenue is concentrated in Q2–Q3. A launch that misses the Jan–Apr window loses most of a year of acquisition. 9. **DATA GAPs** that matter for the decision:

- App Store keyword search volume for 引越し/転入 terms;
- Google JP search volume and click share for per-municipality queries;
- share of in-movers who use ChatGPT for 転入 procedures;
- Tokyo ward external-link policies;
- evidence of movers or employers distributing third-party procedure tools.

---

## Source list (accessed 2026-09-30)

- 総務省統計局 住民基本台帳人口移動報告 2025年結果 (2026-02): https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf
- LINEヤフー for Business 新生活シーズン検索動向 (2025-02-14, STALE): https://www.lycbiz.com/jp/column/ly-ads/searchads/service-information/search_trends_moving/
- 世田谷区 転入・転居届に伴う関連手続き: https://www.city.setagaya.lg.jp/02233/84.html
- 目黒区 引越しの手続き (Graffer link): https://www.city.meguro.tokyo.jp/kurashi/hikkoshi/index.html
- 北区 引越し (nicotto-navi link): https://www.city.kita.lg.jp/living/registration/1001564/index.html
- 江戸川区 手続きナビ 引越し (updated 2026-04-05): https://www.city.edogawa.tokyo.jp/tetsuzukinavi/hikkoshi/index.html
- Graffer 手続きガイド (undated): https://graffer.jp/governments/solution-guides ; https://ttzk.graffer.jp/
- 川崎市 引越しに関連する手続 (updated 2026-05-01): https://www.city.kawasaki.jp/170/page/0000172462.html
- TEPCO i-フロンティアズ, 引越れんらく帳 × CHEER証券 (2024-06-05, STALE): https://www.tepco-if.com/info/3480
- NTTデータ × 引越れんらく帳 BizMINT (2024-02-26, STALE): https://www.nttdata.com/global/ja/news/topics/2024/022600/
- 引越し侍 世田谷区 手続き先リスト (data "2020年4月現在"): https://hikkoshizamurai.jp/useful/procedure/prefecture-tokyo/setagaya/
- SUUMO引越し やることチェックリスト: https://hikkoshi.suumo.jp/oyakudachi/1231.html
- 日本情報クリエイト ライフライン取次 (up to ¥8,000): https://www.n-create.co.jp/pr/product/lifeline/
- 日本情報クリエイト column on lifeline referral (2022-01-28, STALE): https://www.n-create.co.jp/pr/column/business-efficiency/life_line_service/
- レプリス ライフライン取次: https://www.lepris.co.jp/lifeline/
- logmi Finance スマサポ FY2025 (2025-11-19): https://finance.logmi.jp/articles/383226
- PR TIMES totono 30万DL (2024-12-04, STALE): https://prtimes.jp/main/html/rd/p/000000084.000049968.html
- 全国賃貸住宅新聞 入居者アプリ比較 (2022-01-31, STALE): https://www.zenchin.com/news/post-7018.php
- 賃貸トレンド totono事例 (2024-11 data, STALE): https://trend.zenchin-fair.com/archives/23007
- 明和不動産管理 入居者アプリ終了 (2023-11-30, STALE): https://www.meiwakanri.jp/information/article/?id=yoy7tx1u0o
- GMO賃貸DX 入居者アプリ/Web: https://chintaidx.com/resident/
- サカイ引越センター 2025年3月期決算説明会資料 (2025-05-14): https://www.hikkoshi-sakai.co.jp/ir/r2mrro00000013e1-att/20250514_fre.pdf
- サイネックス わが街事典 (官民協働): https://www.scinex.co.jp/business/pppwork.html ; 小平市 便利帳広告: https://www.city.kodaira.tokyo.jp/kurashi/054/054478.html
- Affisearch 引越しアフィリエイト (undated): https://media-analytics.jp/affisearch/categories/hikkoshi
- Adapty Apple Ads benchmarks 2026 (data to 2026-07): https://adapty.io/blog/apple-ads-benchmarks-2026/
- NRC 生成AI 2025年9月調査: https://www.nrc.co.jp/report/251009.html
- くらしぽーたル (relaunched 2026-07-19): https://kurashi-portal.com/ ; https://kurashi-portal.com/tokyo/minato/tetsuzuki
- 引越し手続きガイド: https://www.hikkoshi-guide.jp/
- App Store (iTunes Lookup API, country=jp) IDs: 1447039435, 1597858051, 6754363723, 6755713539, 6759312349, 6753204141, 1515211377, 1420383637
- Google Play: jp.co.p_finder.android.hikkoshiguide, com.raku_m, jp.co.careerindex.door.hikkoshi, jp.co.sumasapo.totono
- TikTok @life_24g video 7205587895472704776; YouTube ZcrxYjC-Qow, Dg5cAAQZMow (view counts read from page HTML)
- Notion templates: https://www.notion.com/templates/moving , https://www.notion.com/templates/moving-todo
