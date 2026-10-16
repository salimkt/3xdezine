# 03 — Monetisation and go-to-market (India)

Research date: 2026-10-16. All web sources were accessed on 2026-10-16 unless a date is given. Prices are ex-GST unless stated.
Tags used below: **[E]** = my estimate or assumption. **[U]** = unverified, meaning a single secondary source or sources that disagree. **[L]** = needs a lawyer or CA.

---

## Summary

- **Start with a SaaS subscription for designers, studios and contractors.** It has the fastest route to revenue, needs no capital and carries the least legal load. The Indian market pays low prices per seat. Generic SMB tools sit between ₹700 and ₹5,000 a year (Vyapar, myBillBook), Zoho Books costs ₹899–1,499 a month, and niche interior quotation apps range from ₹999 a year to about ₹4,000 a month. A Solo plan around **₹699/month or ₹6,999/year** and a Studio plan around **₹2,499/month** fit those anchors and stay under the ₹15,000 UPI AutoPay no-AFA cap on monthly billing.
- **Add usage-based credits** for HD renders and walkthroughs. This also covers the GPU and storage cost of heavy users. Add **white-label pilots** for builders, modular kitchen makers and dealers as the second revenue line, because one deal can be worth 20–50 Solo seats **[E]**.
- **Defer lead generation, escrow and milestone payments.** Lead generation needs a two-sided marketplace with homeowner demand first. Holding funds between homeowners and contractors counts as payment aggregation under the RBI PA Directions 2025, which require ₹15 crore net worth at application. Any escrow-like flow would have to run on a licensed PA's split or escrow product, and it still needs legal advice.
- **Use Razorpay or Cashfree for payments.** Stripe is invite-only for new Indian accounts. Razorpay onboards unregistered individuals using PAN and has a no-GSTIN route. GST registration becomes mandatory above ₹20 lakh aggregate turnover for services. Registering voluntarily earlier lets studios that hold a GSTIN claim input tax credit (ITC), which helps sales.
- **DPDP is not enforceable yet, but plan for it now.** The main data-fiduciary duties start around 13 May 2027 (notice, security, 72-hour breach report, 1-year log retention, 90-day grievance handling). Homeowner floor plans with addresses and photos are personal data.
- **Go-to-market should run on the product itself.** Every shared 3D link and quotation PDF carries a "Made with 3xDezine — make yours free" call to action. Add Instagram Reels and YouTube before/after content, WhatsApp communities of designers and carpenters, IIID chapters (31 chapters, about 8–10k members **[U]**), and ACETECH Mumbai, 19–22 Nov 2026.
- **12-month base case [E]:** about 3,000 sign-ups, about 100 paying accounts, and **MRR of about ₹1.2 lakh** (about ₹14 lakh ARR, under the GST threshold) plus 1–2 paid white-label or brand pilots. The stretch case is about ₹3 lakh MRR.

---

## 1. Revenue models

### 1.1 SaaS subscriptions (designers, studios, contractors)

**Indian SMB price anchors**

| Product | Price (ex-GST) | Model | Source |
|---|---|---|---|
| Vyapar | Free mobile tier; mobile ₹699–799/yr; desktop ₹3,399–3,699/yr; desktop + mobile ≈ ₹3,999/yr; 3-yr plans ₹7,799–8,699 | Per device or licence, annual | techjockey.com/detail/vyapar; vyaparapp.in/index.php/pricing **[U: figures vary across sites]** |
| myBillBook | From ₹34/mo (Silver); Diamond ₹217/mo billed annually; up to 35% off multi-year | Per business, annual | capterra.com/p/202732/FloBooks/pricing/; vendor page via search |
| Zoho Books (India) | Free (< ₹25L revenue); Standard ₹899/mo; Professional ₹1,499/mo; Premium ₹2,999/mo; about 17% off annual | Per organisation, with user caps (Standard 3 users) | patronaccounting.com/blog/zoho-books-pricing-india-2026 **[U: Zoho page not fetched]** |
| TallyPrime | Silver ₹22,500 one-time; Gold ₹67,500; TSS renewal ₹4,500 / ₹13,500 a year | Perpetual licence plus annual renewal | tallysolutions.com/business-guides/tallyprime-total-cost-of-ownership-india/ |
| Khatabook | Freemium; premium price not published (competitor claims ₹156/mo) | Freemium | g2.com/products/khatabook/pricing **[U]** |
| Dukaan | Free tier plus paid tiers; INR figures conflict (₹667/mo to ₹29,999/yr, or $17–161/mo) | Per store, plus 3.99–4.99% transaction fee on low tiers | softwaresuggest.com/dukaan/pricing **[U]** |

**Interior and visualisation tools (direct comparables)**

| Product | Price | Notes | Source |
|---|---|---|---|
| DesignQuote (India) | ₹199/mo, ₹699 for 6 mo, ₹999/yr | Quotation only, with GST and WhatsApp share | designquote.in |
| DzynFlow (India) | ₹19,999/yr | Quotation plus other tools | dzynflow.com/blog/interior-quotation-software |
| Plannio (India) | Free one-project pilot; ₹4,249/mo (5 active projects), ₹8,499/mo (15 projects), ₹16,149/mo (unlimited), billed annually | Studio OS with BOQ; **gated by active projects** | via search of plannio.in **[U: pricing page not fetched directly]** |
| InteriorOS (India) | "Free forever" plan; paid tiers not shown | Leads, quotes, projects, finance; iOS and Android | hunted.space/product/interioros |
| HelloGrowthCRM | ₹899/user/mo; free plan | CRM for designers | hellogrowthcrm.com/best-crm-for-interior-designers-india |
| Foyr Neo (New Delhi HQ) | About $29–59/mo; listings conflict | Browser-based 3D and rendering | saasworthy.com/product/foyr-neo/pricing; capterra.in/software/204757/foyr-neo **[U]** |
| Coohom | About $9.9–30/mo Pro, $100/mo Premium; **render caps** (Pro 4 × 1080p videos/mo from July 2026) | Shows render and video caps used as paywalls | capterra.in/software/192882/coohom; pricingsaas.com/companies/coohom/diffs/2026W30 **[U]** |
| Houzz Pro (US) | $99 / $199 / $399 a month, +$50 per extra seat, ads from $499/mo | Sells software and leads together | dupple.com/reviews/houzz-pro (Sept 2026 check) **[U]** |

