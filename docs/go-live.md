# Going live

Everything is built and tested. Three accounts stand between the code and a
paying product, and only you can create them. After that it is one command.

## 1. Accounts (once, ~30 minutes)

| | Where | What you need from it |
|---|---|---|
| **Supabase** | [supabase.com](https://supabase.com) → New project. Pick region **Mumbai (ap-south-1)**; save the database password. | the **project ref** (Project Settings → General) and the **database password** |
| | [Account → Access tokens](https://supabase.com/dashboard/account/tokens) → Generate | an **access token** (`sbp_…`) |
| **Razorpay** | [dashboard.razorpay.com](https://dashboard.razorpay.com) → sign up; PAN-based KYC is enough for an individual | **test** API keys first (Settings → API Keys): `rzp_test_…` + secret |
| **GitHub** | already done — `gh` is logged in as `salimkt` | — |

Razorpay activates live payments only after it verifies the website: it checks
for pricing, Terms, Privacy, Refund and Contact pages. Those are on the site at
`#/pricing`, `#/terms`, `#/privacy`, `#/refunds`, `#/contact`. Before
submitting, have a lawyer review them and fill in the phone number and address
in `web/src/legal/business.ts` — they are deliberately left blank, not invented.

## 2. One command

Run this yourself; the keys stay on your machine.

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
export SUPABASE_DB_PASSWORD=...
export RAZORPAY_KEY_ID=rzp_test_...
export RAZORPAY_KEY_SECRET=...
npm run go-live -- --project-ref <your-ref> --dry-run   # shows every action, changes nothing
npm run go-live -- --project-ref <your-ref>
```

It links the project, pushes the database, deploys all functions, sets the
auth redirect URLs, creates the four Razorpay plans from the prices in
`shared/business.ts` (re-running finds them instead of duplicating), sets every
function secret without putting any on a command line, removes the
dev-only `BILLING_SIMULATION`, publishes the public Supabase URL and anon key
to GitHub, redeploys the site, and smoke-tests the live functions.

Leave out the two `RAZORPAY_*` lines (or pass `--skip-billing`) to launch
accounts, quotes and approvals first and add billing later.

## 3. After the script

It prints these with your real URLs:

1. **Razorpay webhook** — Dashboard → Settings → Webhooks → Add: the URL and the
   secret it prints, and the listed events. Save the secret in a password
   manager; it isn't stored anywhere else.
2. **Email** — Supabase → Authentication → Emails → SMTP. The built-in sender
   is rate-limited and not meant for production magic links.
3. **One real test** — sign up on the live site, buy a plan in test mode, issue
   a quote, approve it from your phone.
4. **Go live with money** — once Razorpay activates your account, re-run with
   `rzp_live_…` keys. Live plans are created separately from test plans.

## Before charging anyone

- A **CA**: GST registration (mandatory past ₹20 lakh turnover; registering
  early lets studios claim input credit), SAC codes on the rate card, and
  invoicing your own subscribers. When registered, set `GST_REGISTERED = true`
  in the web config so pricing shows "+ 18% GST".
- A **lawyer**: the Terms, Privacy (DPDP Act 2023) and Refund drafts.
- **5–10 studio interviews**: the rates are planning estimates, 54 of 59 marked
  low-confidence. Real prices from real studios are worth more than any feature.
