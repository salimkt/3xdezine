// delete-project — DeleteProjectRequest -> DeleteProjectResponse. Owner only.
// Members, invites, share links and versions go with it (ON DELETE CASCADE).
import { admin, requireCaller } from '../_shared/auth.ts';
import { serve, uuid } from '../_shared/http.ts';
import { access, requireOwner } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const a = await access(projectId, caller);
  requireOwner(a, 'delete it');
  const { error } = await admin().from('projects').delete().eq('id', projectId);
  if (error) throw error;
  return {};
});
