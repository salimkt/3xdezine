// save-rate-overrides — SaveRateOverridesRequest -> SaveRateOverridesResponse.
// Studio owner only, and only on a plan with `rateCards` (Solo and up).
// Overrides are validated against the base card: known rate ids, editable
// fields only, paise as integers, valid HSN/SAC and GST rates.
import type { SaveRateOverridesResponse } from '../_shared/domain/business.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, notFound, serve, uuid } from '../_shared/http.ts';
import { entitlementsOf, loadStudio, parseOverrides, planName, studioRole } from '../_shared/business.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const studioId = uuid(body, 'studioId');
  const studio = await loadStudio(studioId);
  const role = studio ? await studioRole(studio, caller.id) : undefined;
  if (!studio || !role) throw notFound('That studio doesn’t exist or you’re not part of it.');
  if (role !== 'OWNER') throw forbidden('Only the studio owner can change its rate card.');

  const ent = await entitlementsOf(studio.owner_id);
  if (!ent.rateCards) {
    throw forbidden(`Custom rate cards are part of Solo and Studio. You’re on ${planName(ent.plan)} — upgrade to edit your rates.`);
  }
  const overrides = parseOverrides(body.overrides);
  const { error } = await admin()
    .from('rate_overrides')
    .upsert({ studio_id: studio.id, overrides, updated_by: caller.id }, { onConflict: 'studio_id' });
  if (error) throw error;
  const res: Omit<SaveRateOverridesResponse, 'ok'> = {};
  return res;
});
