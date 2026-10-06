// invite-member — InviteMemberRequest -> InviteMemberResponse. Owner only.
//
// - The email already belongs to a confirmed account: they become a member at
//   once; the invite is recorded as already accepted and `member` is returned.
// - Otherwise a pending invite is stored (re-inviting refreshes role and
//   expiry). If there is no account at all, Supabase's built-in invite email
//   is sent too (auth.admin.inviteUserByEmail -> Mailpit locally, your SMTP in
//   production); clicking it signs them in, and the invite appears in
//   `my_invites` for accept-invite. Email failure never fails the invite.
import type { InviteMemberResponse, ProjectMember } from '../_shared/domain/cloud.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { invalid, oneOf, serve, str, uuid } from '../_shared/http.ts';
import { access, requireOwner, toInvite, toMember, LEVELS } from '../_shared/project.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5183';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const email = str(body, 'email', { max: 254 })!.toLowerCase();
  if (!EMAIL.test(email)) throw invalid('That doesn’t look like an email address.');
  const role = oneOf(body, 'role', LEVELS);

  const a = await access(projectId, caller);
  requireOwner(a, 'invite people');
  if (email === caller.email) throw invalid('You already own this project.');

  const db = admin();
  const { data: found, error: findErr } = await db.rpc('user_id_by_email', { p_email: email });
  if (findErr) throw findErr;
  const existing = (found as { user_id: string; confirmed: boolean }[] | null)?.[0];

  if (existing?.confirmed) {
    const { error: mErr } = await db
      .from('project_members')
      .upsert({ project_id: projectId, user_id: existing.user_id, role, added_by: caller.id }, { onConflict: 'project_id,user_id' });
    if (mErr) throw mErr;
    const now = new Date().toISOString();
    // Close any older pending invite for this address, then record this one as accepted.
    await db.from('project_invites').update({ accepted_at: now }).eq('project_id', projectId).eq('email', email).is('accepted_at', null);
    const { data: inv, error: iErr } = await db
      .from('project_invites')
      .insert({ project_id: projectId, email, role, invited_by: caller.id, accepted_at: now })
      .select('*')
      .single();
    if (iErr) throw iErr;
    const member: ProjectMember = await toMember(projectId, existing.user_id, true);
    const res: Omit<InviteMemberResponse, 'ok'> = { invite: toInvite(inv), member };
    return res;
  }

  const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { data: pending } = await db
    .from('project_invites')
    .select('id')
    .eq('project_id', projectId)
    .eq('email', email)
    .is('accepted_at', null)
    .maybeSingle();
  const write = pending
    ? db.from('project_invites').update({ role, invited_by: caller.id, expires_at: expires }).eq('id', pending.id)
    : db.from('project_invites').insert({ project_id: projectId, email, role, invited_by: caller.id, expires_at: expires });
  const { data: inv, error } = await write.select('*').single();
  if (error) throw error;

  if (!existing) {
    const { error: mailErr } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: APP_URL,
      data: { invited_to_project: projectId },
    });
    if (mailErr) console.warn(`invite email to ${email} not sent: ${mailErr.message}`);
  }

  const res: Omit<InviteMemberResponse, 'ok'> = { invite: toInvite(inv) };
  return res;
});
