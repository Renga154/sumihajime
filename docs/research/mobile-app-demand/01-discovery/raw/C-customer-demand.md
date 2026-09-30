# Research C — Customer Voice, Pain Points, Demand Signals & Audience

Idea under test: native iOS/Android version of スミハジメ (currently a free web app, no login, 24 of 62 Tokyo municipalities).
Research date: 2026-09-30. Read-only web research by research agent C. Radical Honesty Protocol labels: [Data] / [Estimate] / [Assumption] / [Opinion]. STALE = older than 18 months (before about 2025-03-30).

## 0. Method and limits (read first)

- Sources: Yahoo!知恵袋 (question text), App Store reviews pulled raw from Apple's public RSS/lookup API (so the review text is exact), Google Play store pages (download bands), Google Trends (the unofficial explore API, JP, 5 years, weekly), Google autocomplete, note.com, official ward pages, e-Stat/統計局 PDF, PR TIMES surveys.
- **DATA GAP: X/Twitter, Instagram and TikTok.** Posts were not reachable (login walls, no search indexing). I have **no** social-media quotes, and I did not substitute invented ones.
- **DATA GAP: はてなブログ/はてブ and 教えて!goo.** No usable first-person hits came back before the session-wide WebSearch budget (200 calls, shared with other agents) ran out partway through Round 4.
- Quote handling: to respect copyright limits, each quote is cut to a **short key phrase (one per source)** and the rest is paraphrased. App Store phrases are exact (raw API). 知恵袋/note phrases came through an automated page fetcher that was told to return verbatim text. Spot-check them before putting any in a public deck.
- Survivorship bias: app reviews come from people who installed an app, so they over-represent pro-app sentiment. 知恵袋 posts over-represent people already in trouble.

---

## 1. Pains with quotes (grouped, with frequency / intensity)

Intensity scale: H = money lost, legal risk or a repeat trip; M = hours lost or anxiety; L = mild annoyance.
Frequency comes from what recurred across my sample. It is not a measured population rate unless marked [Data].

### P1. 「何が必要か分からない / 何から」 — Don't know what applies to me. Frequency: very high. Intensity: M.

- [Data] Survey (いえらぶ, 2024-02, n=1,554 incl. 1,184 end users): **93.0%** found moving notifications (届出) 面倒 or やや面倒, and 94.9% said the same of utility switching. **STALE (31 months).** https://ielove-cloud.jp/blog/entry-04770/
- [Data] Survey (SUUMO 独自調査, 2024-03-07, n=500, ages 18–64): the "most troublesome procedure" was 住所変更に関するもろもろの届け出. **STALE.** https://hikkoshi.suumo.jp/oyakudachi/procedure
- Quotes:
  1. 「初めての引越しでわからないことが多すぎるので質問させてください。」— new graduate, 知恵袋, 2023-02-15. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12275602407
  2. 「転入届ってなんですか??」— first-year student who just moved to 三鷹市, 知恵袋, 2024-03-25. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13295493973
  3. 「あまりにもやることが多すぎて絶望していたのですが」— App Store review of らくらくMOVING, 2024-11-22.
  4. 「何から手を付ければいいのかわからず不安でしたが」— App Store review of らくらくMOVING, 2025-10-09.
  5. 「webでやることを調べても自分に関係ない手続きがたくさんあって読むのも嫌になっていた」— App Store review of 引越しAI秘書 by ミツモア, 2026-01-09. **Key signal for personalization.**
- In らくらくMOVING's 24 written reviews, 7 are about being a first-time mover or not knowing what to do (keyword count) [Data, small n].

### P2. 期限を知らなかった / 過ぎた — Missed or unknown deadlines (14 days, 15-day rule, 90 days). Frequency: high. Intensity: H.

