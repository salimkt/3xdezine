// accept-invite — AcceptInviteRequest -> AcceptInviteResponse.
// The signed-in user's CONFIRMED email must equal the invite's address.
// Idempotent: accepting an invite you already accepted returns the same answer.
import type { AcceptInviteResponse, MemberRole } from '../_shared/domain/cloud.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, invalid, notFound, serve, uuid } from '../_shared/http.ts';
import { memberRole } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const inviteId = uuid(body, 'inviteId');
  const db = admin();

  const { data: inv, error } = await db.from('project_invites').select('*').eq('id', inviteId).maybeSingle();
  if (error) throw error;
  if (!inv || inv.email !== caller.email) throw notFound('That invite doesn’t exist or was sent to a different email address.');
  if (!caller.emailConfirmed) throw forbidden('Confirm your email address first, then accept the invite.');

  const role = inv.role as MemberRole;
  if (inv.accepted_at) {
    const current = await memberRole(inv.project_id, caller.id);
    if (current) {
      const res: Omit<AcceptInviteResponse, 'ok'> = { projectId: inv.project_id, role: current };
      return res;
    }
    throw invalid('That invite has already been used.');
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) throw invalid('That invite has expired. Ask the owner to invite you again.');

  const { data: project } = await db.from('projects').select('owner_id').eq('id', inv.project_id).maybeSingle();
  if (!project) throw notFound('That project no longer exists.');
  if (project.owner_id !== caller.id) {
    const { error: mErr } = await db
      .from('project_members')
      .upsert({ project_id: inv.project_id, user_id: caller.id, role, added_by: inv.invited_by }, { onConflict: 'project_id,user_id' });
    if (mErr) throw mErr;
  }
  const { error: uErr } = await db.from('project_invites').update({ accepted_at: new Date().toISOString() }).eq('id', inviteId);
  if (uErr) throw uErr;

  const res: Omit<AcceptInviteResponse, 'ok'> = { projectId: inv.project_id, role };
  return res;
});
