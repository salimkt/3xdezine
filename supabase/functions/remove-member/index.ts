// remove-member — RemoveMemberRequest -> RemoveMemberResponse.
// The owner may remove anyone; a member may remove themselves (leave).
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, notFound, serve, uuid } from '../_shared/http.ts';
import { access } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const userId = uuid(body, 'userId');

  const a = await access(projectId, caller);
  if (!a.isOwner && userId !== caller.id) throw forbidden('Only the project owner can remove other people.');
  const { data, error } = await admin()
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw error;
  if (!data?.length) throw notFound('That person isn’t a member of this project.');
  return {};
});
