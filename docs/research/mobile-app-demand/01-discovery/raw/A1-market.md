# A1: Market Sizing & Economics: スミハジメ native app (iOS/Android)

Research date: 2026-09-30. Radical Honesty Protocol labels: **[Data]** = sourced figure; **[Estimate]** = arithmetic from [Data]; **[Assumption]** = my judgment, can't be checked yet. Tier 1 = government statistics, Tier 2 = large research firms and panels, Tier 3 = vendor, blog or marketing claims.
**OLD** = data more than 18 months old (before about 2025-03-30).

---

## 0. Bottom line (for the native-vs-web decision)

1. **The flow of movers is large and well measured.** In 2025, **1,080,856 people** filed a 転入届 at a Tokyo municipality. That counts moves from other prefectures, moves between municipalities inside Tokyo, and moves from abroad. The 24 municipalities that スミハジメ covers today received **866,481 (80%)** of them. Nationwide, 5.19M people moved between municipalities, plus 0.78M came from abroad. [Data, Tier 1]
2. **The need comes in short episodes, and almost everything else about app economics follows from that.** The average Japanese resident makes an inter-municipal move only about once every 24 years (the rate is 4.17%/yr). Movers are heavily concentrated among people aged 20–34. One move creates roughly a 6–8 week window of need. So even a healthy install base turns into a small number of users active at the same time. On the mid scenario (Tokyo, current coverage) that is about **1.3k–1.7k MAU on average and about 3k at the March–April peak**. [Estimate]
3. **Ads earn close to nothing per user**: about ¥0.5–21 per moving household, whether web or app. **Referral fees are real money per conversion**: ¥700–1,629 for a moving quote, about ¥5,000–18,700 for a fiber line, about ¥600–6,000 for electricity. Blended, that is about **¥50–500 per user** [Assumption on conversion rates]. On the mid scenario the result is about **¥0.5M–5M per year**, and that revenue is the same whether it comes through web or native. A native app only adds money if it brings in _additional_ users or conversions. No data found shows that it would.
4. **Behavior data cuts both ways.** Apps take 92% of smartphone _time_ (Nielsen, 2020, OLD). But the most common answer for how many apps people installed in the **last 3 months** is only **1–2** (40.8%; Repro, 2025-01). Task-type services such as restaurant search were historically used **browser-only by about 80% of users** (Nielsen, 2015, OLD). A once-per-several-years administrative checklist is the kind of task people reach through the browser.
5. For Market Sizing & Economics alone, **the numbers do not justify a native app on demand or revenue grounds**. They support improving the web app: PWA, calendar export, and optionally web push. They also support putting effort into B2B distribution through real-estate agents, moving companies and municipalities, which is where the lifeline and referral money already flows.

---

## 1. How many people need 転入届 procedures?

### 1a. Tokyo (2025, persons, includes foreign residents): Tier 1

Source: 東京都総務局統計部「東京都住民基本台帳人口移動報告（令和7年）結果のポイント」and statistical tables 1–14 (derived from the MIC 2025 report, published Feb 2026). https://www.toukei.metro.tokyo.lg.jp/jidou/ji-index.htm, https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji-point.pdf, https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji-data1.htm

| Flow into a Tokyo municipality (2025)       |                 Persons |   Of which Japanese | Source                     |
| ------------------------------------------- | ----------------------: | ------------------: | -------------------------- |
| From other prefectures (他道府県からの転入) | **451,843** (−2.1% YoY) |             397,985 | ji-point, table 1/4 [Data] |
| Between Tokyo municipalities (都内間移動)   |             **465,145** |             384,882 | ji-point, table 3 [Data]   |
| &nbsp;&nbsp;of which 区相互間               |                 306,398 |             243,036 | [Data]                     |
| &nbsp;&nbsp;of which 区部⇄市町村部          |                  95,674 |              83,834 | [Data]                     |
| &nbsp;&nbsp;of which 市町村相互間           |                  63,073 |              58,012 | [Data]                     |
| From abroad (国外からの転入)                |             **150,416** |              32,447 | table 14 [Data]            |
| Previous address unknown (その他)           |                  13,452 |                 825 | [Data]                     |
| **Total people filing 転入届 in Tokyo**     |           **1,080,856** | **816,139 (75.5%)** | [Estimate: sum]            |

