#!/usr/bin/env -S npx tsx
/**
 * 3xDezine go-live: connects the static site to a hosted Supabase project and
 * (optionally) Razorpay, in one idempotent run. Safe to re-run after a failure.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...        # supabase.com/dashboard/account/tokens
 *   SUPABASE_DB_PASSWORD=...             # the project's database password
 *   RAZORPAY_KEY_ID=rzp_test_...         # optional — omit to go live without billing
 *   RAZORPAY_KEY_SECRET=...
 *   RAZORPAY_WEBHOOK_SECRET=...          # optional — generated if absent
 *   npx tsx scripts/go-live.ts --project-ref <ref> [--dry-run] [--skip-billing]
 *
 * What it does, in order:
 *   1. Preflight: tools, tokens, the project exists, shared code is in sync.
 *   2. Links the repo to the project, pushes migrations, deploys every function.
 *   3. Sets the hosted project's auth site URL and redirect allow-list.
 *   4. Razorpay: finds or creates the four subscription plans from PRICES in
 *      shared/business.ts (the same constant the server enforces), so prices
 *      cannot drift between Razorpay and the app.
 *   5. Sets function secrets (APP_URL, Razorpay keys, plan ids, webhook secret)
 *      via a 0600 temp file — never on the command line, where other processes
 *      could read them — and removes BILLING_SIMULATION, which must never exist
 *      in production.
 *   6. Publishes VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY as GitHub Actions
 *      variables (both are public by design) and redeploys GitHub Pages.
 *   7. Smoke-tests the deployed functions and prints the remaining manual steps.
 *
 * Secrets are read from the environment and never printed, with one deliberate
 * exception: a freshly generated webhook secret is printed once, because you
 * have to paste it into the Razorpay dashboard.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRICES, type PlanPrice } from '../shared/business.ts';

// ---------------------------------------------------------------------------
// Arguments and environment
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const REF = opt('project-ref');
const DRY = flag('dry-run');
const SKIP_BILLING = flag('skip-billing');
const SITE = (opt('site') ?? 'https://salimkt.github.io/3xdezine/').replace(/\/?$/, '/');
const REPO = opt('repo') ?? 'salimkt/3xdezine';

const env = process.env;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const DB_PASSWORD = env.SUPABASE_DB_PASSWORD;
const RZP_ID = env.RAZORPAY_KEY_ID;
const RZP_SECRET = env.RAZORPAY_KEY_SECRET;
const BILLING = !SKIP_BILLING && Boolean(RZP_ID || RZP_SECRET);

const MGMT = 'https://api.supabase.com/v1';
const RZP = 'https://api.razorpay.com/v1';

/** Razorpay plan id env name → which PRICES entry it is. */
const SUBSCRIPTION_PRICES = PRICES.filter(
  (p): p is PlanPrice & { razorpayPlanEnv: string } => Boolean(p.razorpayPlanEnv),
);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

