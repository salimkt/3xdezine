// cancel-subscription — CancelSubscriptionRequest -> CancelSubscriptionResponse.
//
// Stops renewal of the caller's paid plan. Razorpay is asked to cancel at the
// END of the current cycle (cancel_at_cycle_end = 1), so the subscriber keeps
// what they already paid for and is never charged again. Locally the row moves
// to CANCELLED straight away; entitlements already treat CANCELLED as live
// until current_period_end, and the later subscription.cancelled webhook just
// confirms it. Idempotent. The Terms, Refund policy and pricing FAQ promise
// that a subscriber can cancel from the account menu — this is that promise.
import type { CancelSubscriptionResponse, PlanId } from '../_shared/domain/business.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { notFound, serve, str } from '../_shared/http.ts';
import { billingMode, notConfigured, razorpay } from '../_shared/billing.ts';

/** Matches the LIVE set used for entitlements in _shared/business.ts. */
const LIVE = ['ACTIVE', 'AUTHENTICATED', 'PENDING', 'CANCELLED'];

serve(async (req, body): Promise<Omit<CancelSubscriptionResponse, 'ok'>> => {
  const caller = await requireCaller(req);
  const reason = str(body, 'reason', { max: 500, optional: true });
  const db = admin();

  const { data: rows, error } = await db
    .from('subscriptions')
    .select('id, plan, status, current_period_end, razorpay_subscription_id, simulated')
    .eq('user_id', caller.id)
    .in('status', LIVE)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const now = Date.now();
  const sub = (rows ?? []).find((r) => !r.current_period_end || new Date(r.current_period_end).getTime() > now);
  if (!sub) throw notFound("You don't have an active paid plan to cancel.");

  const result = (alreadyCancelled: boolean): Omit<CancelSubscriptionResponse, 'ok'> => ({
    plan: sub.plan as PlanId,
    status: 'CANCELLED',
    accessUntil: sub.current_period_end ?? null,
    alreadyCancelled,
  });
  if (sub.status === 'CANCELLED') return result(true);

  if (!sub.simulated) {
    const mode = billingMode();
    if (mode.kind !== 'RAZORPAY') throw notConfigured();
    // Never charge again, but don't cut off a period that has been paid for.
    await razorpay(mode, `/subscriptions/${encodeURIComponent(sub.razorpay_subscription_id)}/cancel`, {
      cancel_at_cycle_end: 1,
    });
  }

  const { error: upErr } = await db
    .from('subscriptions')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', sub.id);
  if (upErr) throw upErr;

  if (reason) console.info('cancel-subscription reason', { user: caller.id, plan: sub.plan, reason });
  return result(false);
});
