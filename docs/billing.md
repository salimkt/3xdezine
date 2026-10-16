# 3xDezine billing (Razorpay)

Plans, entitlements and payments. Prices and gates are in `shared/business.ts`
(`PRICES`, `Entitlements`) and `shared/plans.ts`; tiers are explained in
`docs/strategy.md`. The server side is in `supabase/` (see `docs/cloud.md`).

| Product | Razorpay object | Price (ex-GST) | Secret holding the plan id |
|---|---|---|---|
| Project Pass (one project, 90 days) | Order | ₹499 one-off | none (amount from `PRICES`) |
| Solo monthly | Subscription | ₹799 / month | `RAZORPAY_PLAN_SOLO_MONTH` |
| Solo yearly | Subscription | ₹7,999 / year | `RAZORPAY_PLAN_SOLO_YEAR` |
| Studio monthly (3 seats) | Subscription | ₹2,499 / month | `RAZORPAY_PLAN_STUDIO_MONTH` |
| Studio yearly (3 seats) | Subscription | ₹24,999 / year | `RAZORPAY_PLAN_STUDIO_YEAR` |

Business is sales-led: `create-checkout` refuses it.

## How it works

1. The web app calls `create-checkout` with `{ plan, interval, projectId? }`.
   - A Project Pass creates a Razorpay **order** (`POST /v1/orders`) for a
     project the caller owns.
   - Solo or Studio creates a Razorpay **subscription** (`POST /v1/subscriptions`)
     on the plan id from the secret, with `total_count` set to 120 monthly or
     10 yearly cycles. Razorpay needs a finite count.
   - The checkout is recorded first, in `checkout_orders` or as a `subscriptions`
     row with status `CREATED`. The response carries `keyId` (public) and the
     `orderId` or `subscriptionId` for Razorpay Checkout.js.
2. The customer pays in Razorpay Checkout (UPI AutoPay, card or netbanking).
3. Razorpay calls **`razorpay-webhook`**. That call, and only that call, changes
   entitlements. Checkout.js's client-side success callback is not trusted.
   - The signature check is `X-Razorpay-Signature == hex(HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, raw body))`.
     It runs on the raw bytes before parsing and uses a constant-time compare.
     A bad or missing signature gets 401.
   - Idempotency uses `X-Razorpay-Event-Id`. Processed ids are stored in
     `billing_events`, and a replay returns `{ duplicate: true }` without
     touching anything. Every write is also idempotent on its own: payments and
     passes are unique on the payment id, and the period end only moves
     forward. A duplicate delivered concurrently is therefore harmless too.
   - `payment.captured` for one of our Project Pass orders checks that the
     amount and currency match the order. It then appends to `payments` and
     creates a `project_passes` row for 90 days, starting after any unexpired
     pass on that project.
   - `subscription.*` events (`authenticated`, `activated`, `charged`,
     `pending`, `halted`, `cancelled`, `completed`, `paused`, `resumed`,
     `updated`) set the subscription's status from the event's entity and move
     `current_period_end` to the entity's `current_end`. `charged` and
     `activated` with a captured payment also append to `payments`.
   - Any failure returns 500, and Razorpay retries.
4. `get-entitlements` combines live subscriptions and unexpired passes through
   `shared/plans.ts`. A subscription counts as live while it is `ACTIVE`,
   `AUTHENTICATED`, `PENDING` or `CANCELLED` and `current_period_end` is in the
   future. Cancelled users keep what they paid for until the period ends;
   `HALTED` loses access at once. A seat in someone's studio inherits that
   owner's Studio or Business plan.

### What is enforced server-side

| Gate | Where |
|---|---|
| `maxActiveProjects` (Free: 2) | `create-project` → `FORBIDDEN`, names the plan |
| Doc types = plan's `docTypes` ∩ `allowedDocTypes(studio GST registration)` | `issue-quote` |
| Watermark = `!brandedQuotes`, after Project Pass for that project; logo and brand colour stripped from the supplier snapshot when unbranded | `save-quote-draft`, `issue-quote` |
| `rateCards` (custom rates); without it, the default card is used even if overrides are stored | `save-rate-overrides`, quote build |
| `modular` (modular lines) | `save-quote-draft`, `issue-quote`, `create-variation-order` |
| `variationOrders` | `create-variation-order`, `issue-quote` |

## Setting up Razorpay (owner)

1. **Create the account** at <https://dashboard.razorpay.com/signup>. An
   individual or sole proprietor can complete KYC with a **PAN**, bank account
   and address proof. GST registration is not needed to start. Test mode is
   available immediately; live mode needs KYC approval.
2. **API keys.** Go to Dashboard → Account & Settings → API Keys.
   - **Test** keys start `rzp_test_`. No real money moves, and test cards and
     UPI ids are listed in Razorpay's docs ("Test Card Details").
   - **Live** keys start `rzp_live_`. They are issued only after KYC.
   The key **secret** is shown once, so store it in a password manager.
