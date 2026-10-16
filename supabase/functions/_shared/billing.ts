/**
 * Razorpay billing: configuration, the REST client, webhook signature
 * verification and event processing (shared by razorpay-webhook and the
 * local-only simulation in create-checkout).
 *
 * Money from Razorpay is in paise, like ours. Timestamps are unix seconds.
 */
import type { PlanPrice } from './domain/business.ts';
import { admin } from './auth.ts';
import { Fail } from './http.ts';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
export const PASS_DAYS = 90;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type BillingMode =
  | { kind: 'RAZORPAY'; keyId: string; keySecret: string }
  | { kind: 'SIMULATED' }
  | { kind: 'OFF' };

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

/** The local stack's Kong gateway, or localhost. Never a hosted project. */
function isLocalStack(): boolean {
  try {
    const host = new URL(env('SUPABASE_URL')).hostname;
    return ['kong', 'localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Real Razorpay when both keys are set. Simulation only when
 * BILLING_SIMULATION=1, NO Razorpay key is set at all, and the functions run
 * against a local stack — three independent conditions, so a production
 * deploy can't fall into it by accident.
 */
export function billingMode(): BillingMode {
  const keyId = env('RAZORPAY_KEY_ID');
  const keySecret = env('RAZORPAY_KEY_SECRET');
  if (keyId && keySecret) return { kind: 'RAZORPAY', keyId, keySecret };
  if (!keyId && !keySecret && env('BILLING_SIMULATION') === '1' && isLocalStack()) return { kind: 'SIMULATED' };
  return { kind: 'OFF' };
}

export const notConfigured = () =>
  new Fail('INTERNAL', 'Billing is not configured yet. Please try again later or contact support.');

export const SIMULATED_KEY_ID = 'rzp_test_simulated';

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

export async function razorpay<T>(mode: Extract<BillingMode, { kind: 'RAZORPAY' }>, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${mode.keyId}:${mode.keySecret}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('razorpay', path, res.status, JSON.stringify(json));
    const desc = json?.error?.description;
    throw new Fail('INTERNAL', `The payment provider refused the request${desc ? `: ${desc}` : ''}. Please try again.`);
  }
  return json as T;
}

/** Razorpay plan id for a subscription price, from the function secrets. */
export function razorpayPlanId(price: PlanPrice): string {
  const name = price.razorpayPlanEnv;
  const id = name ? env(name) : '';
  if (!id) {
    console.error(`missing secret ${name} for ${price.plan} ${price.interval}`);
    throw notConfigured();
  }
  return id;
}

/** Billing cycles to authorise up front: Razorpay requires a finite total_count. */
export const TOTAL_COUNT: Record<'MONTH' | 'YEAR', number> = { MONTH: 120, YEAR: 10 };

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** X-Razorpay-Signature = hex(HMAC-SHA256(webhook secret, raw body)). */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  return constantTimeEqual(await hmacSha256Hex(secret, rawBody), signature.trim().toLowerCase());
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

interface PaymentEntity {
  id: string;
  amount: number;
  currency: string;
  status: string;
  order_id?: string | null;
  invoice_id?: string | null;
  notes?: Record<string, string> | unknown[];
}

interface SubscriptionEntity {
  id: string;
  plan_id?: string;
  customer_id?: string | null;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  quantity?: number;
  notes?: Record<string, string> | unknown[];
}

export interface RazorpayEvent {
  entity?: 'event';
  account_id?: string;
  event: string;
  contains?: string[];
  payload: {
    payment?: { entity: PaymentEntity };
    subscription?: { entity: SubscriptionEntity };
    order?: { entity: { id: string } };
  };
  created_at?: number;
}

const unix = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

export type ProcessResult = { handled: boolean; note: string };

/**
 * Applies one Razorpay event. Every write is idempotent on its own (unique
 * payment ids, absolute status assignments, period end only moves forward),
 * so a replay or a concurrent duplicate delivery changes nothing.
 */
export async function processEvent(evt: RazorpayEvent, eventId: string, simulated = false): Promise<ProcessResult> {
  const db = admin();
  const name = evt.event;

  if (name === 'payment.captured') {
    const p = evt.payload.payment?.entity;
    if (!p?.id) return { handled: false, note: 'no payment entity' };
    if (!p.order_id) return { handled: false, note: 'payment without order' };
    const { data: order, error } = await db.from('checkout_orders').select('*').eq('razorpay_order_id', p.order_id).maybeSingle();
    if (error) throw error;
    // Subscription invoices also raise payment.captured; those are handled by subscription.charged.
    if (!order) return { handled: false, note: `order ${p.order_id} is not ours` };
    if (p.amount !== order.amount || (p.currency ?? 'INR') !== order.currency) {
      console.error(`payment ${p.id}: amount ${p.amount} ${p.currency} ≠ order ${order.amount} ${order.currency}`);
      return { handled: false, note: 'amount mismatch' };
    }
    await recordPayment({
      user_id: order.user_id,
      kind: 'PROJECT_PASS',
      razorpay_payment_id: p.id,
      razorpay_order_id: p.order_id,
      amount: p.amount,
      currency: p.currency ?? 'INR',
      event_id: eventId,
      raw: evt,
      simulated,
    });
    if (order.plan === 'PROJECT_PASS' && order.project_id) {
      const { data: existing } = await db.from('project_passes').select('id').eq('razorpay_payment_id', p.id).maybeSingle();
      if (!existing) {
        const { data: current } = await db
          .from('project_passes')
          .select('expires_at')
          .eq('user_id', order.user_id)
          .eq('project_id', order.project_id)
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const from = Math.max(Date.now(), current ? new Date(current.expires_at).getTime() : 0);
        const { error: pErr } = await db.from('project_passes').upsert(
          {
            user_id: order.user_id,
            project_id: order.project_id,
            razorpay_order_id: p.order_id,
            razorpay_payment_id: p.id,
            expires_at: new Date(from + PASS_DAYS * 86400_000).toISOString(),
          },
          { onConflict: 'razorpay_payment_id', ignoreDuplicates: true },
        );
        if (pErr) throw pErr;
      }
    }
    return { handled: true, note: 'project pass' };
  }

  if (name.startsWith('subscription.')) {
    const s = evt.payload.subscription?.entity;
    if (!s?.id) return { handled: false, note: 'no subscription entity' };
    const { data: row, error } = await db.from('subscriptions').select('*').eq('razorpay_subscription_id', s.id).maybeSingle();
    if (error) throw error;
    if (!row) return { handled: false, note: `subscription ${s.id} is not ours` };

    const nextEnd = unix(s.current_end);
    const keepEnd = row.current_period_end && (!nextEnd || new Date(row.current_period_end) > new Date(nextEnd));
    const update: Record<string, unknown> = {
      status: String(s.status ?? '').toUpperCase() || row.status,
      current_period_end: keepEnd ? row.current_period_end : nextEnd ?? row.current_period_end,
      ...(s.customer_id ? { razorpay_customer_id: s.customer_id } : {}),
      ...(s.plan_id ? { razorpay_plan_id: s.plan_id } : {}),
    };
    const { error: uErr } = await db.from('subscriptions').update(update).eq('id', row.id);
    if (uErr) throw uErr;

    const p = evt.payload.payment?.entity;
    if (p?.id && (name === 'subscription.charged' || name === 'subscription.activated') && p.status === 'captured') {
      await recordPayment({
        user_id: row.user_id,
        kind: 'SUBSCRIPTION',
        razorpay_payment_id: p.id,
        razorpay_order_id: p.order_id ?? null,
        razorpay_subscription_id: s.id,
        amount: p.amount,
        currency: p.currency ?? 'INR',
        event_id: eventId,
        raw: evt,
        simulated,
      });
    }
    return { handled: true, note: `${row.plan} → ${update.status}` };
  }

  return { handled: false, note: `ignored ${name}` };
}

async function recordPayment(row: Record<string, unknown>): Promise<void> {
  const { error } = await admin().from('payments').upsert(row, { onConflict: 'razorpay_payment_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await admin().from('billing_events').select('event_id').eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function markProcessed(eventId: string, type: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('billing_events')
    .upsert({ event_id: eventId, event_type: type }, { onConflict: 'event_id', ignoreDuplicates: true })
    .select('event_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
