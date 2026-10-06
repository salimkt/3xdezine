// revoke-share-link — RevokeShareLinkRequest -> RevokeShareLinkResponse. Owner only.
import { admin, requireCaller } from '../_shared/auth.ts';
import { notFound, serve, str, uuid } from '../_shared/http.ts';
import { access, requireOwner } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const token = str(body, 'token', { max: 200 })!;

  const a = await access(projectId, caller);
  requireOwner(a, 'revoke share links');
  const { data, error } = await admin()
    .from('share_links')
    .update({ revoked: true })
    .eq('project_id', projectId)
    .eq('token', token)
    .select('token');
  if (error) throw error;
  if (!data?.length) throw notFound('That share link doesn’t exist.');
  return {};
});
