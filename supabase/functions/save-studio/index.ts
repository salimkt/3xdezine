// save-studio — SaveStudioRequest -> SaveStudioResponse (shared/business.ts).
// Without `studio.id`, creates or updates the caller's personal studio (made
// lazily on the first save; the caller becomes its OWNER seat). With an id,
// only that studio's owner may save it. Validates GSTIN (format, checksum and
// that its state code matches the address), PAN-in-GSTIN, logo type/size and
// the number prefix.
import type { SaveStudioResponse } from '../_shared/domain/business.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, invalid, notFound, serve } from '../_shared/http.ts';
import { isObj, loadStudio, ownedStudio, parseStudio, studioRole, toStudio, type StudioRow } from '../_shared/business.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  if (!isObj(body.studio)) throw invalid('`studio` is required.');
  const profile = parseStudio(body.studio);
  const id = body.studio.id;
  const db = admin();

  let row: StudioRow;
  if (id !== undefined && id !== null) {
    if (typeof id !== 'string') throw invalid('`studio.id` must be an id.');
    const studio = await loadStudio(id).catch(() => undefined);
    const role = studio ? await studioRole(studio, caller.id) : undefined;
    if (!studio || !role) throw notFound('That studio doesn’t exist or you’re not part of it.');
    if (role !== 'OWNER') throw forbidden('Only the studio owner can change the studio profile.');
    const { data, error } = await db.from('studios').update({ profile }).eq('id', studio.id).select('*').single();
    if (error) throw error;
    row = data as StudioRow;
  } else {
    const existing = await ownedStudio(caller.id);
    if (existing) {
      const { data, error } = await db.from('studios').update({ profile }).eq('id', existing.id).select('*').single();
      if (error) throw error;
      row = data as StudioRow;
    } else {
      const { data, error } = await db
        .from('studios')
        .upsert({ owner_id: caller.id, profile }, { onConflict: 'owner_id' })
        .select('*')
        .single();
      if (error) throw error;
      row = data as StudioRow;
      // Projects the caller already owns quote as this studio from now on.
      const { error: pErr } = await db.from('projects').update({ studio_id: row.id }).eq('owner_id', caller.id).is('studio_id', null);
      if (pErr) throw pErr;
    }
    const { error: mErr } = await db
      .from('studio_members')
      .upsert({ studio_id: row.id, user_id: caller.id, role: 'OWNER' }, { onConflict: 'studio_id,user_id' });
    if (mErr) throw mErr;
  }

  const res: Omit<SaveStudioResponse, 'ok'> = { studio: toStudio(row) };
  return res;
});