let step = 0;
const head = (title: string) => console.log(`\n\x1b[1m${++step}. ${title}\x1b[0m`);
const ok = (msg: string) => console.log(`   \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg: string) => console.log(`   · ${msg}`);
const warn = (msg: string) => console.log(`   \x1b[33m!\x1b[0m ${msg}`);
// A declared function (not an arrow) so TypeScript's control-flow analysis
// treats `if (!x) fail(...)` as narrowing `x` afterwards.
function fail(msg: string): never {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command with args (no shell), streaming output. Never pass secrets as args. */
function run(cmd: string, cmdArgs: string[], opts: { secretEnv?: Record<string, string>; quiet?: boolean } = {}) {
  const shown = `${cmd} ${cmdArgs.join(' ')}`;
  if (DRY) {
    info(`[dry-run] would run: ${shown}`);
    return '';
  }
  info(shown);
  return execFileSync(cmd, cmdArgs, {
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...env, ...(opts.secretEnv ?? {}) },
    encoding: 'utf8',
  });
}

function have(cmd: string, versionArgs = ['--version']) {
  try {
    execFileSync(cmd, versionArgs, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function mgmt<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (DRY && method !== 'GET') {
    info(`[dry-run] would ${method} ${path}`);
    return {} as T;
  }
  const res = await fetch(`${MGMT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`Supabase Management API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function rzp<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (DRY && method !== 'GET') {
    info(`[dry-run] would ${method} Razorpay ${path}`);
    return { id: 'plan_dryrun' } as T;
  }
  const res = await fetch(`${RZP}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${RZP_ID}:${RZP_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`Razorpay ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function preflight() {
  head('Preflight');
  if (!REF) fail('Pass --project-ref <ref> (Supabase dashboard → Project Settings → General).');
  if (!/^[a-z0-9]{20}$/.test(REF)) warn(`"${REF}" doesn't look like a Supabase project ref (20 lowercase letters/digits).`);
  if (!ACCESS_TOKEN) fail('Set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens).');
  if (!DB_PASSWORD) fail('Set SUPABASE_DB_PASSWORD (the database password chosen when the project was created).');
  if (!have('gh')) fail('GitHub CLI `gh` is required, logged in as the repo owner.');
  if (!have('npx')) fail('Node/npx is required.');
  if (BILLING) {
    if (!RZP_ID || !RZP_SECRET) fail('Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or pass --skip-billing.');
    if (!/^rzp_(test|live)_/.test(RZP_ID)) fail('RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_.');
    info(`Razorpay mode: ${RZP_ID.startsWith('rzp_live_') ? '\x1b[31mLIVE — real money\x1b[0m' : 'test'}`);
  } else {
    warn('No Razorpay keys — going live without billing. Paid plans will say "Billing is not configured yet". Re-run with keys later.');
  }

  const project = await mgmt<{ name?: string; region?: string; status?: string }>('GET', `/projects/${REF}`);
  ok(`project ${project.name ?? REF} (${project.region ?? '?'}, ${project.status ?? '?'})`);
  if (project.status && project.status !== 'ACTIVE_HEALTHY') warn(`Project status is ${project.status}; deploys may fail until it is ACTIVE_HEALTHY.`);

  // Functions run a committed copy of shared/; deploying a stale copy would
  // ship different maths from what the web client previews.
  execFileSync('node', ['supabase/scripts/sync-shared.mjs', '--check'], { stdio: 'inherit' });
  ok('shared domain code is in sync with the functions');
}

async function deployBackend() {
  head('Database and functions');
  const secretEnv = { SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN!, SUPABASE_DB_PASSWORD: DB_PASSWORD! };
  // The CLI reads SUPABASE_DB_PASSWORD from the environment, so the password
  // never appears in the process list.
  run('npx', ['supabase', 'link', '--project-ref', REF!], { secretEnv });
  run('npx', ['supabase', 'db', 'push', '--include-all'], { secretEnv });
  ok('migrations pushed');
  run('npx', ['supabase', 'functions', 'deploy', '--project-ref', REF!], { secretEnv });
  ok('functions deployed');
}

async function configureAuth() {
  head('Auth URLs');
  // Magic links and OAuth must return to the live site. Localhost stays allowed
  // so the same project can be used from a dev machine.
  const allow = [`${SITE}**`, 'http://localhost:5183/**', 'http://127.0.0.1:5183/**'].join(',');
  await mgmt('PATCH', `/projects/${REF}/config/auth`, { site_url: SITE, uri_allow_list: allow });
  ok(`site URL ${SITE}`);
  info(`redirects ${allow}`);
}

interface RzpPlan {
  id: string;
  period: string;
  interval: number;
  item: { name: string; amount: number; currency: string };
  notes?: Record<string, string>;
}

async function ensurePlans(): Promise<Record<string, string>> {
  head('Razorpay plans');
  const existing = await rzp<{ items: RzpPlan[] }>('GET', '/plans?count=100');
  const ids: Record<string, string> = {};

  for (const price of SUBSCRIPTION_PRICES) {
    const period = price.interval === 'YEAR' ? 'yearly' : 'monthly';
    const key = price.razorpayPlanEnv;
    // Match on our own tag AND the price: if a price changes in PRICES, a new
    // plan is created rather than silently reusing the old amount. Razorpay
    // plans are immutable, so that is the only safe behaviour.
    const match = existing.items?.find(
      (p) => p.notes?.app_plan === key && p.item.amount === price.amount && p.period === period && p.interval === 1,
    );
    if (match) {
      ids[key] = match.id;
      ok(`${price.label}: ${rupees(price.amount)} ${period} → existing ${match.id}`);
      continue;
    }
    const created = await rzp<RzpPlan>('POST', '/plans', {
      period,
      interval: 1,
      item: {
        name: `3xDezine ${price.label}`,
        amount: price.amount,
        currency: 'INR',
        description: `${price.label}. Prices exclude GST.`,
      },
      notes: { app_plan: key },
    });
    ids[key] = created.id;
    ok(`${price.label}: ${rupees(price.amount)} ${period} → created ${created.id}`);
  }
  // Project Pass is a one-off order created per purchase by create-checkout;
  // it needs no plan.
  return ids;
}

async function setSecrets(planIds: Record<string, string>) {
  head('Function secrets');
  const secrets: Record<string, string> = { APP_URL: SITE };
  let generatedWebhookSecret: string | undefined;

  if (BILLING) {
    secrets.RAZORPAY_KEY_ID = RZP_ID!;
    secrets.RAZORPAY_KEY_SECRET = RZP_SECRET!;
    Object.assign(secrets, planIds);
    if (env.RAZORPAY_WEBHOOK_SECRET) {
      secrets.RAZORPAY_WEBHOOK_SECRET = env.RAZORPAY_WEBHOOK_SECRET;
    } else {
      generatedWebhookSecret = randomBytes(32).toString('hex');
      secrets.RAZORPAY_WEBHOOK_SECRET = generatedWebhookSecret;
    }
  }

  info(`setting: ${Object.keys(secrets).join(', ')}`);
  if (!DRY) {
    const dir = mkdtempSync(join(tmpdir(), 'dezine-golive-'));
    const file = join(dir, 'secrets.env');
    try {
      writeFileSync(file, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
      execFileSync('npx', ['supabase', 'secrets', 'set', '--env-file', file, '--project-ref', REF!], {
        stdio: 'inherit',
        env: { ...env, SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN! },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  ok('secrets set (temp file removed)');

  // Simulation must never exist in production. The functions already refuse it
  // off the local stack; unsetting is belt and braces.
  try {
    run('npx', ['supabase', 'secrets', 'unset', 'BILLING_SIMULATION', '--project-ref', REF!], {
      secretEnv: { SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN! },
      quiet: true,
    });
  } catch {
    /* not set — fine */
  }
  ok('BILLING_SIMULATION absent');
  return generatedWebhookSecret;
}

async function publishSite() {
  head('Website');
  const keys = await mgmt<Array<{ name: string; api_key: string; type?: string }>>('GET', `/projects/${REF}/api-keys`);
  const anon = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'anon')?.api_key;
  if (!anon && !DRY) fail('Could not read the anon key from the Management API.');
  const url = `https://${REF}.supabase.co`;
  // Both values are public by design (the anon key ships to every browser; RLS
  // protects the data), so GitHub Actions *variables*, not secrets.
  run('gh', ['variable', 'set', 'VITE_SUPABASE_URL', '--repo', REPO, '--body', url]);
  run('gh', ['variable', 'set', 'VITE_SUPABASE_ANON_KEY', '--repo', REPO, '--body', anon ?? 'dry-run']);
  // Checkout buttons appear only when the server can actually take payment.
  run('gh', ['variable', 'set', 'VITE_BILLING', '--repo', REPO, '--body', BILLING ? '1' : '0']);
  ok('GitHub Actions variables set');
  run('gh', ['workflow', 'run', 'deploy-pages.yml', '--repo', REPO]);
  ok('GitHub Pages redeploy started (gh run watch to follow it)');
  return url;
}

async function smokeTest(url: string) {
  head('Smoke test');
  if (DRY) return info('[dry-run] skipped');
  // Unauthenticated calls must be refused cleanly by deployed functions —
  // proves they're live and enforcing auth, without creating any data.
  for (const fn of ['get-entitlements', 'create-checkout']) {
    const res = await fetch(`${url}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.text();
    if (res.status === 401) ok(`${fn}: 401 for anonymous calls, as it should`);
    else warn(`${fn}: expected 401, got ${res.status} ${body.slice(0, 120)}`);
  }
  const hook = await fetch(`${url}/functions/v1/razorpay-webhook`, { method: 'POST', body: '{}' });
  if (hook.status === 401) ok('razorpay-webhook: rejects unsigned requests');
  else warn(`razorpay-webhook: expected 401 for an unsigned request, got ${hook.status}`);
}

function nextSteps(url: string, webhookSecret?: string) {
  console.log('\n\x1b[1mDone. Remaining manual steps:\x1b[0m');
  const steps: string[] = [];
  if (BILLING) {
    steps.push(
      `Razorpay Dashboard → Settings → Webhooks → Add:\n` +
        `       URL     ${url}/functions/v1/razorpay-webhook\n` +
        `       Secret  ${webhookSecret ?? '(the RAZORPAY_WEBHOOK_SECRET you supplied)'}\n` +
        `       Events  payment.captured, subscription.authenticated, subscription.activated,\n` +
        `               subscription.charged, subscription.pending, subscription.halted,\n` +
        `               subscription.cancelled, subscription.completed, subscription.paused,\n` +
        `               subscription.resumed, subscription.updated`,
    );
    if (webhookSecret) steps.push('Store that webhook secret in your password manager now — it is not saved anywhere else on this machine.');
  } else {
    steps.push('Billing: create a Razorpay account (docs/billing.md), then re-run with RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.');
  }
  steps.push('Supabase → Authentication → Emails → SMTP: add a real sender (Resend, Postmark, SES). The built-in sender is rate-limited and not for production.');
  steps.push('Have the Terms, Privacy and Refund pages reviewed, fill in phone/address in web/src/legal/business.ts, then submit the site for Razorpay website verification.');
  steps.push('Sign up on the live site yourself and run one test-mode purchase end to end before switching to rzp_live_ keys.');
  steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
  console.log('');
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`\x1b[1m3xDezine go-live\x1b[0m${DRY ? '  \x1b[33m(dry run — nothing will change)\x1b[0m' : ''}`);
  console.log(`   project ${REF ?? '?'} · site ${SITE} · repo ${REPO} · billing ${BILLING ? 'on' : 'off'}`);
  await preflight();
  await deployBackend();
  await configureAuth();
  const planIds = BILLING ? await ensurePlans() : {};
  const webhookSecret = await setSecrets(planIds);
  const url = await publishSite();
  await smokeTest(url);
  nextSteps(url, webhookSecret);
}

main().catch((err) => fail(err?.stack ?? String(err)));
