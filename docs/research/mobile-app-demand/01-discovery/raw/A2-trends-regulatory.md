# A2 — Industry Trends, Timing & Regulatory (merged A2+A3)

Subject: native iOS/Android version of スミハジメ (free, non-official web app, Tokyo 24/62 municipalities, deadline-ordered moving checklist with official sources, .ics export, offline copy, grounded AI chat, no login, no personal data).
Research date: 2026-09-30. Labels: [Data] = sourced fact, [Estimate] = my calculation from sourced data, [Assumption], [Opinion]. STALE = source older than 18 months (before 2025-03-30).
Method note: WebSearch budget for the session ran out after about 20 queries. The remaining checks used WebFetch on primary pages. Some figures come only from search-engine summaries and are marked "secondary/unverified".

---

## 1. Government digitalization: substitute or complement?

### 1.1 マイナポータル「引越し手続オンラインサービス」

- [Data] It covers two things only: 転出届の提出 and 転入届提出のための来庁予定の連絡. It has run since 2023-02-06. Source: デジタル庁ニュース 2025-02-06, https://digital-agency-news.digital.go.jp/articles/2025-02-06 . Quote: 「転出届の提出」と「転入届提出のための来庁予定の連絡」の2つを行うことができます
- [Data, secondary] As of April 2026 you still have to go to the office for the 転入届: 「転入届については、2026年4月現在も来庁が必須となっています」. Source: freee, updated 2026-05-25, https://www.freee.co.jp/kb/kb-trend/moving-one-stop/
- [Data] マイナポータル also publishes a nationwide **「引越し関連手続一覧」**. It covers 住基, 印鑑登録, 国民年金, 国保, 介護, 後期高齢者, 原付, 福祉医療, 児童手当, 保育, 転校, 障害, 難病 and more. It is generic: it has no municipality selector, calculates no dates and has no calendar. Entries repeatedly say things like 「自治体により異なる」「転入先自治体へご確認ください」. Source: https://myna.go.jp/html/moving_oss_procedure_list.html (fetched 2026-09-30).
  - [Opinion] This list is the nearest government substitute for スミハジメ's content. It shows the gap the product fills: a list for one specific municipality and household, with deadlines and sources. It is not a substitute for a native app specifically.
- [Data, secondary] Private moving portals can use the same API. 引越れんらく帳 is run by 東京電力エナジーパートナー as a **web service**, not a native app. It offers 転出届 submission plus utility transfers. Source: https://www.hikkoshi-line.com/navi/week-before/online-moving-out-notification.html (page dated 2024-03-22, STALE).
- [Data] Since 2025-06-24 you can add a My Number Card to iPhone and use it in the マイナポータル app (secondary summary of several municipal and government pages).
- [Data, secondary/unverified] The マイナポータル app was renamed 「マイナアプリ」 on 2026-08-25. I could not confirm this on the primary page (services.digital.go.jp returned only the title).
- **DATA GAP**: no official usage count or share of 転出届 filed online could be found for 2024–2026. The only survey found is 引越し侍 2023-05 (usage below half). That page returned 403 and is STALE.

### 1.2 東京都公式アプリ「東京アプリ」 (the most relevant finding)

