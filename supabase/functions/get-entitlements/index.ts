// get-entitlements — {} -> { ok, entitlements: Entitlements } (shared/business.ts).
// Computed from the caller's live subscriptions (or a team plan of a studio
// they hold a seat in) and unexpired Project Passes, via shared/plans.ts.
import { requireCaller } from '../_shared/auth.ts';
import { serve } from '../_shared/http.ts';
import { entitlementsOf } from '../_shared/business.ts';

serve(async (req) => {
  const caller = await requireCaller(req);
  return { entitlements: await entitlementsOf(caller.id) };
});