3. **Plans.** Go to Dashboard → Subscriptions → Plans → Create Plan, once in
   **test** mode and again in **live** mode, because plan ids differ between
   modes. Create four plans:

   | Plan name | Billing | Amount | Secret |
   |---|---|---|---|
   | 3xDezine Solo monthly | every 1 month | ₹799 | `RAZORPAY_PLAN_SOLO_MONTH` |
   | 3xDezine Solo yearly | every 1 year | ₹7,999 | `RAZORPAY_PLAN_SOLO_YEAR` |
   | 3xDezine Studio monthly | every 1 month | ₹2,499 | `RAZORPAY_PLAN_STUDIO_MONTH` |
   | 3xDezine Studio yearly | every 1 year | ₹24,999 | `RAZORPAY_PLAN_STUDIO_YEAR` |

   Copy each `plan_…` id. Keep the amounts equal to `PRICES` in
   `shared/business.ts`, which the app displays. Once GST-registered, see
   below.
4. **Webhook.** Go to Dashboard → Account & Settings → Webhooks → Add New
   Webhook. Do this in each mode.
   - URL: `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   - Secret: a long random string, e.g. `openssl rand -hex 32`. This is
     `RAZORPAY_WEBHOOK_SECRET`.
   - Active events: `payment.captured`, `subscription.authenticated`,
     `subscription.activated`, `subscription.charged`, `subscription.pending`,
     `subscription.halted`, `subscription.cancelled`, `subscription.completed`,
     `subscription.paused`, `subscription.resumed`, `subscription.updated`.
5. **Secrets.** Never commit these:
   ```sh
   npx supabase secrets set \
     RAZORPAY_KEY_ID=rzp_test_xxx \
     RAZORPAY_KEY_SECRET=xxx \
     RAZORPAY_WEBHOOK_SECRET=xxx \
     RAZORPAY_PLAN_SOLO_MONTH=plan_xxx \
     RAZORPAY_PLAN_SOLO_YEAR=plan_xxx \
     RAZORPAY_PLAN_STUDIO_MONTH=plan_xxx \
     RAZORPAY_PLAN_STUDIO_YEAR=plan_xxx
   ```
   Never set `BILLING_SIMULATION` in production. Switching to live means
   setting the same names again with live values.
6. **Smoke test in test mode.** Buy a Project Pass with a test card. In the
   Razorpay dashboard, the webhook should show a `200` response. In Supabase,
   `payments` and `project_passes` should each gain a row, and
   `get-entitlements` should list the project in `passProjectIds`.

## Local development: simulated billing

Without Razorpay keys, `create-checkout` returns
`"Billing is not configured yet"`. For local work the checkout can be simulated.
Simulation is on only when all three of these hold:

- the secret `BILLING_SIMULATION=1` is set,
- **no** `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is set, and
- `SUPABASE_URL` is the local stack (`kong`, `localhost`, `127.0.0.1`).

A deployed project fails the first and third conditions, even if someone sets
the flag by mistake.

```sh
cp supabase/functions/.env.example supabase/functions/.env   # gitignored; sets BILLING_SIMULATION=1 + a local webhook secret
npm run sb:stop && npm run sb:start                           # the edge runtime reads functions/.env at start
```

Then:

- `create-checkout { plan, interval, projectId? }` returns `simulated: true`,
  `keyId: "rzp_test_simulated"` and an `order_sim_…` or `sub_sim_…` id.
  Nothing is granted yet.
- `create-checkout { simulateSuccess: true, orderId | subscriptionId }`
  completes that checkout. To create and complete in one call, send
  `simulateSuccess: true` with the plan fields. This builds a Razorpay-shaped
  `payment.captured` or `subscription.activated` event and runs it through
  **the same processing code as the webhook**. Rows are marked `simulated`.
- `razorpay-webhook` works locally too: sign a body with the local
  `RAZORPAY_WEBHOOK_SECRET`, as `supabase/tests/e2e.ts` does.

The web app should show a "Simulated checkout (local dev)" button instead of
opening Razorpay Checkout when `simulated` is true.

## Needs a CA

- **GST on our own subscriptions.** Prices are ex-GST. Registration becomes
  mandatory at ₹20 lakh of turnover for services; voluntary registration is
  possible earlier. Once registered, 18% GST (SAC 9983xx/9984xx, to be
  confirmed) has to be charged. The plans can be recreated at GST-inclusive
  amounts (₹943, ₹9,439, ₹2,949, ₹29,499), or the tax can be added via
  `PRICES`. Also decide B2B (customer GSTIN, input credit) vs B2C, and the
  place of supply from the customer's state.
- **Invoices to subscribers.** A registered supplier must issue a tax invoice
  for each charge (Rule 46), consecutively numbered per financial year.
  Razorpay can generate subscription invoices; decide with the CA whether
  those suffice or whether 3xDezine issues its own. Until registration, issue
  a plain receipt.
- **TDS/TCS and export** (international cards), **refund policy** wording,
  and how long payment records must be retained. The `payments` table is
  append-only and is never pruned.
- The tax maths inside designers' quotations comes from `shared/gst.ts`: CGST
  plus SGST/UTGST for an intra-state site, IGST for inter-state, and composition
  and unregistered wording. The product encodes the rules but does not give tax
  advice.
