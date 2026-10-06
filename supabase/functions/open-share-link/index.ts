// open-share-link — OpenShareLinkRequest -> OpenShareLinkResponse.
// Works signed out. Unknown, revoked and expired links all answer NOT_FOUND.
// `join: true` (signed in only) records the link's role as a membership; an
// existing membership is only ever raised by a link, never lowered.
// `project.role` is the caller's own access when they have one, else the link's role.
import type { AccessRole, LinkRole, OpenShareLinkResponse } from '../_shared/domain/cloud.ts';
import { admin, optionalCaller } from '../_shared/auth.ts';
import { Fail, notFound, serve, str } from '../_shared/http.ts';
import { loadProject, maxLevel, memberRole, ownerName, toSummary } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await optionalCaller(req);
  const token = str(body, 'token', { max: 200 })!;
  const join = body.join === true;
  const db = admin();

  const { data: link, error } = await db.from('share_links').select('*').eq('token', token).maybeSingle();
  if (error) throw error;
  const dead = !link || link.revoked || (link.expires_at && new Date(link.expires_at).getTime() < Date.now());
  if (dead) throw notFound('This link has expired or been turned off. Ask the owner for a new one.');

  const project = await loadProject(link.project_id);
  if (!project) throw notFound('This project no longer exists.');
  const linkRole = link.role as LinkRole;

  let role: AccessRole = linkRole;
  if (caller) {
    if (project.owner_id === caller.id) role = 'OWNER';
    else {
      const current = await memberRole(project.id, caller.id);
      if (join) {
        const next = current ? maxLevel(current, linkRole) : linkRole;
        if (next !== current) {
          const { error: mErr } = await db
            .from('project_members')
            .upsert({ project_id: project.id, user_id: caller.id, role: next, added_by: link.created_by }, { onConflict: 'project_id,user_id' });
          if (mErr) throw mErr;
        }
        role = next;
      } else if (current) role = maxLevel(current, linkRole);
    }
  } else if (join) {
    throw new Fail('UNAUTHENTICATED', 'Sign in to join this project.');
  }

  const res: Omit<OpenShareLinkResponse, 'ok'> = {
    project: { ...toSummary(project, role, await ownerName(project.owner_id)), data: project.data },
    role: linkRole,
  };
  return res;
});
