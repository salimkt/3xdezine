// create-checkout — CreateCheckoutRequest -> CreateCheckoutResponse.
//
// PROJECT_PASS / ONE_TIME → a Razorpay order (POST /v1/orders) for a project
//                           the caller owns.
// SOLO|STUDIO / MONTH|YEAR → a Razorpay subscription (POST /v1/subscriptions)
//                           on the plan id held in RAZORPAY_PLAN_<PLAN>_<INTERVAL>.
// Either way the checkout is recorded first, so the signed webhook can map
// the payment back to the buyer. Entitlements change only when the webhook
// confirms the payment — never from this call.
//
// LOCAL DEV ONLY: with BILLING_SIMULATION=1, no Razorpay keys and a local
// stack (see _shared/billing.ts billingMode), checkout is simulated:
// the response has `simulated: true`, and a second call with
// `{ simulateSuccess: true, orderId | subscriptionId }` (or the first call
// with `simulateSuccess: true`) feeds a synthetic event through the SAME
// processing code the webhook uses. Without keys and without simulation,
// this returns "Billing is not configured yet".
import { PRICES, type CreateCheckoutResponse, type PlanId, type PlanPrice } from '../_shared/domain/business.ts';
import { admin, requireCaller, type Caller } from '../_shared/auth.ts';
import { forbidden, invalid, notFound, oneOf, serve, str, uuid } from '../_shared/http.ts';
import { access } from '../_shared/project.ts';
import { randomToken } from '../_shared/business.ts';
import {
  SIMULATED_KEY_ID, TOTAL_COUNT, billingMode, notConfigured, processEvent, razorpay, razorpayPlanId,
  type RazorpayEvent,
} from '../_shared/billing.ts';

const PLANS: PlanId[] = ['PROJECT_PASS', 'SOLO', 'STUDIO', 'BUSINESS'];

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const mode = billingMode();
  if (mode.kind === 'OFF') throw notConfigured();

  if (body.simulateSuccess === true && (body.orderId !== undefined || body.subscriptionId !== undefined)) {
    if (mode.kind !== 'SIMULATED') throw forbidden('Simulated payments are only available in local development.');
    return await completeSimulated(caller, str(body, 'orderId', { optional: true, max: 100 }), str(body, 'subscriptionId', { optional: true, max: 100 }));
  }

  const plan = oneOf(body, 'plan', PLANS);
  const interval = oneOf(body, 'interval', ['MONTH', 'YEAR', 'ONE_TIME'] as const);
  if (plan === 'BUSINESS') throw invalid('The Business plan is set up with our team. Please get in touch.');
  const price = PRICES.find((p) => p.plan === plan && p.interval === interval);
  if (!price) throw invalid(`${plan} is not sold ${interval === 'ONE_TIME' ? 'as a one-off' : interval === 'MONTH' ? 'monthly' : 'yearly'}.`);
  const db = admin();

  let res: Omit<CreateCheckoutResponse, 'ok'>;
  if (price.interval === 'ONE_TIME') {
    const projectId = uuid(body, 'projectId');
    const a = await access(projectId, caller);
    if (!a.isOwner) throw forbidden('Only the project owner can buy a Project Pass for it.');
    let orderId: string;
    if (mode.kind === 'RAZORPAY') {
      const order = await razorpay<{ id: string }>(mode, '/orders', {
        amount: price.amount,
        currency: 'INR',
        receipt: `pp_${projectId.slice(0, 8)}_${Date.now().toString(36)}`,
        notes: { user_id: caller.id, project_id: projectId, plan },
      });
      orderId = order.id;
    } else {
      orderId = `order_sim_${randomToken(10)}`;
    }
    const { error } = await db.from('checkout_orders').insert({
      razorpay_order_id: orderId,
      user_id: caller.id,
      project_id: projectId,
      plan,
      amount: price.amount,
      currency: 'INR',
      simulated: mode.kind === 'SIMULATED',
    });
    if (error) throw error;
    res = { provider: 'RAZORPAY', keyId: keyIdOf(mode), orderId, amount: price.amount, simulated: mode.kind === 'SIMULATED' };
  } else {
    const { data: live, error: lErr } = await db
      .from('subscriptions')
      .select('plan, status, current_period_end')
      .eq('user_id', caller.id)
      .in('status', ['ACTIVE', 'AUTHENTICATED', 'PENDING']);
    if (lErr) throw lErr;
    const current = (live ?? []).find((s) => !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now());
    if (current) throw invalid(`You already have an active ${current.plan === 'STUDIO' ? 'Studio' : 'Solo'} subscription. Cancel it before switching plans.`);

    let subscriptionId: string;
    let planId: string | null = null;
    if (mode.kind === 'RAZORPAY') {
      planId = razorpayPlanId(price);
      const sub = await razorpay<{ id: string }>(mode, '/subscriptions', {
        plan_id: planId,
        total_count: TOTAL_COUNT[price.interval as 'MONTH' | 'YEAR'],
        quantity: 1,
        customer_notify: true,
        notes: { user_id: caller.id, plan, interval: price.interval },
      });
      subscriptionId = sub.id;
    } else {
      subscriptionId = `sub_sim_${randomToken(10)}`;
    }
    const { error } = await db.from('subscriptions').insert({
      user_id: caller.id,
      plan,
      interval: price.interval,
      status: 'CREATED',
      razorpay_subscription_id: subscriptionId,
      razorpay_plan_id: planId,
      seats: plan === 'STUDIO' ? 3 : 1,
      simulated: mode.kind === 'SIMULATED',
    });
    if (error) throw error;
    res = { provider: 'RAZORPAY', keyId: keyIdOf(mode), subscriptionId, amount: price.amount, simulated: mode.kind === 'SIMULATED' };
  }

  if (body.simulateSuccess === true) {
    if (mode.kind !== 'SIMULATED') throw forbidden('Simulated payments are only available in local development.');
    await completeSimulated(caller, res.orderId, res.subscriptionId);
  }
  return res;
});