- Tokyo's total 区市町村間移動者数 (which also counts people leaving) was 1,317,064 (−0.5% YoY). [Data, ji-point]
- Tokyo gained 65,219 more people than it lost (転入超過), the most of any prefecture, but 14,066 fewer than in 2024. This is the 12th straight year of net inflow. [Data, MIC 2025 概要 https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf, Feb 2026; also Nikkei https://www.nikkei.com/article/DGXZQOCC031RS0T00C26A2000000/]
- **Current coverage (23 wards + 八王子市):** the wards took 713,627 domestic in-movers and 八王子 took 24,002. The wards took 125,122 from abroad and 八王子 took 3,730. Total **866,481 = 80.2%** of all Tokyo 転入届. [Estimate from table 8 and table 14 Data]
  - Largest wards by domestic in-movers: 世田谷 57,653 / 大田 53,204 / 練馬 45,311 / 江戸川 44,928 / 杉並 42,212. [Data, table 8]
- 2024 for comparison: Tokyo 区市町村間移動者数 was 1,323,660 and in-movers from other prefectures were about 461k. [Data, TMG 2024; table 10 shows 他道府県間 inflow 461,454]

### 1b. Nationwide (2025): Tier 1

Source: 総務省統計局「住民基本台帳人口移動報告 2025年結果 結果の概要」(published 2026-02). https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf

| Metric                                      |                2025 |                             YoY |
| ------------------------------------------- | ------------------: | ------------------------------: |
| Inter-municipal movers (市区町村間移動者数) |       **5,190,548** |    −0.3% (3rd straight decline) |
| &nbsp;&nbsp;Inter-prefecture                |           2,515,731 |                           −0.3% |
| &nbsp;&nbsp;Intra-prefecture                |           2,674,817 |                           −0.4% |
| Japanese only, inter-municipal              |           4,528,254 |    −1.6% (8th straight decline) |
| From abroad (国外からの転入)                |             782,165 |                           +6.3% |
| **People filing 転入届 nationwide**         |          **≈5.97M** | [Estimate: 5,190,548 + 782,165] |
| Inter-municipal move rate                   | 4.17% of population |                            flat |

- 2024: 5,207,746 inter-municipal (−1.1%). [Data, MIC 2024 概要 https://www.stat.go.jp/data/idou/2024np/jissu/pdf/gaiyou.pdf, Jan 2025]
- **Not counted:** moves within the same municipality (転居届). These are outside the statistic by definition, so their volume is a DATA GAP. Those users need fewer procedures anyway.
- **Trend:** Japanese inter-municipal moves are shrinking (8 years of decline). The totals are held up by foreign residents. The Japanese-language addressable base is slowly contracting. [Data]

### 1c. Age concentration: Tier 1

- **Tokyo, in-movers from other prefectures in 2025:** 20–24 = 122,288; 25–29 = 111,683. **20代 = 51.8%**, 20–34 = 64.9%, 18–34 = 69.3%. Children aged 0–14 are only 5.4%, so family moves are a minority. [Estimate from TMG table 11, https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji25qv1100.csv]
- The single-year peak is age 22 (42,075 people), which is new graduates starting work. [Data, table 11]
- **Nationwide:** 20代 make up 44.5% of inter-prefecture moves, 37.3% of intra-prefecture moves and **40.8% of all inter-municipal moves**. The inter-prefecture move rate is highest at ages 20–24 (9.25%) and 25–29 (8.16%). [Estimate/Data, MIC 2025 概要 tables 4, 5, 26]

### 1d. Persons → households (DATA GAP, so an assumption is used)

- The statistics count **persons**, and the app's user is a **household or move event**. There is no Tier 1 count of moving households.
- One published figure says 年間の引越し世帯 is about 200万. It comes from dividing 5.25M movers by the _average_ household size of 2.60 (note.com, 2023-02-16, Tier 3, OLD: https://note.com/loha1234/n/nd197d5417116). **That contradicts the age data.** Movers are mostly single people in their 20s, and only 5–9% are children, so 2.6 persons per move is far too high.
- **[Assumption]** Persons per moving household = **1.3 for Tokyo** (range 1.2–1.5) and **1.4 nationwide** (range 1.3–1.5).

---

## 2. Seasonality: Tier 1

| Series (2025)                                    |           March |           April | Mar+Apr share |
| ------------------------------------------------ | --------------: | --------------: | ------------: |
| Tokyo in-movers from other prefectures (451,843) | 100,350 (22.2%) |          60,466 |     **35.6%** |
| Tokyo 都内間 moves (465,145)                     |          55,978 |          45,922 |         21.9% |
| Tokyo all domestic 転入 (930,440)                | 157,912 (17.0%) | 109,402 (11.8%) |     **28.7%** |
| Japan inter-municipal (5,190,548)                | 905,179 (17.4%) |         683,859 |     **30.6%** |
| Japan inter-prefecture (2,515,731)               |         518,532 |         368,109 |         35.2% |

Sources: TMG tables 1–3 (https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji25qv0100.csv, ji25qv0200.csv, ji25qv0300.csv). MIC monthly releases: March 2025 https://www.stat.go.jp/data/idou/rireki/2503/index.html (published 2025-04) and April 2025 https://www.stat.go.jp/data/idou/rireki/2504/index.html (published 2025-05-27).

- Implication: the busiest month carries about 2× the average monthly load. The trough months (Jan, Nov) carry about 0.6×. Any "active users" figure swings about 3× over the year. [Estimate]

---

## 3. Smartphones, app vs browser, installing apps, government apps

| Indicator                                                           | Value                                                                                                                                                                             | Source / date                                                                                                                               | Tier / flag                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Individual smartphone ownership (all ages 6+, non-response counted) | **80.5%**. Household ownership 90.5%                                                                                                                                              | 総務省 令和6年通信利用動向調査, published 2025-05-30 (survey Aug 2024) https://www.soumu.go.jp/johotsusintokei/statistics/data/250530_1.pdf | Tier 1                                                       |
| Smartphone internet use by age                                      | ages 20–59: "9割" in every age bracket. Tokyo smartphone internet use: 80.0% of all ages                                                                                          | same                                                                                                                                        | Tier 1 (exact 20代 figure is a chart image, so DATA GAP)     |
| Smartphone share among mobile-phone owners aged 15–79               | **98.3%** (2026), 98.0% (2025)                                                                                                                                                    | NTTドコモ モバイル社会研究所 2026-03-19 https://www.moba-ken.jp/project/mobile/20260319.html (n=6,748, Jan 2026)                            | Tier 2                                                       |
| iPhone vs Android                                                   | Overall Android 55.4% / iPhone 44.6%. **20代: iPhone ≈70%** (Android 32.6%). 30代: about 50/50                                                                                    | same                                                                                                                                        | Tier 2                                                       |
| Share of smartphone _time_ spent in apps                            | **92%** (apps used ≥ monthly: 34.6; daily: 8.8)                                                                                                                                   | Nielsen 2020-03-24 https://www.netratings.co.jp/news_release/2020/03/Newsrelease20200324.html                                               | Tier 2, **OLD**                                              |
| App share of time, earlier                                          | 85% (Jul 2017)                                                                                                                                                                    | Nielsen 2017-11-08 https://www.netratings.co.jp/news_release/2017/11/Newsrelease20171108.html                                               | Tier 2, **OLD**                                              |
| Task-type service: restaurant search                                | **~80% of users browser-only**, 6% app-only                                                                                                                                       | Nielsen 2015-04-21 https://www.netratings.co.jp/news_release/2015/04/Newsrelease20150421.html                                               | Tier 2, **OLD** (analogy)                                    |
| New installs                                                        | Most common answer is "**1–2 apps in the last 3 months**" (40.8%). App-store name search is the main path to install (54.3%). SNS/video ads are the top awareness trigger (39.1%) | Repro 2025-03-13, n=1,236, surveyed 2025-01-29–31 https://company.repro.io/press/pr/pr/20250313/                                            | Tier 3, borderline OLD                                       |
| マイナポータルアプリ cumulative downloads                           | **79.41M** (end of July 2026). Replaced by 「マイナアプリ」on 2026-08-25                                                                                                          | Business Insider Japan 2026-08-25 https://www.businessinsider.jp/article/2608-myna-app-renewal/                                             | Tier 2 (reported from デジタル庁). No MAU given, so DATA GAP |
| Movers' use of online 転出 (マイナポータル)                         | 38% knew the service before moving, 42% of those used it, so **≈16% of movers** [Estimate]. 88% of users found it convenient                                                      | 引越し侍 survey, n=4,340, Mar–Apr 2023 (page dated 2025-06-09) https://hikkoshizamurai.jp/report/report-20230516/                           | Tier 3, **OLD data**                                         |
| Resident use of regional/municipal DX apps                          | about 9% of residents. **~63% of users are 50+**                                                                                                                                  | DearOne (vendor), 2023-07-28, n=240 users https://moduleapps.com/mobile-marketing/24622rpt/                                                 | Tier 3, **OLD**                                              |

Takeaways:

- Nearly everyone in the core segment (20s–30s) owns a smartphone. Device reach is **not** the constraint. [Data]
- The constraint is **willingness to install an app for an occasional task**. The typical user installs about one new app every 1–3 months [Data, Repro]. Even the government's strongly promoted online 転出 reached only about 16% of movers in 2023 [Estimate, OLD].
- Municipal apps skew toward older users (63% aged 50+), while スミハジメ's movers skew young. There is no evidence that the young mover segment wants government-style apps. [Data, Tier 3, OLD]
- If a native app is built anyway, **iOS comes first** for the 20代 segment (about 70% iPhone). [Data, Tier 2]

---

## 4. TAM / SAM / SOM (users = moving households per year)

### (a) Tokyo-only

| Layer                            | Definition                                                             |                          Persons/yr |                                  Households/yr | Label                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------- | ----------------------------------: | ---------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TAM**                          | Everyone filing 転入届 at any of Tokyo's 62 municipalities             |                           1,080,856 |                          **≈830k** (720k–900k) | [Data] persons; [Estimate] households at 1.3 (1.2–1.5)                                                                                             |
| **SAM**                          | Covered 24 municipalities × Japanese nationals × smartphone owners     | 866,481 × 75.5% ≈ 654k × 98% ≈ 641k |                          **≈490k** (430k–540k) | [Estimate]. Applies the Tokyo-wide Japanese share to the covered area. Assumes a Japanese-only UI; if English is supported, SAM rises by about 30% |
| **SOM, whole product (web+app)** | Share of SAM a non-official, no-budget service can realistically reach |                                     |        **2.5k–25k/yr** (0.5%–5%; mid 10k = 2%) | [Assumption]. Benchmark below                                                                                                                      |
| **SOM, native app only**         | Share of product users who would install instead of using the web      |                                     | **≈10–30% of the product SOM** → 0.25k–7.5k/yr | [Assumption]. Based on 1–2 installs per quarter and browser-first behavior for tasks                                                               |

Benchmark for the SOM share:

- 「引越れんらく帳」 (TEPCO group, web-based, partnered with Tokyo, Saitama and Kanagawa, utilities and telcos) claims **"年間12万人が利用"**. Source: https://www.hikkoshi-line.com/ (undated, marketing claim, Tier 3).
- Against about 5.97M persons or about 4.0–4.6M households nationwide, that is **≈2.0% of persons or 2.6–3.0% of households** [Estimate].
- That is roughly the ceiling for a well-funded, utility-backed service. For a non-official newcomer, **0.5–2% is realistic and 5% needs a distribution partner** (a municipality, real-estate agent or mover) [Assumption].

### (b) Nationwide

| Layer   | Definition                                             |          Persons/yr |        Households/yr | Label                                                                                                             |
| ------- | ------------------------------------------------------ | ------------------: | -------------------: | ----------------------------------------------------------------------------------------------------------------- |
| **TAM** | Everyone filing 転入届 in Japan                        |              ≈5.97M | **≈4.3M** (4.0–5.0M) | [Data] persons; [Estimate] households at 1.4 (1.2–1.5)                                                            |
| **SAM** | Japanese nationals, inter-municipal, smartphone owners | 4.53M × 98% ≈ 4.44M | **≈3.2M** (3.0–3.7M) | [Estimate]. **Only addressable once all 1,741 municipalities' official data is maintained**; today 24 are covered |
| **SOM** | 0.5–2% of SAM                                          |                     |       **16k–64k/yr** | [Assumption]                                                                                                      |

Note: the national SAM is a _content_ problem, not a _channel_ problem. Collecting and keeping per-municipality official sources for about 1,700 municipalities costs far more than the choice between app and web.

### (c) Users active at the same time (the episodic problem)

- The need window runs from about 4 weeks before the move to about 4 weeks after. The statutory deadline for 転入届 is 14 days after moving (住民基本台帳法 第22条, https://laws.e-gov.go.jp/law/342AC0000000081, Tier 1; well-known legal requirement, URL not opened this session). Plus pre-move preparation and follow-up items (児童手当, 免許 and so on). That gives a window of **≈1.5–2 months per move** [Assumption].
- **Average MAU ≈ annual users × (1.5 to 2)/12 = 12.5–17% of annual users.** Peak-month MAU is about 2× the average (March holds 17% of annual domestic Tokyo 転入 vs 8.3% for an average month). [Estimate]

| Scenario (Tokyo, current coverage) | Product users/yr |        Avg MAU | Peak MAU (Mar–Apr) | Native-only avg MAU (10–30%) |
| ---------------------------------- | ---------------: | -------------: | -----------------: | ---------------------------: |
| Low (0.5% SAM)                     |             2.5k |       ~310–420 |               ~800 |                      ~30–125 |
| **Mid (2% SAM)**                   |          **10k** | **~1.3k–1.7k** |            **~3k** |                 **~130–500** |
| High (5% SAM, partner-driven)      |              25k |     ~3.1k–4.2k |                ~8k |                    ~310–1.3k |
| Nationwide mid (1% of 3.2M)        |              32k |       ~4k–5.3k |               ~10k |                    ~400–1.6k |

- There is hardly any repeat use. The average person makes an inter-municipal move about once every 24 years (4.17%/yr). Even at ages 20–29, the inter-prefecture move rate is only 8–9%/yr [Data]. A user who installs the app will likely **uninstall it or leave it unused for years**, so a store listing gets almost nothing from a retained base.
- App retention benchmarks were not verified: the web-search budget ran out. **DATA GAP.**

---

## 5. Monetization economics

### 5a. Ads: Tier 3

| Item                                  | Value                                                                     | Source                                                                                                                                                                                                                                                | Flag                                        |
| ------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Japan in-app eCPM, avg of iOS+Android | Rewarded **$10.80**, interstitial **$7.20**, banner **$0.10**             | Mistplay 2026-03-13 citing Appodeal 2025 report (data Oct–Dec 2024, mostly **games**) https://business.mistplay.com/resources/mobile-ads-ecpm/; Appodeal PDF https://appodeal.com/wp-content/uploads/2025/03/Appodeal-The-Latest-eCPM-Report-2025.pdf | Tier 3, **OLD** data period, game-heavy mix |
| Japanese web AdSense page RPM         | about ¥200–350 per 1,000 PV (general blogs); ¥1,000+ in high-value niches | Blog aggregations, e.g. https://nobutoblog.com/page-rpm/, https://saba.j-shimbun.com/article/adsenserpm.html (undated / 2022; **search-snippet only, pages not opened**)                                                                              | Tier 3, partly OLD, weak                    |

Per-household ad revenue [Estimate]:

- **[Assumption]** 10–20 sessions per move, 3 screens per session, ¥150/USD.
- App banner only: 30–60 impressions × $0.10/1000 → **¥0.5–1**. Adding 2–4 interstitials brings it to about ¥3–5. Interstitials in a deadline checklist harm trust and conflict with the product's positioning of official sources and handing the service to a municipality.
- Web: 30–60 PV × ¥200–350 RPM → **¥6–21**.
- **Ads come to ¥0.5–21 per household.** At the mid SOM of 10k that is ≈¥5k–210k per year. **Negligible, and the web earns more per user than a native banner.**

### 5b. Referral / affiliate: how moving services actually make money

| Lead type                                           | Publisher payout                                                                                                                                            | Source                                                                                                      | Flag                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Moving quote (引越し侍)                             | ¥1,000 (見積り申込, タウンライフ); **¥1,600–1,629** (一括見積, レントラックス); **¥3,800–3,870** (予約)                                                     | Affisearch https://media-analytics.jp/affisearch/promotions/hikkoshi-samurai (one entry updated 2023-11-02) | Tier 3, partly **OLD** |
| Moving quote (other aggregators)                    | ¥538–4,230 range, mostly ¥600–1,629. ズバット ¥700–770                                                                                                      | https://media-analytics.jp/affisearch/categories/hikkoshi (undated)                                         | Tier 3                 |
| Fiber internet (光回線)                             | **¥5,000–18,700** per opened line (SoftBank 光 ¥18,700; フレッツ光 ¥14,652; ドコモ光/OCN ¥12,380)                                                           | https://media-analytics.jp/affisearch/categories/hikari-kaisen (undated)                                    | Tier 3                 |
| Electricity switch                                  | ¥591–6,000 per contract (most ¥2,000–4,000; 東京電力 ¥4,000, 東京ガス ¥2,200–2,310)                                                                         | https://blogre.jp/electricpower-asp/ (2022-05-07)                                                           | Tier 3, **OLD**        |
| Lifeline referral (B2B, paid to real-estate agents) | **¥3,000 per referred tenant** (purchase type, no contract needed); electricity ¥3,000–4,000 and internet ¥4,000 on activation; "¥15,000+ total" per tenant | ノイアット 2025-06-12 https://www.noiat.co.jp/liveli/lifeline                                               | Tier 3                 |
| Lifeline referral (B2B)                             | "最高で8,000円" per referral, paid when the broker reaches the tenant by phone                                                                              | 日本情報クリエイト/Japan PropTech (undated) https://www.n-create.co.jp/pr/product/lifeline/                 | Tier 3                 |
| Fees moving companies pay to quote aggregators      | Not public                                                                                                                                                  | searched; nothing found                                                                                     | **DATA GAP**           |

Per-household referral revenue [Assumption on conversion; no public data, so DATA GAP]:

- Fiber 1–3% × ¥5k–18.7k, electricity 1–3% × ¥1k–4k, moving quote 2–5% × ¥0.7k–1.6k.
- Blended **≈¥50–500 per household**, central about ¥240.
- Timing risk: many people book a mover _before_ they look up administrative procedures, so moving-quote conversion may be lower.

Revenue scenarios (Tokyo, current coverage, whole product, not just the app) [Estimate]:

| Scenario | Users/yr |        Ads |                  Referral |           Total |
| -------- | -------: | ---------: | ------------------------: | --------------: |
| Low      |     2.5k |   ≈¥1k–50k |             ≈¥0.13M–1.25M | **≈¥0.1M–1.3M** |
| Mid      |      10k |  ≈¥5k–210k | ≈¥0.5M–5M (central ¥2.4M) |   **≈¥0.5M–5M** |
| High     |      25k | ≈¥12k–525k |             ≈¥1.25M–12.5M |  **≈¥1.3M–13M** |

- **These are the same whether users come through web or native.** A native app's _incremental_ revenue = (extra users or conversions it creates) × ¥50–500. If it mainly moves existing web users over, the incremental revenue is about ¥0.
- Store and developer program fees and the cost of building and maintaining two codebases were **not re-verified in this research**. Store review cycles also slow the release of urgent fixes to official information, which matters for the "last-verified date" principle. That is a qualitative cost.
- The largest economic signal is **B2B**. The lifeline-referral industry already pays real-estate agents **¥3,000 or more per tenant lead**. That puts the money on the side of whoever controls distribution at move-in, not on an app-store listing. This fits the roadmap: B2B through agents, movers and municipalities. [Data, Tier 3]
- **Principle conflict to note.** Referral income creates pressure on neutrality and privacy. The product collects no name, phone or email, but referral lead forms do. A municipal handoff would probably require removing referrals. ASP programs also require PR labeling under the stealth-marketing rules (ステマ規制) (Affisearch). Referral revenue is structurally at odds with the "municipality handoff" end-state.

---

## 6. Contradictions between sources

1. **Moving households: about 2.0M (note.com, OLD) vs 4.0–5.0M (this estimate).** The 2.0M figure divides persons by the _average_ household size of 2.6, but movers are about 52% in their 20s and only 5–9% children. I consider this estimate more consistent with the Tier 1 age data. Both numbers rest on an assumed household size, since no Tier 1 household count exists.
2. **"Apps = 92% of smartphone time" (Nielsen 2020) vs "~80% of restaurant-search users browser-only" (Nielsen 2015).** These do not conflict. Time share is dominated by LINE, YouTube and SNS, while entry into _occasional tasks_ goes through the browser. Both are OLD.
3. **Smartphone penetration: 80.5% (MIC) vs 98% (moba-ken).** The denominators differ. MIC counts all individuals aged 6+ with non-response included; moba-ken counts mobile-phone owners aged 15–79. For 20–30s, both point to about 90%+ reach.
4. **Japan banner eCPM $0.10 (Appodeal, games) vs web RPM ¥200–350 (AdSense blogs).** These are not like-for-like: page RPM includes several ad units and web display demand. Both show ads are small money per episodic user.
5. **引越し侍 claims "日本人の2人に1人" have used it** (search snippet, marketing claim). This is not verified and should not be used for sizing.

## 7. DATA GAPs

- Moving _households_ per year (Tier 1). Intra-municipal moves (転居届) volume.
- Exact smartphone ownership for 20代 from MIC (shown only as a chart image).
- Share of movers who would install a native app for procedures vs using the web. No direct survey found.
- Conversion rates for utility, fiber and moving referrals inside a procedures tool.
- App retention benchmarks, and MAU of マイナポータル/マイナアプリ and competing moving apps.
- Fees moving companies pay to quote aggregators.
- A dated, audited user count for 引越れんらく帳 (the "12万人/年" is an undated marketing claim).

---

## 8. Flags

### Red

- **R1: Episodic demand caps concurrent use.** Even the mid scenario gives about 1.3k–1.7k product MAU, and a native-only subset of about 130–500 MAU. Too few users are active at once to justify two native codebases on usage grounds. [Estimate]
- **R2: Native adds cost without adding monetization.** Ads come to about ¥0.5–21 per household. Referral revenue (about ¥50–500) is identical on web. There is no evidence that native raises either users or conversion. [Estimate/Assumption]
- **R3: Install friction meets a once-in-years task.** The plurality installs only 1–2 apps per quarter [Data, Repro]. Discovery for "転入 手続き" happens in search, which favors the web. [Analogy, OLD Nielsen]

### Yellow

- **Y1: The addressable base is slowly shrinking.** Japanese inter-municipal movers fell 1.6% in 2025, the 8th straight decline. Tokyo in-movers fell 2.1% and net inflow fell 18%. [Data, Tier 1]
- **Y2: Monetizing through referrals conflicts with product principles** (neutrality, no personal data, municipal handoff) and with PR-labeling rules. [Qualitative]
- **Y3: The nationwide SAM depends on the data pipeline**, not on the app. Covering 1,741 municipalities is the real bottleneck.
- **Y4: Several monetization and behavior sources are OLD or Tier 3**: Nielsen 2015/2017/2020, electricity affiliate rates from 2022, the Appodeal Q4-2024 game-heavy mix, the DearOne 2023 survey, and 2023 data in the 引越し侍 survey. Re-check before using any of them in a pitch.
- **Y5: Household conversion (1.2–1.5 persons per move) is an assumption.** It moves TAM by ±15%.
- **Y6: If a native app is still built for other reasons** (brand, municipality requirement), go iOS first (20代 about 70% iPhone). Ship it as a thin wrapper so data updates don't wait on store review.
- **Positive (green):** Tokyo's demand is large, measurable and highly predictable: about 1.08M 転入届 a year, 80% already in coverage, 29–36% in March–April. B2B lifeline economics (¥3,000+ per tenant lead) exist and are paid to whoever controls move-in distribution. That supports the B2B roadmap more than a consumer app.

---

## Sources (all accessed 2026-09-30)

- MIC 住民基本台帳人口移動報告 2025年結果 概要 (2026-02): https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf
- MIC 2024年結果 概要 (2025-01): https://www.stat.go.jp/data/idou/2024np/jissu/pdf/gaiyou.pdf
- MIC monthly: https://www.stat.go.jp/data/idou/rireki/2503/index.html, https://www.stat.go.jp/data/idou/rireki/2504/index.html
- TMG 東京都住民基本台帳人口移動報告 令和7年: https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji-point.pdf and tables https://www.toukei.metro.tokyo.lg.jp/jidou/2025/ji-data1.htm (ji25qv0100/0200/0300/0400/0800/1000/1100/1400.csv)
- Nikkei (2026-02): https://www.nikkei.com/article/DGXZQOCC031RS0T00C26A2000000/
- 総務省 令和6年通信利用動向調査 (2025-05-30): https://www.soumu.go.jp/johotsusintokei/statistics/data/250530_1.pdf
- モバイル社会研究所 (2026-03-19): https://www.moba-ken.jp/project/mobile/20260319.html; 白書2025: https://www.moba-ken.jp/whitepaper/wp25/chap1.html
- Nielsen: 2020-03-24 https://www.netratings.co.jp/news_release/2020/03/Newsrelease20200324.html; 2017-11-08 https://www.netratings.co.jp/news_release/2017/11/Newsrelease20171108.html; 2015-04-21 https://www.netratings.co.jp/news_release/2015/04/Newsrelease20150421.html; TOPS 2025 (2026-01-15) https://www.netratings.co.jp/news_release/2026/01/Newsrelease20230115.html
- Repro (2025-03-13): https://company.repro.io/press/pr/pr/20250313/
- Business Insider Japan (2026-08-25): https://www.businessinsider.jp/article/2608-myna-app-renewal/
- 引越し侍 survey: https://hikkoshizamurai.jp/report/report-20230516/
- DearOne/ModuleApps: https://moduleapps.com/mobile-marketing/24622rpt/
- 引越れんらく帳: https://www.hikkoshi-line.com/
- Mistplay/Appodeal: https://business.mistplay.com/resources/mobile-ads-ecpm/, https://appodeal.com/wp-content/uploads/2025/03/Appodeal-The-Latest-eCPM-Report-2025.pdf
- Affisearch: https://media-analytics.jp/affisearch/promotions/hikkoshi-samurai, https://media-analytics.jp/affisearch/categories/hikkoshi, https://media-analytics.jp/affisearch/categories/hikari-kaisen
- blogre (2022-05-07): https://blogre.jp/electricpower-asp/
- ノイアット (2025-06-12): https://www.noiat.co.jp/liveli/lifeline; 日本情報クリエイト: https://www.n-create.co.jp/pr/product/lifeline/
- note.com (2023-02-16): https://note.com/loha1234/n/nd197d5417116
- 住民基本台帳法 (e-Gov): https://laws.e-gov.go.jp/law/342AC0000000081