- Quotes: 6. 「転入届を14日以内に出すのを知らず、今日で15日目です。」— 知恵袋, 2024-03-10. The same post mentions fear of マイナンバーカード失効 and a 5万円 fine. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14294732029 7. 「マイナンバーカードを引っ越しの時に切り替えが間に合わず失効して」— 知恵袋, 2026-03-06. The writer then needed the card for NISA. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10325999025 8. 「引っ越してから手続きしないで1年程経ってしまいました。」— マイナンバーカード address change, 知恵袋, 2024-02-15. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10293465870 9. 「引越してから1ヶ月経ちますが、まだ転出、転入届の手続きを行っていません。」— 知恵袋, 2021-09-17, **STALE.** https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13249503498 10. 「あるものは14日でカチッと音を立てて締め切られ、あるものは3ヶ月間猶予がある。」— note (single mother writing about procedure tips), 2026-03-16. https://note.com/mai_life_5656/n/nbb37e4a4c738
- [Data] Survey (大阪ガス, n=472, page dated 2026-07-14; the survey period is not stated) on things people forgot and regretted: 郵便転送 15%, 銀行/カード住所変更 12%, 転出届 9%, 免許住所変更 7%, マイナンバーカード住所変更 3%, 転入届 2%. 児童手当 did not make the list. https://home.osakagas.co.jp/column/moving/moving-data/moving-regret-data/ → [Opinion] The biggest forgetting is in private-sector address changes. Missed government deadlines are rarer but cost more when they happen.
- [Data] Children: 児童手当 has a 15日特例. Applying late means payments start the month after the application and are **not back-paid**. Lost months are real money. (Multiple secondary sources; 江戸川区 FAQ https://www.city.edogawa.tokyo.jp/e049/qa/kosodate/kosodate/teate/teate020.html)

### P3. 区ごとに違う — Rules differ by municipality. Frequency: medium. Intensity: M–H.

11. 「登記簿謄本か売買契約書が必要な区域でした。」— new 江戸川区 resident renting, confused by the required documents, 知恵袋, 2024-03-20. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11295231476
12. 「氏名の表記ルールが区によって違うのに戸惑った。」— Taiwanese resident, 東京都国際交流委員会 hearing survey, **2018, STALE.** https://tabunka.tokyo-tsunagari.or.jp/info/files/a70d5ac7db12bd5c538a3b38f2a01613c262657e.pdf
13. 「自治体の窓口で質問し忘れてしまった為」— moved 横浜市→豊島区, unsure which city pays July's 児童手当, 知恵袋, 2025-07-01. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11316959806

### P4. 窓口で二度手間 / 待ち時間 — Repeat trips and long waits. Frequency: high in Mar–Apr. Intensity: M.

14. 「受付から手続きが終了するまでに3時間以上かかることがあります」— 練馬区 official page, updated 2026-03-29. https://www.city.nerima.tokyo.jp/kurashi/koseki/oshirase/kuminzimusyo-konzatu.html
15. Online 転出 whose status is not yet 完了 gets turned away at the counter: 「完了になってから来てくださいね～」と門前払い. note, 2024-10-07. https://note.com/sakurabar/n/n18755936b5a9
16. 「アプリだけでは完結しなかった。二度手間。」— App Store review of 東京都水道局アプリ, 2024-12-19.

- In 東京都水道局アプリ reviews, **23 of 55** moving-related reviews end with 「電話」, meaning the user had to phone after all [Data].

### P5. 忙しくて行けない (平日) — Can't get there on weekdays. Frequency: medium. Intensity: M.

17. 「仕事が休めず平日の時間内に訪庁出来ないので」— 知恵袋, 2023-10-20. https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11287747156
18. 「新入社員でいきなり有給は使いづらいという現状です。」— 知恵袋, **2013, STALE** (the pain likely persists). https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10106700285

### P6. Family-specific: 保育・児童手当・医療証. Frequency: lower in volume, highest in stakes. Intensity: H.

19. 「希望の園は今満員ですと言われました。」— mid-year daycare transfer, 知恵袋, 2022-09-28, **STALE.** https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14268734109

- [Data] 2018 foreign-resident hearing (n=100, **STALE**): 36% overall reported trouble with 役所の手続き, rising to **45.0% of those raising children** and 47.8% of family households without a Japanese member. Medical care trouble was 72.5% for those raising children.

### P7. Foreign residents: didn't know a procedure existed. Intensity: H.

20. 「引っ越し前に転出届を出す必要があることは知らなかった。」— Mexican resident, same 2018 report, **STALE.**

### P8. Lead-gen apps leak personal data (a pain about the _tools_, not the procedure)

21. 「翌日からいろんな業者から電話がかかって来ます。」— App Store review of 引越し手続きガイド, 2023-03-17. Three other 1-star reviews (2021–2023) report the same flood of sales calls or a suspicious bill.

---

## 2. Jobs-to-be-done

1. **"Tell me only what applies to _my_ move, by when."** (P1, quote 5). Core job. The web app already does this.
2. **"Don't let me lose money or eligibility"** (児童手当 month, マイナカード失効, 国保 gap). Needs deadline awareness _after_ the move, which is when forgetting happens.
3. **"Get everything done in one trip to the ward office."** (P4, quote 10's 同じ建物にいる間に全窓口). Needs a list of what to bring and which counters to visit, usable _at the counter_.
4. **"Coordinate with my partner."** Two separate app reviews (2022-03-16, 2024-06-18) ask for 家族で共有.
5. **"Do it without being sold to."** (P8). Implicit job: no registration, no phone number.

## 3. Language map (exact words people use)

| Concept      | Words users use                                                                                 | Notes                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Moving       | 引っ越し ≫ 引越し (search volume about 2.5:1 in Trends), 上京, 転勤                             | Trends: 引っ越し 手続き avg 13 vs 引越し 手続き avg 5         |
| The list     | やることリスト, やること, 手続き 一覧, チェックリスト, ToDo/タスク, ミッション (らくらくMOVING) | 一覧 and やること are rising queries; "アプリ" rarely appears |
| Feelings     | 面倒/めんどくさい, 多すぎ, 絶望, 不安, 焦る, 何から, わからない, パンク                         |                                                               |
| Deadlines    | 14日以内, 過ぎた, 過ぎてしまった, 失効, 罰金/過料, 間に合わない, いつまで                       | 罰金 is a common misword for 過料                             |
| Counter      | 区役所/市役所, 窓口, 持ち物, 必要なもの, 二度手間, 門前払い, 待ち時間                           | 転入届 必要なもの is the #1 autocomplete                      |
| Online       | マイナポータル (rising sharply), 引越しワンストップ, オンライン                                 |                                                               |
| Children     | 児童手当, 15日, 医療証, 転園, 子ども関係の手続き                                                |                                                               |
| App aversion | 即削除, しか使わない, わざわざアプリ, 電話した方が早い                                          |                                                               |

## 4. Unmet needs

- **Post-move deadline follow-through** (days 1–15 and day 90). Every checklist tool covers the lead-up to the move. The costly misses happen after it (児童手当 15日, マイナカード継続利用 90日). [Opinion]
- **Municipality-specific requirements**, such as documents and 氏名表記. Generic national apps can't answer quote 11. スミハジメ's official-source-per-ward model is aimed exactly here. [Opinion]
- **Household sharing** without an account. [Data: 2 requests in reviews]
- **No sales funnel.** Every incumbent app earns from leads (utility switching, moving quotes), and users punish that in reviews. [Data]
- **Foreign-language support.** Web search is the first move for foreign residents (63/100 search in Japanese, 63/100 in English), against **22/100 who use an app** (2018 report, STALE). [Data]

---

## 5. Round 2 — Evidence about wanting an app, and about not wanting one

### For (want reminders / tick-off / app)

- 「何をいつまでにやるのか教えてくれるから」— らくらくMOVING review, 2022-02-03. Also 2026-04-07 「いつまでにとか理解できてはかどった」, and 2023-02-10 「忘れていた事を思い出させてくれて」. People value **deadline visibility**. None of the 24 reviews mention the words 通知, リマインド or オフライン. [Data] → Deadline visibility is validated. _Push_ notifications specifically are **not** validated.
- Tick-off satisfaction (「チェックして消してくのが快感」) appears only in 引越しやることナビ reviews, and those look promotional: 7 ratings, all posted within weeks of launch in marketing language. **Treat as weak.**
- Episodic re-install: 「毎回、引越し時期になるとアプリをダウンロードしています。」(引越し手続きガイド, 2026-03-07). Some users do install _per move_.
- [Data] 東京都水道局アプリ: 500k+ Android downloads and 60,258 iOS ratings. People **will** install a Tokyo-government app when it is the only way to finish a moving task. The web version was shut down in 2022-10 and users were pushed to the app.

### Against (aversion, uninstall)

- [Data] System Research survey (2026-08-20, n=300, ages 20–60, published 2026-08-29), on what people do when a service requires an app: 53.0% 必要ならダウンロード, **27.3% できればしたくない**, **14.7% 利用を諦めることがある**, only 5.0% 抵抗なく. Reasons not to download: 使わないアプリが増える 57.1%, 個人情報 40.5%, 容量 38.9%, 通知が増えそう 33.3%. Reason to delete: 利用しなくなった 67.7%. https://prtimes.jp/main/html/rd/p/000000240.000144334.html
- [Data] アイリッジ survey (2022-12, n=442, **STALE**): 62% had uninstalled an app within 7 days. Login or registration requirements drove deletion among younger users. https://iridge.jp/news/202212/33343/
- 東京都水道局アプリ reviews (latest 350 via RSS): 55 are moving-related, and **44 of those 55 (80%) are 1-star** [Data]. Short phrases:
  - 「こんなアプリ引越しの時くらいしか使わないのに」(2023-07-06)
  - 「わざわざアプリにする必要性を全く感じない。」(2023-05-10)
  - 「継続して利用するアプリでは無いと判断して星１にしました。」(2022-11-12)
  - 「即削除しました。」(2023-01-19)
- **DATA GAP**: no direct evidence either way on offline use at the counter. Nobody in the sample asked for it.

## 6. Round 3 — Demand signals

### Google Trends (JP, 2021-09 → 2026-09, weekly; pulled 2026-09-30 via the unofficial API) [Data]

- 「引っ越し 手続き」: stable, with yearly averages of 12.6 / 13.2 / 12.8 / 11.9 / 13.7 (2022→2026 YTD). Seasonality index: **March 1.69×, February 1.30×, December 0.79×**. The peak was the week of 2026-03-22 (27 vs a 13 average).
- 「転入届」: March index **2.32×**. It is 2× the volume of 「引っ越し 手続き」 (avg 28 vs 13).
- 「引っ越し やること」: the largest term (avg 52), but **falling**: 58.1 (2023) → 48.8 (2025) → 38.5 (2026 YTD, which already includes the March peak). [Estimate] This may reflect AI assistants taking over "what should I do" queries. That hurts SEO for the web app and store search alike.
- **「引っ越し 手続き アプリ」 and 「引越し 手続き アプリ」 register 0** (below the Trends threshold) next to 「引っ越し やること」 at 52. 「引っ越し チェックリスト」 is about 1.
- Related queries for 「引っ越し アプリ」: the top result is **データお引っ越しアプリ** (phone data transfer), not moving procedures. → There is essentially **no search demand for a moving-procedure app** as such.
- Rising related queries for 「引っ越し 手続き」: マイナポータル (急激増加), 県外に引っ越し 手続き 市役所 (+800%), 手続き 一覧 (+250%), マイナンバーカード 引っ越し 手続き (+200%), 必要なもの (+110%).

### Autocomplete proxy (Google JP, 2026-09-30) [Data]

- 「引越し 手続き アプリ」 returns only 3 suggestions, one of them 「東京 アプリ 引っ越し 手続き」.
- 「引越し チェックリスト」 suggests **pdf, 印刷, スプレッドシート, エクセル** alongside アプリ. People want portable formats, not specifically an app.

### App-store proxy (App Store JP lookup API and Google Play, 2026-09-30) [Data]

| App                                              | iOS ratings (avg) | Android downloads | Since   |
| ------------------------------------------------ | ----------------- | ----------------- | ------- |
| らくらくMOVING (lead-gen, utilities)             | 650 (4.6)         | 1万+              | 2022-02 |
| 引越し手続きガイド (PATHFINDER, quotes lead-gen) | 52 (3.4)          | 1万+              | 2018-12 |
| 引越しAI秘書 by ミツモア                         | 4 (4.25)          | 5,000+            | 2026-01 |
| 引越しやることナビ (CareerIndex)                 | 7 (4.29)          | 500+              | 2026-01 |
| ≥10 indie checklist apps launched 2025–2026      | 0–2 each          | —                 | —       |
| 東京都水道局アプリ (the forced channel)          | 60,258 (4.48)     | 50万+             | 2022-09 |
| 東京都公式アプリ (東京アプリ)                    | 11,517 (3.90)     | 100万+            | 2025-02 |
| SUUMO (property search)                          | 384,111           | —                 | 2010    |

- Reading: about **400k domestic in-migrants to Tokyo every year** [Data], yet the best dedicated moving-checklist app has 650 iOS ratings after 4.5 years. [Estimate] That implies low tens of thousands of lifetime installs, with category leaders reaching well under 1% of movers. The ≥10 zero-rating 2026 launches show that supply is easy to build and demand/discovery is the bottleneck.

### Demand-signal verdict

| Signal                                             | Rating                 | Why                                                                                                                                   |
| -------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pain around moving procedures                      | **Strong**             | 93% say it's troublesome (STALE); stable Trends volume; recurring money and legal consequences                                        |
| Demand for a _personalized, deadline-ordered list_ | **Moderate–Strong**    | 一覧/やること/必要なもの are rising; reviews praise "only what's relevant" and "by when"                                              |
| Demand for a _native app_ specifically             | **Weak**               | "アプリ" queries are near zero; small install bases; 42% of people resist or abandon required apps; one-time-use aversion is explicit |
| Demand for push reminders                          | **Weak / unvalidated** | 0 mentions in reviews. Deadline _visibility_ is valued, but .ics may already cover it                                                 |
| Demand for offline use at the counter              | **DATA GAP**           | No evidence found                                                                                                                     |

## 7. Round 4 — Audience

- [Data] 2025 住民基本台帳人口移動報告 (published 2026-02): **397,985 Japanese in-migrants to Tokyo** from other prefectures, down 2.4% YoY. Net in-migration was 65,219 including foreign nationals. Tokyo's total 社会増加 (including arrivals from abroad) was 125,457. **20–24-year-olds make up the bulk of net inflow (+57,263). Ages 0–9 and 35+ were net outflow.** Intra-Tokyo moves between municipalities, which also need 転入届, are not counted here (DATA GAP). File: 2025gaiyou.pdf, stat.go.jp.
- [Data] Seasonality: in March+April 2023 Tokyo had 161,207 in-migrants (統計Today No.194, **STALE**, but the pattern is structural). [Estimate] That is roughly 35–40% of the annual total, concentrated around 進学/就職.
- [Data] Foreign residents: 外国人 inter-prefecture movers hit a record 367,402 nationally in 2025 (+9.8%). Tokyo itself turned to net _outflow_ of foreign domestic movers in 2025, but arrivals from abroad keep growing. Tokyo's foreign population was about 647k (4.7%) in 2024, per secondary sources.
- Segments:
  | Segment                                                  | Size                                                   | Pain depth                                                               | Likely to install an app?                                                                                         |
  | -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
  | 20–24 students/new grads (進学・就職)                    | Largest                                                | Medium (few procedures, but confusion is high: quotes 1, 2)              | Low: one move, lists are free, highly app-averse per survey                                                       |
  | 転勤 singles/couples                                     | Medium                                                 | Medium; weekday time is the pain (P5)                                    | Low–medium                                                                                                        |
  | **Families with children (転勤 or 住み替え into Tokyo)** | Smaller gross inflow (net outflow for ages 0–9) [Data] | **Highest**: 児童手当 15日, 医療証, 保育 転園, 学校, plus money at stake | **Medium–high**: two adults coordinate, a longer tail of deadlines runs 90 days to a year, repeat movers (転勤族) |
  | Foreign residents                                        | Growing                                                | High (language, didn't-know-it-exists)                                   | Medium; mostly web-search first (2018 data)                                                                       |

## 8. Target segment for a native app (recommendation)

[Opinion] If a native app is built at all, target **families with children moving into Tokyo, especially 転勤族**, and position it as the "after-the-move deadlines + household sharing" companion, not as a pre-move checklist. Reasons: highest money-at-stake pains (児童手当 months are not back-paid), a multi-week tail that justifies a persistent home-screen presence, two-person coordination (explicit review requests), and repeat moves. Students and new grads are the biggest volume but the least app-willing, and the web app plus .ics serves them adequately. Foreign residents are a strong _web_ (multilingual) segment before they are an app segment.

## 9. Red / Yellow flags

- 🔴 **No search demand for "procedure app".** Trends shows about 0, and 「引っ越し アプリ」 means phone data transfer. Store discovery will be weak without paid acquisition or an official channel. [Data]
- 🔴 **One-time-use aversion is explicit and measured.** 42% resist or abandon required apps (2026-08); 東京都水道局 reviews say 「引越しの時くらいしか使わない」 and 「即削除」. [Data]
- 🔴 **Incumbent ceiling.** Funded, lead-gen-backed apps reach about 1万+ Android downloads. A free, non-official app with no marketing budget should expect less. [Estimate]
- 🟡 **Push notifications and offline use are not validated.** Zero mentions in reviews. Don't build them on assumption. [Data/Assumption]
- 🟡 **The official channel could absorb this.** 東京都公式アプリ (100万+ downloads) says it will add features 段階的に. If it adds a moving checklist, a third-party app is crowded out. That makes it a potential partner too. [Opinion]
- 🟡 **Trends for 「引っ越し やること」 are down about 34% from 2023 to 2026.** AI assistants may be taking over the "what do I do" job for both web and app. [Estimate]
- 🟡 **Seasonality**: demand is 1.7–2.3× in March. An app would sit dormant for about 9 months, and store ranking or retention metrics will look poor. [Data]
- 🟢 Privacy is a differentiator. Lead-gen apps are punished in reviews, so スミハジメ's no-login, no-PII stance is a real, marketable edge on both web and app. [Data + Opinion]

## 10. Strongest evidence FOR a native app (top 3)

1. **People install when a moving task truly requires it**: 東京都水道局アプリ has 50万+ downloads and 60k iOS ratings (forced channel), and 東京都公式アプリ has 100万+ downloads. [Data]
2. **Users praise deadline-ordered, personalized task apps and re-install them per move**: らくらくMOVING averages 4.6 across 650 ratings with themes of 「何をいつまでに」 and 「忘れていた事を思い出させて」, and a reviewer re-downloads 引越し手続きガイド every move. [Data]
3. **Households ask for shared task lists** (2 independent requests), and families face a months-long post-move deadline tail (15日, 90日) where a persistent app plus notifications could plausibly prevent monetary loss. [Data + Opinion]

## 11. Strongest evidence AGAINST a native app (top 3)

1. **Search demand for a moving-procedure app is essentially zero.** In Trends, 「引っ越し 手続き アプリ」 is about 0 against 「引っ越し やること」 at 52, and 「引っ越し アプリ」 means data transfer. Autocomplete shows as much appetite for pdf/印刷/エクセル. [Data]
2. **Measured app aversion.** 27.3% prefer not to download and 14.7% abandon the service (n=300, 2026-08). The top deletion reason is 利用しなくなった (67.7%). Tokyo water users say outright that a move-only app is unnecessary: 80% of its moving-related reviews are 1-star. [Data]
3. **Tiny install base for the category despite about 400k Tokyo in-migrants a year.** The best dedicated app has 650 iOS ratings in 4.5 years, and ≥10 new 2025–26 entrants have 0–2 ratings. Reviews praise _content_ (the right list, the right deadlines), which the existing web app already delivers. [Data + Estimate]

## 12. Suggested cheap validation before building (for the synthesis agent)

- Instrument the web app (privacy-safe, aggregate only): .ics export rate, "offline copy" use, return visits after move date, and share-link use. If post-move return visits are low, a native app will not fix retention.
- Test PWA "add to home screen" plus Web Push (iOS 16.4+) as a no-store experiment for the families segment.
- Five to eight interviews with 転勤族 parents who moved into one of the 24 municipalities in Mar–Apr 2026.

## Sources (accessed 2026-09-30)

- 知恵袋: q14294732029 (2024-03-10), q12275602407 (2023-02-15), q10325999025 (2026-03-06), q11316959806 (2025-07-01), q10106700285 (2013, STALE), q11287747156 (2023-10-20), q13249503498 (2021, STALE), q11295231476 (2024-03-20), q13295493973 (2024-03-25), q14268734109 (2022-09-28, STALE), q10293465870 (2024-02-15) — all under https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/
- App Store RSS/lookup: https://itunes.apple.com/jp/rss/customerreviews/page=1/id=1597858051/sortby=mostrecent/json (らくらくMOVING); id=1447039435 (引越し手続きガイド); id=6755713539 (ミツモア); id=6754363723 (引越しやることナビ); id=1638879723 (東京都水道局, pages 1–10)
- Google Play: com.raku_m, jp.co.p_finder.android.hikkoshiguide, com.meetsmore.moving, jp.co.careerindex.door.hikkoshi, jp.lg.tokyo.metro.waterworks.suidoapp, jp.lg.tokyo.metro.app
- Google Trends explore API (JP, today 5-y), pulled 2026-09-30; Google autocomplete (suggestqueries.google.com, hl=ja), 2026-09-30
- System Research survey (2026-08-29): https://prtimes.jp/main/html/rd/p/000000240.000144334.html
- アイリッジ (2022-12-26, STALE): https://iridge.jp/news/202212/33343/
- いえらぶ (2024-02, STALE): https://ielove-cloud.jp/blog/entry-04770/
- SUUMO (2024-03-07, STALE): https://hikkoshi.suumo.jp/oyakudachi/procedure
- 大阪ガス (page 2026-07-14): https://home.osakagas.co.jp/column/moving/moving-data/moving-regret-data/
- 引越し侍 troublesome ranking (survey from 2014, STALE — not used for conclusions): https://hikkoshizamurai.jp/report/report031/
- 練馬区 congestion page (2026-03-29): https://www.city.nerima.tokyo.jp/kurashi/koseki/oshirase/kuminzimusyo-konzatu.html
- 住民基本台帳人口移動報告 2025 (2026-02): https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf
- 統計Today No.194 (2023, STALE): https://www.stat.go.jp/info/today/pdf/194.pdf
- 東京都国際交流委員会 hearing report (2018-03, STALE): https://tabunka.tokyo-tsunagari.or.jp/info/files/a70d5ac7db12bd5c538a3b38f2a01613c262657e.pdf
- note: https://note.com/mai_life_5656/n/nbb37e4a4c738 (2026-03-16), https://note.com/sakurabar/n/n18755936b5a9 (2024-10-07), https://note.com/haruharuy/n/n6e02fab7e042 (2023-04-26)
- 江戸川区 児童手当 FAQ: https://www.city.edogawa.tokyo.jp/e049/qa/kosodate/kosodate/teate/teate020.html
- Raw data in the same folder: rev__.json, water__.json, t1–t3.json (Trends), trends.py