- [Data] About **6.4M downloads** and about **5.1M residents linked by My Number Card** as of 2026-05-31. It launched in February 2025. Source: 都庁 press release 2026-06-04, https://www.metro.tokyo.lg.jp/information/press/2026/06/2026060416
- [Data] Roadmap (デジタル行政 2026-06-17, https://www.digital-gyosei.com/post/2026-06-17-news-tokyo-app/ , consistent with ITmedia 2026-06-04):
  - 「令和8年度下期に居住地のエリアや年齢層に応じた情報のプッシュ配信を始め」 (push by area and age from Oct 2026 to Mar 2027)
  - 「令和9年度には、希望に応じてAIが利用状況をもとに一人ひとりに合った情報を最適化して届ける」 (AI personalization in FY2027)
  - 「令和10年度以降は対象範囲を主要な都手続きや区市町村手続きまで順次拡大して案内する」 (guidance on 都 and 区市町村 procedures from FY2028 onward)
- [Data] The 2025-04 vision includes 「都や区市町村の様々なコンテンツのプラットフォームを目指します」 and 「24時間365日いつでも行政に対する質問ができ、AIを通じて的確にサポート」. Source: https://www.metro.tokyo.lg.jp/information/press/2025/04/2025042801
- [Data] Incentive: the 「東京アプリ生活応援事業」 gives 11,000 Tokyo points and runs 2026-02-02 to 2027-04-01 (都 press release above).
- [Opinion] 東京アプリ will soon own the main things a native スミハジメ would add: push reminders by where you live, and an AI Q&A. It has an installed base that a third party cannot match. Its guidance on 区市町村 procedures is scheduled only for FY2028 or later, so the cross-municipality, household-specific checklist stays differentiated until then. That differentiation lives in the content, not in being a native app.

### 1.3 Municipal LINE accounts and front-yard reform

- [Data] About 1,500 of 1,788 local governments use the LINE 地方公共団体プラン (as of January 2026). Over 1,300 of those accounts use the API. Source: LINEヤフー 地方公共団体プラン媒体資料 2026年4月版, https://www.lycbiz.com/sites/default/files/media/jp/download/line-local-public-plan.pdf
- [Data, secondary] Municipal LINE chatbots commonly answer 転入/転出 how-to questions (several vendor pages).
- [Data, secondary/unverified] 総務省 KPI: 300 municipalities doing comprehensive フロントヤード改革 by FY2026. A 2026-05-21 column confirms the concept, covering every contact point between residents and their municipality, but I could not confirm the number on a primary page.

### 1.4 Net assessment for 2026–2028

- [Opinion] The government direction makes **a native third-party app less necessary** and leaves **the cross-municipal, source-backed content more necessary for now**. Online filing covers only 転出. The 転入 visit remains. Guidance from マイナポータル is generic. 東京アプリ adds push and AI in FY2026–27 and procedure guidance from FY2028. After about 2028 the product's value shifts toward being a checker, a comparison tool or a data supplier, not a separate app. Official channels (東京アプリ, LINE, マイナアプリ) are native or in-LINE and are backed by identity. A third-party native app would compete with them for the home screen.

---

## 2. Platform rules for a native version

### 2.1 Apple App Store Review Guidelines (fetched 2026-09-30; the page shows no update date. Apple Developer News lists guideline updates on 2025-11-13 and 2026-02-06.)

- [Data] **4.2 Minimum Functionality**: "Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or "app-like," it doesn't belong on the App Store."
- [Data] **4.2.2**: "Other than catalogs, apps shouldn't primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links."
  - [Opinion] High relevance. The core of a checklist that links to official pages can look like "a collection of links" or a "web clipping". A WebView wrapper around the current web app is at high risk of rejection. To pass, the native build needs its own native value: local notifications for deadlines, writing to the calendar through EventKit, offline storage, widgets.
- [Data] **5.1.1(v)**: "If your app doesn't include significant account-based features, let people use it without a login." The no-login design fits this.
- [Data] **5.1.2(i)**, added 2025-11-13: "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Text typed into the AI chat goes to an LLM provider, so a consent screen is needed.
- [Data] **5.1.1(ix)**: apps "in highly regulated fields (such as banking…, healthcare…)" or requiring "sensitive user information" should come from a legal entity. [Opinion] Government information is not on that list, and the app collects no sensitive data, so the risk is low.
- [Data] The word "government" appears in the guidelines only in 1.1.2 (games), 4.8 (government eID as a login) and 5.1.1(ix) context. Apple has **no rule dedicated to government-information apps**, unlike Google. Misleading claims fall under 2.3.1(a) and 1.1.6.
- [Data] **4.3(a)**: no separate app per city. One app for all 24 municipalities is fine.
- [Data] Fee: "Apple Developer Programのメンバーシップは年間99米ドルです。価格は地域によって異なる場合があり…現地通貨で表示" (https://developer.apple.com/jp/programs/enroll/). Secondary sources put the Japan price at ¥12,980 (tax included). **DATA GAP**: no official yen figure on the pages I could fetch.
- [Data] An **individual** must enroll under their 正式な名前 (legal name). An **organization** needs a D-U-N-S number, a legal entity (no DBAs or trade names), a domain email and a public website. Government agencies are exempt from D-U-N-S and eligible for fee waivers.
  - [Assumption, common practice] An individual account shows the legal name as the App Store seller. This conflicts with the recent repo change that removed the personal handle from prose.
- [Data] Japan MSCA (Apple Developer News, 2025-12-17): from iOS 26.2, alternative marketplaces and outside payments are available in Japan. Guideline 2.5.6 mentions entitlements for alternative browser engines "for the EU and Japan".

### 2.2 Google Play

- [Data] **Government information, unaffiliated apps** (https://support.google.com/googleplay/android-developer/answer/9514050):
  - "Include easy-to-see information sources in your app's description and store listing page"
  - "Make it clear that the app doesn't represent a government or political entity"
  - Example sources are .go.jp URLs for Japanese government information.
  - A **Government apps declaration** in Play Console has been required since **2023-01-31**. The page carries no last-updated date.
  - [Assumption] Municipal sources are mostly .lg.jp or city.*.tokyo.jp, not .go.jp. A reviewer may want the source list stated explicitly. The product already records source and last-verified date for each task, which fits the rule well.
- [Data] **Deceptive Behavior**: "Apps that falsely claim affiliation with a government entity or to provide or facilitate government services for which they are not properly authorized."
- [Data] **Webviews/Affiliate spam**: "We don't allow apps whose primary purpose is to drive affiliate traffic to a website or provide a webview of a website without permission from the website owner or administrator." (Wrapping your own site is allowed.)
- [Data] **Minimum Functionality**: "We do not allow apps that only have limited functionality and content." One example: "Apps that are static without app-specific functionalities, for example, text only or PDF file apps".
- [Data] Fee: 「1 回限りの登録料（US$25）」 (https://support.google.com/googleplay/android-developer/answer/6112435?hl=ja).
- [Data] **New personal accounts** created after 2023-11-13 must "run a closed test for their app with a minimum of 12 testers who have been opted in continuously for at least 14 days" before production (https://support.google.com/googleplay/android-developer/answer/14151465). The number was cut from 20 to 12 in December 2024 (secondary). They must also verify access to an Android device.
- [Data] Android developer verification: required from 2026-09-30 in BR, ID, SG and TH, and globally in 2027. Most Play developers are already verified (Android Developers Blog 2026-03/06). Impact for Japan in 2027 is low if the app ships through Play.

### 2.3 LINE mini app as an alternative channel

- [Data] Since November 2024 there are two tiers. **未認証** apps publish immediately with no review. **認証済** apps go through 1–2 weeks of LINEヤフー review (Grandream 2026-06-12, https://www.grandream.jp/blog/260612_line-shinsa-guide).
- [Data] Unverified apps lack サービスメッセージ (the notification channel), LINE search, and home-screen shortcut creation (SocialPlus 2025-03, https://blog.socialplus.jp/knowledge/line-uncertified-mini-apps/). Only verified apps get service messages, and in-app billing from February 2026.
- [Data] 「LINEミニアプリポリシーにおける「本サービスのご利用対象者」であれば、どなたでも開発することができます」 (LINE Developers). **DATA GAP**: whether an individual without a business can pass the 認証 review. Barred categories include 政治関連 but not government information as such.
- [Data, secondary] LINE domestic MAU is about 99M (as of September 2025). **DATA GAP**: number of LINE mini apps and users.
- [Opinion] LIFF/LINE Login gives the operator user identifiers. That conflicts with the product principle of collecting no personal data (CLAUDE.md §3-6/7). It is also weaker than the official municipal LINE accounts already in place (1,500 local governments).

---

## 3. Web-platform alternatives (2025–2026)

- [Data] iOS Web Push arrived in iOS 16.4 (2023-03-27) and only works after the site is added to the Home Screen. Safari tabs cannot even request permission (Zenn, OneSignal, ops-in).
- [Data] **iOS 26**: every site added to the Home Screen opens as a web app by default. There is an "Open as Web App" toggle and no manifest is required (iDownloadBlog 2025-06-17, MacRumors, Apple Support; ITmedia 2025-11-26).
- [Data] ops-in 2026-09-07 (https://ops-in.com/blog/ios-pwa-support/): badging is supported, Background Sync is not, and the storage quota can reach up to 60% of disk in browser apps with no permanence guarantee.
- [Data] **Pentagon survey, April 2026, n=200, ages 20–50, internet** (https://www.value-press.com/pressrelease/372952):
  - Only 4.9% know the term PWA.
  - Only 21.5% know how to add a site to the Home Screen; 12.2% don't know the feature exists.
  - 47.6% of those who added one no longer use it.
  - 72.7% feel uneasy about an app that is "not in the store".
  - Given a choice, 48.3% pick a native app and 7.3% the web version.
  - Trust: 31.7% trust store apps, 2.0% trust sites added to the Home Screen.
  - Caution: vendor survey, small n, likely commercial interest in app building.
- [Data, low reliability] Vendor blogs such as MobiLoud claim native push gets about 10x the opt-in and web push delivers about 33%. MobiLoud sells native wrappers, so these figures should not be relied on. Pushwoosh 2025 puts the average iOS native opt-in at 56.36%.
- [Data] Google Calendar: 「新しいカレンダーを登録するには、パソコンのウェブブラウザを使用する必要があります」 (https://support.google.com/calendar/answer/37100?hl=ja). You cannot add a URL (ICS) subscription from the mobile app. This is real friction for the web .ics path on Android. A native app could write events directly through CalendarContract or EventKit. [Opinion] This is a genuine but narrow native advantage.
- **DATA GAP**: PWA install rates or Home Screen adoption for Japanese users beyond the Pentagon survey. Also no data on how Japan MSCA browser-engine entitlements have changed iOS PWA capability in practice.

---

## 4. Timing

- [Data] National inter-municipal moves in 2025: 5,190,548 (e-Stat/統計局 2025年結果, 2026-02). By month:
  - March 2025: 905,179
  - April 2025: 683,859
  - August 2025: 348,602
  - Sources: https://www.stat.go.jp/data/idou/rireki/2503/index.html , /2504/ , /2508/
  - [Estimate] March is 17.4% and March+April about 30.6% of the year. March is about 2.6x August.
- [Data] Tokyo 2025:
  - Japanese in-movers from other prefectures: 397,985, down 9,625 (2.4%), the largest drop of any prefecture.
  - Net in-migration including foreigners: 65,219, the highest in Japan but down by 14,066.
  - Source: https://www.stat.go.jp/data/idou/2025np/jissu/pdf/2025gaiyou.pdf
  - **DATA GAP**: Tokyo-only monthly figures and moves within Tokyo.
- [Estimate] To catch the March–April 2027 peak, a native app needs build time, Apple review, the Google 12-tester × 14-day closed test and time for store-search indexing, and must be live by about January–February 2027. Missing that pushes the first real test to spring 2028, by which time 東京アプリ procedure guidance is due.
- [Data] App reluctance:
  - Crowdsourced survey, 2026-08-20, n=300, ages 20–60 (https://alulu.com/media/tips_app_downloads/). When a service needs an app: 53.0% download if necessary, 27.3% would rather not, 14.7% sometimes give up on the service, 5.0% download without hesitation.
  - Reasons for hesitating: unused apps pile up 57.1%, worry about registering personal information 40.5%, storage 38.9%, notifications 33.3%.
  - Reasons for downloading: points 66.1%, coupons 54.6%.
  - Caveat: small n and a marketing-firm source.
- [Data, STALE 2022-07] アイリッジ, n=442: about 62% have deleted an app within 7 days of downloading it (https://iridge.jp/news/202212/33343/).
- [Data] ドコモ モバイル社会研究所 (2025-02) and Nikkei (2026-07): 20s spend about 7.3–7.7 hours a day online, and 47.9% of 20s report SNS fatigue. This is general fatigue and not specific to apps.
- [Opinion] Moving is an event that happens once every few years, and "unused apps pile up" is the top reason people hesitate. A native app for a single 1–2 month task runs straight into that. The survey that favors store trust (Pentagon) and the one showing app fatigue (alulu) point in opposite directions, and both are weak.

---

## 5. Red / Yellow flags

**Red**

1. **Apple 4.2 / 4.2.2**: a wrapper around the web app is likely to be rejected as a "repackaged website" or "collection of links". Passing requires spending on native-only features (notifications, calendar write, widget, offline), which is the actual cost of the idea.
2. **東京アプリ roadmap overlap**: 6.4M downloads and 5.1M My-Number-verified users. Push by residence in FY2026 H2, AI personalization in FY2027, 区市町村 procedure guidance from FY2028. The strongest incremental native feature, deadline push, is being built into the official Tokyo channel.
3. **Episodic use plus app fatigue**: the top reason for hesitating is that unused apps pile up (57.1%). A native app for a once-in-years task faces steep install friction and rapid deletion.
4. **Developer identity**: an individual Apple account exposes the legal name as seller [Assumption]. An organization needs a legal entity and D-U-N-S. A new personal Google account needs 12 testers for 14 days. This is non-trivial for a solo or hackathon owner.

**Yellow**

- The Google government-info declaration and disclaimers are manageable. The existing per-task sources and last-verified dates fit the rule, but .lg.jp is not the .go.jp example.
- Apple 5.1.2(i) needs explicit consent before chat text goes to a third-party AI.
- iOS Web Push needs a Home Screen install; only 21.5% know how. iOS 26 lowers the friction (Open as Web App is the default).
- Store trust is reported at 31.7% for store apps against 2.0% for Home Screen web apps (vendor survey), so native may help credibility. Weak evidence.
- Android Google Calendar ICS subscription only works from desktop; native calendar write is a real but narrow advantage.
- A LINE mini app conflicts with the no-personal-data principle, and notifications need 認証.
- Tokyo in-migration is shrinking (−2.4% Japanese in-movers in 2025).

**DATA GAPS**

- Usage counts for マイナポータル 転出届
- PWA or Home Screen adoption in Japan
- Tokyo monthly moves
- Official Apple price in yen
- Whether individuals can get LINE mini app 認証
- The マイナアプリ rename on a primary source
- The front-yard 300-municipality KPI on a primary source
