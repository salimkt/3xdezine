// create-project — CreateProjectRequest -> CreateProjectResponse (shared/cloud.ts).
// The caller becomes the owner. Snapshots a CREATE version.
// Plan limit: refuses with FORBIDDEN once the caller owns `maxActiveProjects`
// (Free: 2). The project quotes as the caller's studio, if they have one.
import type { CreateProjectResponse } from '../_shared/domain/cloud.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, serve, str } from '../_shared/http.ts';
import { entitlementsOf, ownedStudio, planName } from '../_shared/business.ts';
import { parseProject, summarize, toSummary, type ProjectRow } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const name = str(body, 'name', { max: 200 })!;
  const data = parseProject(body.data);
  const templateId = str(body, 'templateId', { optional: true, max: 100 }) || data.templateId || null;
  data.name = name;

  const db = admin();
  const ent = await entitlementsOf(caller.id);
  if (ent.maxActiveProjects !== null) {
    const { count, error: cErr } = await db.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', caller.id);
    if (cErr) throw cErr;
    if ((count ?? 0) >= ent.maxActiveProjects) {
      throw forbidden(
        `The ${planName(ent.plan)} plan includes ${ent.maxActiveProjects} active projects and you have ${count}. ` +
          'Upgrade to Solo for unlimited projects, or delete a project you no longer need.',
      );
    }
  }
  const studio = await ownedStudio(caller.id);

  const summary = summarize(data);
  const { data: row, error } = await db
    .from('projects')
    .insert({
      owner_id: caller.id,
      name,
      data,
      template_id: templateId,
      studio_id: studio?.id ?? null,
      version: 1,
      built_up_sqm: summary.builtUpSqm,
      rooms: summary.rooms,
      buffered_total: summary.bufferedTotal,
      currency: summary.currency,
      pending_proposals: summary.pendingProposals,
    })
    .select('*')
    .single();
  if (error) throw error;

  const { error: vErr } = await db.from('project_versions').insert({
    project_id: row.id,
    version: 1,
    author_id: caller.id,
    reason: 'CREATE',
    data,
    rooms: summary.rooms,
    built_up_sqm: summary.builtUpSqm,
    buffered_total: summary.bufferedTotal,
  });
  if (vErr) throw vErr;

  const res: Omit<CreateProjectResponse, 'ok'> = { project: toSummary(row as ProjectRow, 'OWNER', caller.displayName) };
  return res;
});