**What these comparables show**
- Indian buyers anchor on **₹1,000–5,000 a year for "an app"** and **₹10,000–50,000 a year for "business software"**. A 3D tool that also produces the client-facing quotation can justify the upper range. To do so, the price has to be framed against one won project: a 3BHK interior quote of about ₹24–28 lakh (Plannio's example) at 10–15% design margin is worth ₹2.4–4 lakh to a designer **[E]**.
- **Per studio with seat caps beats pure per seat** for Indian SMBs, following the Zoho and Tally pattern. Studios share logins when per-seat prices feel high **[E]**.
- **Promote annual billing.** Vyapar, myBillBook, Zoho and Plannio all discount annual plans by 15–35%. Annual prepay also avoids monthly mandate failures. The trade-off is that an annual charge above ₹15,000 needs extra authentication (AFA) on each debit (see §2).
- **Free-to-paid conversion.** Freemium SMB SaaS typically converts at 3–6%, with time-limited trials at 10–25%. Indian trial-to-paid: under 5% is poor, 10–18% average, 18–25% good (upgrowth.in/conversion-rate-benchmarks-for-indian-startups/; inc42.com/?p=21954; getmonetizely.com) **[U: blog benchmarks]**.

**Fit: strong.** The product already has the paid-grade features: branded quotation and estimate, proposals with cost deltas, version history, permissions and sharing.

### 1.2 Usage-based (per project, per HD render or walkthrough, per quotation PDF)
- **Precedent:** Coohom and similar tools gate 4K/8K images and videos with monthly caps. Plannio gates by active projects.
- **Per-project pricing** (for example ₹299–499 per project unlock **[E]**) suits occasional users such as carpenters, small contractors and homeowners. These users would never subscribe, but they do pay one-off UPI amounts.
- **Render and walkthrough credits** charge for the expensive work. They only make sense if HD rendering costs money, for example through server-side or cloud GPU rendering. If renders stay client-side WebGL, sell the *quality and watermark removal* rather than compute.
- **Per-quotation-PDF pricing** is a poor fit. The quote is the viral surface, so charging for it suppresses sharing. Gate *branding* on the PDF (own logo, no 3xDezine footer) instead.
- **Fit: good as an add-on, weak as the main model.** Small UPI one-off payments carry no mandate complexity.

### 1.3 Lead generation / marketplace
- **Benchmarks.** Urban Company's standard partner commission is about 28% of service value, and the platform charges specialists for leads in some categories (recipe.finology.in, citing the 2025 RHP **[U]**; synapseindia.com). Sulekha sells **lead credits**, with each lead sent to a limited number of matched providers. Its rupee prices are not published (knowledgebase.bison.co.in/view_article.php?id=485 **[U]**). JustDial had **631,530 active paid campaigns** as of 31 Mar 2026, with package prices quoted per business (nsearchives.nseindia.com investor presentation, 13 Apr 2026). Houzz Pro adds advertising and leads from $499/mo on top of software **[U]**. Livspace (FY25 revenue ₹1,460 cr) and HomeLane (≈ ₹748 cr) are full-stack and capture homeowner demand directly (business-standard.com, 13 Oct 2025; pulse.d2cinsider.com).
- **Rupee lead prices for interiors:** I could not verify these. My working estimate is **₹300–2,000 per shared lead**, varying by city and ticket size **[E][U]**.
- **Fit for a solo developer now: poor.** It needs homeowner traffic (an SEO and ads budget), lead verification, dispute handling and DPDP consent to share data with third parties. Each of these is a separate business. A long-term asset is still worth keeping in mind: homeowners who start a plan in a free homeowner mode are qualified leads with a floor plan, a budget estimate and a city. Revisit this after 1,000+ homeowner projects a month.

### 1.4 Material brand partnerships (sponsored catalogues, visualiser white-label, affiliate)
- **Precedent:** Brands already pay for visualisers. Somany launched a 3D/VR tile visualiser with a room planner at ACETECH Delhi in 2016 for its experience centres and franchise stores (digit.in press release). Kajaria and Somany run AR visualisation in e-commerce, according to Mordor Intelligence as cited in markhub24.com **[U]**. Asian Paints runs **Beautiful Homes Service**, which connects homeowners, designers and technicians (beautifulhomes.asianpaints.com). Häfele runs design studios with kitchen and wardrobe design services for architects and contractors (hafeleindia.com press releases). Roomvo sells a white-label visualiser to tile and flooring retailers, though no India deployment was found (get.roomvo.com).
- **What 3xDezine can sell:**
  - **Sponsored or default catalogue placement.** The brand's SKUs, with real INR MRP and pack sizes, become the default for "vitrified tile 600×600" and similar items in the estimate.
  - **Dealer white-label.** A plywood, tile or hardware dealer gives the tool to its carpenters and designers, with the dealer's SKUs and prices pre-loaded. Every estimate then becomes a purchase list for that dealer.
  - **Pricing data feed.** Anonymised regional material demand data.
- **Affiliate:** Most of these brands sell through dealers, not online checkouts, so affiliate income is thin. Amazon.in Associates rates for furniture and home improvement are reported anywhere from 3% to 9% and change often (wscubetech.com; cuelinks.com **[U]**). Affiliate links suit homeowners buying fittings, not studios buying plywood in bulk.
- **Fit: good, after traction.** Brands buy reach. Before about 500 active designers, a pitch to a national brand will not land, but a **single regional dealer pilot** can work earlier. Sponsored defaults must be disclosed as sponsored, both for trust and because of consumer-law dark-pattern rules **[L]**.

### 1.5 Transaction take rate (escrow or milestone payments)
- **Precedent:** Indian interior jobs are paid in milestones; Plannio's article refers to a 10-40-30-20 schedule. Livspace pays partner designers a profit share (50–70% in recruiting posts, which conflict **[U]**). HomeLane franchisees earned a reported 10% per order (an older figure **[U]**).
- **Blocker:** Collecting a homeowner's money and releasing it later to a contractor is payment aggregation. The RBI's Regulation of Payment Aggregators Directions 2025 (issued 15 Sept 2025) require non-bank PAs to have **₹15 crore net worth at application and ₹25 crore by the end of year 3**, plus escrow audits (inc42.com; indiacorplaw.in, 9 Oct 2025). Platforms instead use a licensed PA's marketplace product, such as Razorpay Route with settlement hold or delayed transfer, or Cashfree Easy Split at 0.20–0.25%. The PA then holds the funds, and the platform takes a commission (razorpay.com/docs/payments/settlements/direct/route). Even this route brings linked-account KYC for every contractor, refund and dispute liability, and possible consumer-protection exposure if work goes wrong **[L]**.
- **Fit for a solo developer: poor.** Revisit after a company is incorporated and has counsel.

### 1.6 White-label for builders, developers and modular kitchen makers
- **Use cases:** A builder embeds the tool in its sales site so buyers can furnish their actual unit plan (the plan templates feature fits this directly). A modular kitchen maker or franchise gives designers a configurator with its own carcass, shutter and hardware price list. A dealer runs the tool for its carpenters (see §1.4).
- **Precedent:** HomeLane is adding about 100 franchise stores in 12 months (retail4growth.com; franchiseindia.com). Each store needs a design and quotation tool, which makes franchise chains and second-tier modular brands the realistic buyers.
- **Pricing [E]:** ₹50,000–2,00,000 setup plus ₹10,000–50,000 a month, or per-unit pricing for builders (₹500–2,000 per sold unit).
- **Fit: good, but sales-led.** It requires meetings, custom catalogue import and an SLA. The existing static GitHub Pages and Supabase stack can handle per-tenant branding cheaply.

### 1.7 Ranking for a solo developer starting now

Scores from 1 to 5, where 5 is best (fastest, cheapest, lightest legal load, most defensible). All scores are **[E]**.

| Rank | Model | Time to 1st ₹ | Capital | Legal/ops burden | Defensibility | Notes |
|---|---|---|---|---|---|---|
| 1 | **SaaS subscription (Solo/Studio)** | 5 (weeks) | 5 | 4 (GST, DPDP, refunds) | 3 (INR material data, NBC checks, workflow lock-in through history) | Core model |
| 2 | **Usage credits (HD render/walkthrough, per-project unlock)** | 5 | 4 (GPU cost if server renders) | 5 | 2 | Add-on; monetises the long tail |
| 3 | **White-label (dealer, kitchen maker, builder)** | 3 (2–4 months of sales) | 4 | 3 (contracts, SLA, data processing agreement) | 4 (embedded in their sales flow) | Highest revenue per deal |
| 4 | **Brand partnerships (sponsored catalogue)** | 2 (needs reach) | 5 | 3 (disclosure, ad rules) | 4 (catalogue data network effect) | After about 500 active designers |
| 5 | **Affiliate on materials** | 4 | 5 | 4 | 1 | Small income; homeowner side only |
| 6 | **Lead generation / marketplace** | 1 | 2 (demand acquisition spend) | 2 (consent to share data, disputes) | 4 if it works | Needs homeowner traffic |
| 7 | **Escrow / milestone take rate** | 1 | 2 | 1 (PA rules, KYC, disputes) | 4 | Defer; legal advice required |

---

## 2. Payments and compliance in India

### 2.1 Gateways for subscriptions

| | Razorpay | Cashfree | PayU | Stripe India |
|---|---|---|---|---|
| Domestic platform fee | 2% standard plan (UPI, cards, netbanking); 0 setup/AMC; international up to 3% | 1.95% (UPI and most modes); international 2.99%; 0 setup | About 2% domestic; 3% EMI, Amex and international **[U]** | Not open to new accounts |
| Subscriptions | Cards 0.9% + platform fee; UPI, NACH and e-mandate "on request" | Mandate creation ₹7.5, plus per debit ₹5 (< ₹1,000) or ₹15 (≥ ₹1,000) for UPI AutoPay; ₹7.5 + ₹7.5 for cards and e-NACH | Recurring billing offered; rate not published **[U]** | — |
| Onboarding an individual | Unregistered individuals allowed: PAN, CKYC or video KYC, "I don't have a GSTIN" route | Not checked in detail **[U]** | Not checked **[U]** | Invite-only for new Indian businesses; existing accounts still supported |
| Marketplace split | Route (hold or delayed settlement) | Easy Split 0.20–0.25% | Split settlements | — |
| Sources | razorpay.com/pricing/; razorpay.com/docs/payments/create-account/; razorpay.com/blog/?p=28068 | cashfree.com/payment-gateway-charges/ (festive offer: 0% on first ₹20L GMV for new merchants, time-limited) | skydo.com/compare/payu-pricing; wise.com | support.stripe.com/questions/stripe-accounts-are-invite-only-in-india |

18% GST applies to all gateway fees.

**Recommendation:** Start on **Razorpay**, which has the smoothest individual onboarding, Subscriptions, payment links and invoices. Keep Cashfree as the alternative if UPI AutoPay pricing on request comes back high. Its per-debit pricing is transparent, and at a ₹699 debit costs about ₹7.5 + ₹5 + 1.95%, roughly ₹26 or 3.7% **[E: arithmetic]**. For international card buyers, use Razorpay's international payments (up to 3%), and look at a merchant-of-record service only if export sales become material.

### 2.2 RBI recurring-payment rules (UPI AutoPay and card e-mandates)
- **No-AFA limit: ₹15,000 per debit.** Above that, each debit needs extra authentication; UPI asks for the PIN. The ₹1 lakh higher limit applies only to mutual funds, insurance and credit-card bill payments, not SaaS. The limit was raised from ₹5,000 to ₹15,000 in June 2022 and to ₹1 lakh for those categories in Dec 2023. The RBI **consolidated e-mandate directions on 21 Apr 2026** with the same structure (business-standard.com, 2022 and Dec 2023; ksandk.com/newsletter/rbi-e-mandate-framework/; businesstoday.in, 22 Apr 2026; razorpay.com/docs/payments/subscriptions/supported-payment-methods.md). **[L: read the RBI circular itself; I relied on secondary reports.]**
- **Pre-debit notification at least 24 hours before each debit**, giving merchant, amount and date, with an opt-out from that debit or the whole mandate. Customers can cancel any time from their bank or UPI app, and no fee may be charged to customers for the mandate (ksandk.com; razorpay.com/docs/announcements/rbi-card-mandate-guidelines/recurring-payments/).
- **Product implications:**
  - Keep each **monthly debit under ₹15,000**, which every proposed tier does.
  - An **annual Studio plan above ₹15,000** (for example ₹24,999) will need AFA on each renewal. Either sell annual plans as one-time payments with renewal reminders, or accept AFA.
  - Handle mandate failures with in-app dunning and a payment-link fallback.
  - Some UPI apps (for example PhonePe handles) do not support mandates above ₹15,000 (chargebee.com docs).

### 2.3 Google Play (Android app)
- Since 26 Apr 2023 Google allows **user choice billing** in India, so an alternative biller is permitted. Google's fee is reduced by 4 percentage points from the standard 15% for auto-renewing subscriptions, making it about 11% (techcrunch.com, 17 May 2023; sentinelassam.com). The CCI non-compliance inquiry was open at last report, and I found no 2025–26 resolution **[U]**.
- **Options:**
  - Keep the Android app "consumption-only": it signs in and uses the plan, and purchases happen on the web. Google lists this as a permitted model.
  - Integrate Play Billing or user choice billing and pay about 11–15%.
- **Rules on in-app links to web checkout change.** Check Google's current Payments policy before release **[L/U]**.

### 2.4 GST
- **Registration threshold for services:** ₹20 lakh aggregate turnover in most states (₹10 lakh in special-category states). Notification 10/2017-Integrated Tax exempts **inter-state** service suppliers under ₹20 lakh from compulsory registration, and 2026 secondary sources treat it as still in force (gstzen.in; kanakkupillai.com). One blog claims inter-state services need registration regardless of turnover. I could not confirm that claim and believe it is wrong **[U][L]**.
- **Rate:** SaaS is taxed at **18%** under SAC 998313 (IT design and development) or related codes. Selling to overseas customers is a zero-rated export under a LUT. Some guides classify SaaS as **OIDAR**, which matters mainly for foreign suppliers (incorpx.io; taxadda.com) **[L: confirm the SAC]**.
- **Selling through an app store or e-commerce operator** can trigger separate registration and TCS rules; there are exemptions for service suppliers under the threshold **[L]**.
- **Voluntary early registration is worth considering.** Many studio and contractor buyers are GST-registered and want a B2B tax invoice so they can claim ITC. Without it, your 18% is a real cost to them, and you also cannot reclaim GST on Supabase, Google Play and gateway fees. The cost is monthly or quarterly returns; QRMP is available under ₹5 crore.
- **Invoices (Rule 46, CGST Rules):** Each invoice needs:
  - the supplier's name, address and GSTIN
  - a serial number of up to 16 characters, unique per financial year
  - the date
  - the buyer's name, address and GSTIN if registered
  - SAC, description and taxable value
  - rate and amount, split as CGST+SGST or IGST
  - place of supply (state name and code)
  - whether tax is payable on reverse charge
  - a signature, which can be digital

  For unregistered buyers with invoices of ₹50,000 or more, the buyer's name, address and state are also required (tallysolutions.com/gst/gst-invoice-format…; gimbooks.com).
- **E-invoicing (IRN)** applies only above ₹5 crore AATO, B2B only. It is not relevant in year 1 (gimbooks.com/blog/5-crore-e-invoice-turnover-rule-2026/).
- **Before registration, issue a plain receipt.** A bill of supply is used by registered composition dealers and is not applicable here **[L]**. Razorpay Subscriptions and Invoices can generate GST invoices once a GSTIN is added.
- **Income tax:** As an individual the profit is business income. Presumptive taxation (44ADA) does not cover software SaaS by default **[L]**.

### 2.5 DPDP Act 2023 and DPDP Rules 2025
- **Timeline:** The Rules were notified on 13–14 Nov 2025. Rules 1, 2 and 17–21 (Data Protection Board) took effect immediately. **Consent managers start in Nov 2026.** **Main fiduciary duties (Rules 3, 5–16, 22, 23) start 18 months after notification, about 13 May 2027.** Until then the SPDI Rules 2011 continue (azbpartners.com, 14 Nov 2025; storyboard18.com; mondaq.com/india/privacy-protection/1708830; blog.ipleaders.in, verified 8 May 2026).
- **Roles in 3xDezine:**
  - For **designer accounts** (sign-up, billing), 3xDezine is the **data fiduciary**.
  - For **homeowner data a designer uploads** (client name, phone, site address, floor plan, photos), the **designer is the fiduciary and 3xDezine is the processor**. This needs terms and a data processing agreement in the ToS, and a role-split analysis **[L]**.
  - Any **homeowner mode or lead feature** makes 3xDezine the fiduciary for homeowners.
- **Obligations from May 2027** (KPMG Nov 2025 guidance; lawrbit.com; amlegals.com):
  - A clear, itemised **notice** with consent, and withdrawal as easy as giving consent.
  - **Reasonable security safeguards**: encryption, access control, monitoring. The penalty for security failure can reach **₹250 crore**.
  - **Breach intimation** to affected users without delay. Report to the Board without delay and give a detailed report **within 72 hours**.
  - **Retain logs and traffic data for at least 1 year.**
  - Erase data when its purpose is served. Rules on 3-year inactivity erasure with 48-hour notice apply only to large e-commerce, social and gaming platforms (2 crore or 50 lakh+ users), not to 3xDezine.
  - **Grievance redressal within 90 days**, with published contact details.
  - **Verifiable parental consent** for users under 18. Block sign-up under 18.
- **Data localisation:** None under DPDP, except for a future negative list of countries. Hosting in Supabase's Mumbai region (ap-south-1) is still sensible for latency and buyer comfort **[E]**.
- **Also applies:** The IT Act 2000 and IT Rules require a grievance officer. CCPA's Dark Patterns Guidelines 2023 cover subscription traps, drip pricing and disguised ads, so sponsored catalogue items need labels **[L]**.

### 2.6 Escrow and holding funds
- Holding customer money before passing it to a third party requires an RBI-authorised **payment aggregator**. Non-bank PAs need ₹15 crore net worth at application and ₹25 crore by year 3, maintained continuously. They must keep escrow accounts with quarterly auditor certificates. Existing non-bank PAs had to apply by 31 Dec 2025 (RBI PA Directions 2025; inc42.com; lexplosion.in; indiacorplaw.in).
- A platform that wants milestone payments must therefore **use a PA's split or hold product**, for example Razorpay Route, and must not touch funds itself. Even then, RBI rules on marketplaces using PA products, contractor KYC, and liability for non-performance need legal review **[L]**.

---

## 3. Go-to-market

### 3.1 Where Indian designers and contractors discover tools
No survey of how Indian interior designers discover software was found, so the channel weights below are **[E]** and partly based on observed activity.

| Channel | Evidence | Use |
|---|---|---|
| **Instagram (Reels)** | Large Indian interior-design creator base (modash.io/find-influencers/india/interior-design, Mar 2026); designers market their portfolios here | 15–30 second "2D plan → 3D → ₹ estimate in 60s" Reels; paid collaborations with mid-tier designer creators (10–100k followers) at ₹5–25k per post **[E]** |
| **YouTube (Hindi + regional)** | Tutorials for SketchUp, AutoCAD and V-Ray dominate design students' learning **[E]** | Tutorials such as "How to make a 3BHK quotation", "NBC rules for room sizes" and "Tile wastage calculation"; these also build search traffic |
| **WhatsApp communities** | Designers and carpenters run on WhatsApp (InteriorOS positions itself as replacing "WhatsApp, Excel, Tally") | WhatsApp-native share (3D link plus PDF), a broadcast channel, admins of carpenter and designer groups as affiliates |
| **IIID chapters** | 31 chapters and centres, about 8,000–10,000 members (2018–2020 figures **[U]**); the Bengaluru chapter partnered with India Kitchen Congress 2025 | Chapter CPD talks or workshops on "NBC 2016 compliance in residential interiors"; discount codes for members |
| **Design colleges** | Interior and architecture schools; NID / NIFT / CEPT plus hundreds of private diploma institutes **[E]** | Free Student plan (watermarked); campus ambassadors; students become future studio buyers |
| **Trade shows** | **ACETECH Mumbai 19–22 Nov 2026, NESCO** (tradefairdates.com; tradefest.io); India Design ID New Delhi held 19–22 Feb 2026, 2027 edition expected about Feb (dates not confirmed); ID Mumbai 9–11 Oct 2026 (passed) | Visit as an attendee first (cheap). Demo on a phone, collect WhatsApp numbers. Skip booths in year 1 **[E]** |
| **Dealer networks** | Plywood, laminate, tile and hardware dealers are where carpenters and contractors gather; brands run carpenter loyalty schemes **[U]** | A dealer-branded version (§1.6) puts the dealer's SKUs into every estimate |
| **SEO / content** | Unmet demand for INR material calculators (tile, paint, plywood sheets, wastage) **[E]** | Free calculators on the static site that lead into the app; public template gallery pages ("2BHK 900 sq ft plan") |
| **Marketplace listings** | Capterra India, Techjockey, SoftwareSuggest list Indian SMB tools | Free listings; ask early users for reviews |

### 3.2 Free tier and trial patterns that work in India
- **Free-forever with hard project limits plus visible branding** works best for virality and matches InteriorOS, Zoho and Vyapar. Indian buyers distrust trials that ask for a card or UPI mandate upfront **[E]**.
- Add a **14-day Pro trial with no mandate**, unlocked at the "moment of value", for example the first time a user exports a client PDF. Trial-to-paid in India runs 10–18% on average versus 3–6% for plain freemium (upgrowth.in) **[U]**.
- **Gate on what clients see**, not on what designers learn:
  - client-facing branding (own logo, no watermark)
  - HD render resolution
  - number of active projects (Plannio's gate)
  - proposals with cost deltas and approval
  - team permissions

  Keep the NBC checks and estimate free, since they are the hook.
- **Price on a one-project ROI**: "One won project pays for 5 years."
- **Accept UPI one-time payments** for annual and quarterly plans alongside AutoPay. Many small businesses prefer to pay once **[E]**.

### 3.3 CAC
- No credible public benchmark exists for Indian SMB SaaS. One modelling source gives **$80–250 (about ₹7–22k)** CAC with 18–36 month payback for domestic SMB SaaS (efinancialmodels.com **[U]**). The ₹1.2–5 lakh figures from upgrowth.in are for companies at ₹10–100 crore ARR **[U]**.
- **Target for 3xDezine [E]:** a blended CAC of **₹1,000–3,000**, mostly organic and referral. At an ARPA of about ₹1,000/mo and 4% monthly churn (LTV ≈ ₹25,000 gross), that gives LTV:CAC of 8x or better. Paid Meta ads to designers in India are likely to cost about ₹50–200 per sign-up and ₹2,000–8,000 per paying user at 3–4% conversion **[E][U]**. Use them only to test messaging.

### 3.4 Referral loops built into the workflow
1. **Shared 3D link and quotation PDF.** The footer carries "Designed with 3xDezine · Make your home's plan free →" and the link opens a homeowner-mode template. Paid plans can remove it; a "Powered by" badge may stay on the Solo tier **[E]**. **This is the main growth loop**: each quote reaches 1–5 homeowners, contractors and family members.
2. **Homeowner → designer.** A homeowner who views a shared plan can "Ask for a quote from a 3xDezine designer near you". This seeds the future lead marketplace, starting free.
3. **Designer referral.** The referrer and the new user each get one month of Solo or 20 HD credits. Payment goes out once the referred user pays, not at sign-up.
4. **Collaborator invites.** Permissions and review mode bring contractors and clients into accounts. A contractor who gets invited is a prospect.
5. **Template gallery.** Designers publish templates under their name (portfolio SEO for them, content for 3xDezine).
6. **IIID and college codes** that can be tracked per chapter or institute.

---

## 4. 12-month monetisation plan

### 4.1 Tiers (INR, ex-GST)

| | **Free** | **Solo** | **Studio** | **Business / White-label** |
|---|---|---|---|---|
| Price | ₹0 | **₹699/mo** or **₹6,999/yr** (about 17% off) | **₹2,499/mo** or **₹24,999/yr**, includes 3 seats; +₹599/seat/mo | From **₹15,000/mo** + setup ₹50k–2L, custom |
| Target buyer | Students, homeowners, trial | Freelance designer, contractor, carpenter-designer | 2–10 person studio, modular kitchen franchise outlet | Dealer, modular kitchen brand, builder sales team |
| Active projects | **2** (archive unlimited, read-only) | Unlimited | Unlimited | Unlimited |
| 2D → 3D, templates | Yes (basic template set) | All templates | All + studio template library | Custom templates (builder unit plans) |
| Material estimate (wastage, pack rounding, contingency) | Yes, view in app | Yes + export | Yes + export | Yes |
| NBC 2016 checks + suggested fixes | **Yes (the hook)** | Yes | Yes | Yes |
| Quotation / estimate PDF | 3xDezine-branded, watermark | **Own logo, GSTIN, T&Cs**; small "Powered by" | Fully white | Fully white, client domain |
| Custom material price list | Default catalogue only | Personal price overrides | Shared studio price library | Dealer or brand SKU catalogue import |
| Renders | Standard-resolution, watermarked | HD, 30/mo | HD, 100/mo + 10 walkthrough videos/mo | Custom quotas |
| Sharing | Public link (branded) | Link + client view | Client portal: proposals with cost deltas, approvals | Embedded on client site |
| Proposals / cost deltas | View only | Yes | Yes + approval workflow | Yes |
| Version history | 7 days | 90 days | Unlimited | Unlimited |
| Seats / permissions | 1 | 1 | 3+ with roles, review mode | SSO / roles, SLA |
| Support | Community / WhatsApp channel | Email/WhatsApp, 48 hours | Priority WhatsApp, onboarding call | Named contact |

**Notes**
- Every monthly debit stays under ₹15,000, so UPI AutoPay runs without AFA. The annual Studio plan is above ₹15k, so sell it as a one-time payment with a renewal reminder.
- The **Student plan** is the Free tier with 5 projects and a verified college email **[E]**.
- **Launch offer:** a "Founding member" price of ₹4,999/yr for Solo, locked for life, limited to the first 200 users. This creates urgency and early annual cash.

### 4.2 Add-on revenue lines
1. **Render and walkthrough credit packs** (usage, for all tiers including Free):
   - 10 HD renders for ₹199
   - 1 4K walkthrough video for ₹299
   - 10 walkthroughs for ₹1,999

   Also a **per-project unlock** at ₹399 per project for 6 months: removes the watermark and unlocks the branded PDF for one-off contractors. All are one-time UPI payments via Razorpay payment links or Checkout. This is only worth building once renders cost real compute (cloud GPU); otherwise sell the per-project unlock only.
2. **Dealer or brand pilot** (white-label or sponsored catalogue), starting around month 5:
   - one regional plywood, tile or hardware dealer, or one modular kitchen maker
   - pilot at ₹15–30k a month, or a ₹50–75k one-time setup plus a monthly fee **[E]**
   - deliverables: pre-loaded SKUs with live INR prices, dealer branding, a monthly report of estimates containing their SKUs (aggregated, DPDP-safe)

### 4.3 Targets and assumptions (all [E])

**Assumptions**
- Sign-ups ramp from about 50/mo (months 1–3) to about 500/mo (months 10–12), about 3,000 in total, from the referral loop, Reels/YouTube, IIID and college codes, and ACETECH.
- Free-to-paid within 90 days is 4%, at the low end of SMB freemium benchmarks, uplifted by the 14-day trial.
- Logo churn is 4% a month on monthly plans and close to 0 within the year on annual plans.
- 80% of paying accounts take Solo and 20% take Studio. 50% pay annually.
- Effective ARPA is about ₹630/mo for Solo (blended monthly and annual) and about ₹2,300 for Studio (some with extra seats).
- Add-ons reach about ₹15k/mo by month 12. Payment and tax costs are about 4% of revenue.

| Metric (end of month 12) | Conservative | **Base** | Stretch |
|---|---|---|---|
| Cumulative sign-ups | 1,500 | **3,000** | 6,000 |
| Paying accounts (active) | 40 | **100** | 220 |
| of which Studio | 6 | **20** | 45 |
| Subscription MRR | ₹38k | **₹1.0 lakh** | ₹2.4 lakh |
| Add-on MRR (credits/unlocks) | ₹5k | **₹15k** | ₹35k |
| White-label / dealer pilots | 0 | **1** (≈ ₹20k/mo) | 2–3 (≈ ₹60k/mo) |
| **Total MRR** | **≈ ₹43k** | **≈ ₹1.35 lakh** | **≈ ₹3.3 lakh** |
| Year-1 cash collected (annual prepay brings it forward) | ≈ ₹3 lakh | **≈ ₹9–10 lakh** | ≈ ₹22 lakh |
| GST registration | Optional | Optional (ARR run-rate ≈ ₹16L), **register by about month 10 as ₹20L nears** | Mandatory around month 9 |

**Checkpoints:** Each one decides whether to keep investing.
- **Month 3:** 20 paying founding members. If missed, the value is wrong, so fix it before marketing.
- **Month 6:** ₹40k MRR. Free → paid ≥ 3%, and ≥ 30% of new sign-ups arriving via shared links.
- **Month 9:** First dealer or kitchen-maker pilot signed.
- **Month 12:** ₹1–1.5 lakh MRR. Monthly logo churn ≤ 4%.

### 4.4 Build order (months 0–3)
1. Razorpay account (individual) and the Subscriptions and Payment Links API. Use a Supabase `subscriptions` table updated by a Razorpay webhook through a Supabase Edge Function. The static site cannot hold secrets, so all signature verification happens in the Edge Function.
2. Entitlements in the client:
   - project count
   - PDF branding
   - render resolution
   - history window
   - seats
3. Branded footer and "make yours free" CTA on shared links and PDFs, plus referral codes.
4. Privacy policy, ToS with a processor clause for homeowner data, a grievance contact, under-18 block, and a cookie-light analytics setup.
5. GST decision with a CA. Invoice template (Rule 46) via Razorpay Invoices.

---

## Sources

Accessed 2026-10-16 unless a date is shown. Publication dates are shown where known.

**Pricing anchors and comparables**
- Vyapar: https://techjockey.com/detail/vyapar ; https://vyaparapp.in/index.php/pricing
- myBillBook: https://www.capterra.com/p/202732/FloBooks/pricing/ ; https://www.softwaresuggest.com/mybillbook/pricing
- Zoho Books India: https://www.patronaccounting.com/blog/zoho-books-pricing-india-2026 (2026)
- TallyPrime: https://tallysolutions.com/business-guides/tallyprime-total-cost-of-ownership-india/
- Khatabook: https://www.g2.com/products/khatabook/pricing ; https://freetrial.mybillbook.in/billing-alternative-khatabook.html
- Dukaan: https://www.softwaresuggest.com/dukaan/pricing ; https://www.saasworthy.com/product/dukaan-io/pricing
- DesignQuote: https://designquote.in/
- DzynFlow: https://dzynflow.com/blog/interior-quotation-software
- Plannio: https://www.plannio.in/blog/how-to-make-interior-design-boq-india ; pricing via search summary
- InteriorOS: https://www.hunted.space/product/interioros
- HelloGrowthCRM: https://hellogrowthcrm.com/best-crm-for-interior-designers-india
- Foyr Neo: https://www.saasworthy.com/product/foyr-neo/pricing ; https://www.capterra.in/software/204757/foyr-neo
- Coohom: https://www.capterra.in/software/192882/coohom ; https://pricingsaas.com/companies/coohom/diffs/2026W30 (Jul 2026)
- Houzz Pro: https://dupple.com/reviews/houzz-pro (updated Jul–Sep 2026) ; https://www.softwareadvice.com/project-management/houzz-pro-profile/

**Market players and lead-generation benchmarks**
- Livspace FY25: https://www.business-standard.com/companies/news/livspace-revenue-rises-23-to-1-460-cr-in-fy25-losses-come-down-125101300850_1.html (13 Oct 2025)
- HomeLane FY25: https://pulse.d2cinsider.com/homelane-cuts-fy25-loss-while-revenue-ramps-up-22-a-strategic-rebound-in-indias-d2c-home-interiors-space/
- HomeLane franchise stores: https://www.retail4growth.com/news/lite/homelane-plans-retail-footprint-with-100-franchise-stores-7682 ; https://www.franchiseindia.com/index.php/insights/en/news/homelane-hits-profitability-milestone-ramps-up-franchise-expansion-across-india.58124
- Livspace design partner model: https://www.overseasjobs.com/job/details/35974165/design-partner
- Urban Company commission (RHP summary): https://recipe.finology.in/discover/premium-stock-research/urban-company-fundamental-analysis ; https://synapseindia.com/article/workflow-of-urban-company-and-drive-users-to-reach-us-for-insights-and-quote
- Sulekha model: https://knowledgebase.bison.co.in/view_article.php?id=485 ; https://www.leadsquared.com/sulekha-leads
- JustDial investor presentation: https://nsearchives.nseindia.com/corporate/chintan_13042026222656_Investor_Presentation.pdf (13 Apr 2026)
- Market size: https://www.imarcgroup.com/india-interior-design-market ; https://www.mordorintelligence.com/industry-reports/india-interior-design-market/market-size

**Brand partnerships**
- Somany visualiser: https://www.digit.in/press-release/general/somany-ceramics-launches-industrys-first-3d-tile-visualizer-33278.html
- Brand AR visualisation (Kajaria, Somany): https://www.markhub24.com/post/orientbell-tiles-visualizer-led-communication-strategy
- Asian Paints Beautiful Homes Service: https://www.beautifulhomes.asianpaints.com/magazine/lifestyle/features/ten-reasons-why-india-is-ready-for-a-new-interior-design-service.html
- Häfele design studios: https://www.hafeleindia.com/en/info/about-haefele/press/press-releases/mumbai-franchise-launch/7219/
- Roomvo: https://get.roomvo.com/solutions/visualizer-tile-retailers/
- Amazon.in affiliate rates: https://www.wscubetech.com/blog/affiliate-marketing-amazon/ ; https://www.cuelinks.com/blog/?p=2372

**Payment gateways**
- Razorpay pricing: https://razorpay.com/pricing/
- Razorpay onboarding: https://razorpay.com/docs/payments/create-account/ ; https://razorpay.com/blog/?p=28068 ; https://razorpay.com/blog/?p=28113
- Razorpay Route: https://razorpay.com/docs/payments/settlements/direct/route
- Razorpay subscription payment methods: https://razorpay.com/docs/payments/subscriptions/supported-payment-methods.md
- Razorpay 2026 subscriptions blog: https://razorpay.com/blog/payment-gateway-support-for-subscription-businesses-key-considerations-in-2026/
- Cashfree: https://www.cashfree.com/payment-gateway-charges/
- PayU: https://www.skydo.com/compare/payu-pricing ; https://wise.com/in/blog/payumoney-payment-gateway-pricing-charges-features
- Stripe invite-only: https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india ; https://thepaypers.com/payments/news/stripe-moves-to-invite-only-in-india

**RBI rules**
- E-mandate: https://www.business-standard.com/article/finance/new-e-mandate-guidelines-rbi-enhances-limit-for-e-mandates-on-credit-debit-cards-to-rs-15-000-122060800417_1.html (Jun 2022) ; https://www.business-standard.com/amp/economy/interviews/rbi-raises-limit-of-e-mandates-for-recurring-online-transactions-to-1-lakh-123120801110_1.html (Dec 2023) ; https://ksandk.com/newsletter/rbi-e-mandate-framework/ (Apr 2026) ; https://www.businesstoday.in/amp/personal-finance/banking/story/now-control-your-auto-debit-payments-rbis-new-rules-explained-526860-2026-04-22 (22 Apr 2026) ; https://razorpay.com/docs/announcements/rbi-card-mandate-guidelines/recurring-payments/
- Payment Aggregator Directions 2025: https://inc42.com/buzz/rbi-issues-new-master-directions-for-payment-aggregators ; https://indiacorplaw.in/2025/10/09/decoding-rbis-overhaul-of-the-payment-aggregator-directions/ (9 Oct 2025) ; https://lexplosion.in/rbi-issues-new-master-directions-to-consolidate-all-regulations-related-to-payment-aggregators-effective-immediately/

**Google Play**
- https://techcrunch.com/2023/05/17/google-pushes-ahead-with-in-app-billing-policy-in-india-insists-watchdog-compliance (17 May 2023)
- https://www.sentinelassam.com/science-and-technology/less-than-60-of-2-lakh-indian-developers-pay-service-fee-above-15-google-649928
- https://www.thestatesman.com/technology/cci-orders-inquiry-in-google-not-complying-with-its-play-store-billing-order-1503180956.html

**GST**
- https://gstzen.in/a/integrated-tax-notification-102017-seeks-to-exempt-persons-making-inter-state-supplies-of-taxable-services-from-registration-under-section-232.html
- https://www.kanakkupillai.com/learn/new-gst-registration-threshold-limit-for-services/
- https://www.incorpx.io/blog/saas-business-gst-guide-india
- https://taxadda.com/decoding-oidar-services-under-gst/
- https://tallysolutions.com/gst/gst-invoice-format-mandatory-fields-rules-and-examples-for-businesses/
- https://www.gimbooks.com/blog/5-crore-e-invoice-turnover-rule-2026/amp/

**DPDP**
- https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/ (14 Nov 2025)
- https://www.storyboard18.com/amp/digital/breaking-govt-notifies-final-dpdp-rules-sets-staggered-rollout-with-key-obligations-for-data-fiduciaries-84201.htm
- https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2025/11/dpdp-rules-2025-guidance-to-dpdp-act-implementation.pdf (Nov 2025)
- https://www.lawrbit.com/article/digital-personal-data-protection-rules-2025
- https://amlegals.com/digital-personal-data-protection-rules-2025/
- https://blog.ipleaders.in/dpdp-rules-2025-operational-compliance-guide/ (verified 8 May 2026)
- https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-
- PIB backgrounder PDF, not machine-readable in this session: https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf

**Go-to-market**
- IIID: https://archgyan.com/?p=4358 ; https://mgsarchitecture.in/updates/event-reports/iiid-vision-summit-2020.html ; https://sourcinghardware.net/iiid-bengaluru-chapter-joins-india-kitchen-congress-2025-as-institutional-partner/
- ACETECH Mumbai 2026: https://www.tradefairdates.com/Acetech-M9585/Mumbai.html ; https://tradefest.io/en/event/acetech-mumbai
- India Design ID: https://www.dezeen.com/?p=2295190 ; https://www.studiomatrx.org/academy/events ; https://sourcinghardware.net/event/india-design-id-mumbai/
- Influencer directory: https://www.modash.io/find-influencers/india/interior-design (Mar 2026)

**Conversion and CAC benchmarks**
- https://upgrowth.in/conversion-rate-benchmarks-for-indian-startups/
- https://inc42.com/?p=21954
- https://www.getmonetizely.com/articles/freemium-conversion-rate-the-key-metric-that-drives-saas-growth-3588c
- https://upgrowth.in/cac-benchmarks-indian-b2b-saas-arr-band-2026/
- https://www.efinancialmodels.com/?p=653269

---

## Unverified claims (treat with caution)
1. Plannio's INR plan prices come from a search summary; the pricing page was not fetched directly.
2. Foyr Neo, Coohom and Houzz Pro prices come from third-party listings that conflict. Coohom's July 2026 render-cap change comes from a tracker site.
3. Vyapar, myBillBook, Zoho Books and Dukaan INR prices vary across third-party sites, and official pages were not fetched (except via search snippets).
4. Khatabook premium price (₹156/mo) is a competitor's claim.
5. The Urban Company 28% commission comes from a secondary summary of its RHP.
6. Interior lead prices on Sulekha, JustDial and Urban Company are not published. My ₹300–2,000 per lead is an estimate.
7. Kajaria and Somany AR visualisers come from a secondary citation of Mordor Intelligence. No Roomvo deployment in India was found.
8. Amazon.in affiliate rates for furniture and home improvement are reported at 3–9%; there is no official rate card.
9. Livspace designer profit share (50% vs 70%) comes from recruiting posts. HomeLane's 10% franchise share is an older figure.
10. The RBI April 2026 consolidated e-mandate directions come from secondary reports, not the RBI text.
11. The CCI and Google Play non-compliance inquiry outcome and any 2025–26 fee changes were not found.
12. IIID membership of 8–10k comes from 2018–2020 figures.
13. India Design ID 2027 dates are not announced (expected about Feb 2027).
14. CAC benchmarks for Indian SMB SaaS come from blogs with unclear methodology.
15. Freemium and trial conversion benchmarks are vendor or consultancy blog figures.
16. Cashfree and PayU onboarding for unregistered individuals was not checked. PayU subscription pricing is not published.
17. The DPDP commencement date for the main duties is 13 or 14 May 2027; sources differ by a day.
18. The claim that inter-state services need GST registration regardless of turnover (one blog) appears wrong but was not confirmed.

## Needs a lawyer / CA
1. **GST:** whether and when to register voluntarily; the correct SAC (998313 vs 998314/OIDAR); the place-of-supply rules for inter-state B2B and B2C; GST on Google Play sales and e-commerce operator (ECO) rules; the LUT for export customers; invoice format before and after registration.
2. **Income tax:** individual vs sole proprietorship vs OPC or LLP; presumptive taxation eligibility; TDS (194J/194O) when B2B customers deduct tax.
3. **Payments:** confirm the current RBI e-mandate master direction text (₹15k AFA, 24-hour pre-debit notice); handling annual plans above ₹15k; refund policy wording.
4. **Escrow or milestone payments:** whether any homeowner-to-contractor payment flow, even through Razorpay Route, creates PA, marketplace, consumer-protection or liability exposure.
5. **DPDP:** the fiduciary vs processor split for designer-uploaded homeowner data; privacy notice and consent text; processor terms in the ToS; breach response plan; children; cross-border transfer via Supabase region choice; whether lead sharing needs separate consent.
6. **Consumer protection and advertising:** CCPA Dark Patterns Guidelines 2023 for auto-renewal, free trial and cancellation flows; disclosure of sponsored catalogue items; E-Commerce Rules 2020 applicability.
7. **Contracts:** white-label MSA and SLA, data processing agreements with dealers and brands, liability limits on NBC "plan check" advice. Make clear it is guidance, not a statutory approval.
8. **Google Play policy:** whether linking to web checkout from the Android app is allowed under the current India user-choice-billing terms.
