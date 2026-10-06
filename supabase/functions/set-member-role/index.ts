// set-member-role — SetMemberRoleRequest -> SetMemberRoleResponse. Owner only.
import type { SetMemberRoleResponse } from '../_shared/domain/cloud.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { notFound, oneOf, serve, uuid } from '../_shared/http.ts';
import { access, LEVELS, requireOwner, toMember } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const userId = uuid(body, 'userId');
  const role = oneOf(body, 'role', LEVELS);

  const a = await access(projectId, caller);
  requireOwner(a, 'change roles');
  const { data, error } = await admin()
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw error;
  if (!data?.length) throw notFound('That person isn’t a member of this project.');

  const res: Omit<SetMemberRoleResponse, 'ok'> = { member: await toMember(projectId, userId, true) };
  return res;
});