function keyIdOf(mode: ReturnType<typeof billingMode>): string {
  return mode.kind === 'RAZORPAY' ? mode.keyId : SIMULATED_KEY_ID;
}

/** Feeds a synthetic, Razorpay-shaped event through the webhook's processing code. */
async function completeSimulated(caller: Caller, orderId?: string, subscriptionId?: string): Promise<Record<string, unknown>> {
  const db = admin();
  const now = Math.floor(Date.now() / 1000);
  const paymentId = `pay_sim_${randomToken(10)}`;
  const eventId = `evt_sim_${randomToken(10)}`;
  let evt: RazorpayEvent;
  let amount: number;
  if (orderId) {
    const { data: order, error } = await db.from('checkout_orders').select('*').eq('razorpay_order_id', orderId).maybeSingle();
    if (error) throw error;
    if (!order || order.user_id !== caller.id || !order.simulated) throw notFound('That checkout doesn’t exist.');
    amount = order.amount;
    evt = {
      entity: 'event',
      event: 'payment.captured',
      contains: ['payment'],
      payload: { payment: { entity: { id: paymentId, amount: order.amount, currency: order.currency, status: 'captured', order_id: orderId } } },
      created_at: now,
    };
  } else if (subscriptionId) {
    const { data: sub, error } = await db.from('subscriptions').select('*').eq('razorpay_subscription_id', subscriptionId).maybeSingle();
    if (error) throw error;
    if (!sub || sub.user_id !== caller.id || !sub.simulated) throw notFound('That checkout doesn’t exist.');
    const price = PRICES.find((p) => p.plan === sub.plan && p.interval === sub.interval) as PlanPrice;
    amount = price.amount;
    const end = new Date();
    if (sub.interval === 'YEAR') end.setUTCFullYear(end.getUTCFullYear() + 1);
    else end.setUTCMonth(end.getUTCMonth() + 1);
    evt = {
      entity: 'event',
      event: 'subscription.activated',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: { entity: { id: subscriptionId, status: 'active', current_start: now, current_end: Math.floor(end.getTime() / 1000), quantity: 1 } },
        payment: { entity: { id: paymentId, amount: price.amount, currency: 'INR', status: 'captured' } },
      },
      created_at: now,
    };
  } else {
    throw invalid('Pass `orderId` or `subscriptionId` to complete a simulated checkout.');
  }
  const result = await processEvent(evt, eventId, true);
  if (!result.handled) throw new Error(`simulated ${evt.event} not handled: ${result.note}`);
  const { error: bErr } = await db.from('billing_events').insert({ event_id: eventId, event_type: evt.event });
  if (bErr) throw bErr;
  return {
    provider: 'RAZORPAY',
    keyId: SIMULATED_KEY_ID,
    ...(orderId ? { orderId } : { subscriptionId }),
    amount,
    simulated: true,
    completed: true,
  };
}
