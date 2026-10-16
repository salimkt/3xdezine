# 3xDezine — strategy

Synthesised from four research reports in `docs/research/` (market, competitors,
monetisation, workflows), October 2026. Figures carry the confidence stated in those
reports; read them before quoting a number to anyone.

## The one-line bet

**Plan → 3D → a defensible, GST-ready quotation the client approves on WhatsApp — for the
independent designer who today does this in AutoCAD, Excel and screenshots.**

## Why this, and why now

- **The market is almost entirely unorganised.** The listed turnkey platforms (Livspace,
  HomeLane + DesignCafe, Bonito) together made about ₹2,300 cr in FY25 — on the order of 1%
  of even conservative market estimates. Most homes are done by small studios, contractors
  and carpenters. *(01-market)*
- **The platforms prove the workflow and are failing at the business.** Livspace lost
  ₹242 cr in FY25 and cut ~1,000 jobs in Feb 2026; HomeLane lost ₹111 cr; Bonito's revenue
  fell 25%. Execution is what burns cash. Both built in-house 3D-plus-live-budget tools
  (Canvas, SpaceCraft) because that is what closes sales — and nobody sells that tool to the
  independent designer. *(01-market, 02-competitors)*
- **The pain is documented, not assumed.** Consumer-court refund orders against NoBroker,
  Bonito and Regalo; complaints cluster on delays, hidden cost escalation, advance disputes and
  approvals lost in WhatsApp. Root causes in disputes: undefined per-sq-ft scope, missing
  exclusions, brand-less lines, verbal changes. *(01-market, 04-workflows)*
- **The gap is specific.** Visualisers (Foyr, Coohom, Homestyler, Planner 5D) make pictures
  without a defensible BOQ or GST. Modular CAD (Infurnia ~₹8.5k/seat/month, imos, 2020)
  is too expensive for a solo designer. US studio tools (Houzz Pro, DesignFiles, Programa) cost
  $55–199/user/month and don't do GST. Indian quoting tools (StudioMatrx ₹999/yr, DesignQuote)
  aren't tied to a model. No competitor checks plans against NBC. *(02-competitors)*

## Customer

**Primary:** solo designers and 1–5 person design-and-build studios in Tier-1/2 cities
(start with Pune and Mumbai — the rate data is Maharashtra-anchored), doing ₹5–25 lakh
residential jobs, who quote fixed prices and absorb overruns.

**Not first:** homeowners (a free acquisition channel, not the payer); modular kitchen makers
(pay most, but need cut-lists and factory export); material brands and dealers (big budgets,
slow cycles — wave two, once there are ~500 active designers).

## What we sell — product pillars

| # | Pillar | Why it wins | Status |
|---|---|---|---|
| 1 | **Quotation & BOQ from the model** — trade lines (labour + material, sq ft / rft / point / nos / LS), quantities traced to plan geometry, room-wise ⇄ trade-wise, design fee, GST split by place of supply with HSN/SAC, payment milestones, Indian numbering, A4 print | The artefact designers live in; ties price to the drawing | **Build now** |
| 2 | **Client approval link** — no-login link, quote + plan + 3D, approve or request changes, pinned to a document hash, then locked; changes only by variation order | Replaces WhatsApp screenshots as evidence; the referral loop | **Build now** |
| 3 | **Modular kitchen & wardrobe v1** — cabinet runs on plan walls, zone specs (carcass / shutter / hardware tier), auto-filled modules, priced by rft or sq ft of front, hardware counts, shown in 3D | 45–70% of ticket value is here | **Build now** |
| 4 | **Studio profile & rate cards** — branding, GSTIN (validated), state, bank/UPI, terms; rate cards with editable material and labour rates over a default metro pack | Designers price their own way; PWD rates suit civil, not carpentry | **Build now** |
| 5 | **Plans, entitlements & billing** — tiers below, enforced server-side; Razorpay subscriptions and one-off Project Pass; "Made with 3xDezine" on free shares | Revenue | **Build now (test mode)** |
| — | Already built | 2D→3D WebGPU, NBC checks with fixes, templates, roles, proposals, versions, Android | ✓ |
| — | Later | AI restyle within budget, 4K/walkthrough export, city & brand rate packs, cut-lists, Android quoting, site measurement, lead-gen | Not now |

## Pricing (ex-GST; GST at 18% once registered)

| Tier | Price | Gates |
|---|---|---|
| **Free** | ₹0 | 2 active projects; estimate, 3D and NBC checks free (the hook); quotations (not invoices) with client approval links, all carrying "Made with 3xDezine" — every free quote a homeowner receives is an ad; edit any rate on a quote, but no saved rate cards; no modular configurator; 7-day history |
| **Project Pass** | ₹499 per project, one-off | One project's quotes unbranded with your studio details, client approval link, 90 days |
| **Solo** | ₹799/month · ₹7,999/year | Unlimited projects, branded GST quotes, approvals, rate cards, modular configurator, variation orders, 90-day history |
| **Studio** | ₹2,499/month (3 seats, +₹599/seat) · ₹24,999/year | Team seats and roles, shared rate cards and branding, unlimited history |
| **Business** | from ₹14,999/month | White-label catalogue for a dealer, brand or kitchen maker — sales-led, later |

Every monthly price sits under ₹15,000, so UPI AutoPay needs no extra authentication per
debit. Sell on the web only, to avoid the ~11% Google Play billing fee on Android.
*(03-monetisation, 02-competitors)*

## Go-to-market

1. **The product is the channel**: every free share link and quotation PDF says
   "Made with 3xDezine — make yours free". Homeowners forward quotes; designers see them.
2. Instagram Reels and YouTube showing *plan → 3D → GST quote in five minutes*.
3. Designer and carpenter WhatsApp groups; IIID chapters; design colleges (student tier later).
4. ACETECH Mumbai (19–22 Nov 2026) — a booth is expensive; walking the floor with a demo isn't.
5. One paid pilot with a dealer or kitchen maker (~₹20k/month) to validate the Business tier.

## 12-month targets (estimates)

Base case: ~3,000 sign-ups, ~100 paying accounts, ~₹1.35 lakh MRR, assuming 4% free-to-paid
and 4% monthly churn. Conservative ~₹43k, stretch ~₹3.3 lakh MRR. GST registration becomes
mandatory around month 10 in the base case (₹20 lakh services threshold). *(03-monetisation)*

## Risks

- **Rates are planning ranges, not market rates.** Published Indian rate data disagrees by up
  to 2×. Mitigation: every rate is editable, carries a source and confidence, and quotes say
  so. Interviews with 5–10 studios are the next research step.
- **Legal and tax details need a CA.** SAC sub-codes for finishing works, notification numbers
  cited from memory, composition-scheme wording. The product makes the tax maths correct for
  the rules it encodes; it does not give tax advice.
- **DPDP obligations** start around May 2027 (breach reporting, retention, grievances).
  For homeowner data a designer enters, the designer is likely the fiduciary and 3xDezine the
  processor — terms of service must say so.
- **WebGPU** doesn't run on older Android phones; the approval link must degrade to plan +
  quote without 3D.

## What only the owner can do

- Create a **Supabase** project (see `docs/cloud.md`).
- Create a **Razorpay** account (PAN-based KYC is enough for an individual) and add the
  test keys; live keys after KYC.
- Decide on **GST registration** with a CA, and publish terms of service and a privacy policy.
