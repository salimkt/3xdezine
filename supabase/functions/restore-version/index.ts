// restore-version — RestoreVersionRequest -> RestoreVersionResponse. OWNER or FULL.
// Writes the old document as a NEW version (reason RESTORE); history is never
// rewritten. The current `proposals` and `policy` are kept: proposals are a
// review log, and only the owner changes policy (through save-project).
import type { RestoreVersionResponse } from '../_shared/domain/cloud.ts';
import type { Project } from '../_shared/domain/types.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { int, notFound, serve, uuid } from '../_shared/http.ts';
import { access, checkBase, commit, requireReviewer } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const versionId = uuid(body, 'versionId');
  const baseVersion = int(body, 'baseVersion');

  const a = await access(projectId, caller);
  requireReviewer(a, 'restore versions');
  checkBase(a, baseVersion);

  const { data: row, error } = await admin()
    .from('project_versions')
    .select('data')
    .eq('id', versionId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw notFound('That version doesn’t exist (only the latest 50 are kept).');

  const current = a.project.data;
  const next = structuredClone(row.data) as Project;
  if (current.proposals === undefined) delete next.proposals;
  else next.proposals = structuredClone(current.proposals);
  if (current.policy === undefined) delete next.policy;
  else next.policy = structuredClone(current.policy);

  const { version } = await commit({ projectId, baseVersion, data: next, name: next.name, authorId: caller.id, reason: 'RESTORE' });
  const res: Omit<RestoreVersionResponse, 'ok'> = { version, data: next };
  return res;
});
