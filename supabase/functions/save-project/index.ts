// save-project — SaveProjectRequest -> SaveProjectResponse (shared/cloud.ts).
//
// 1. Authenticate; resolve role -> effective level (owner FULL; member
//    min(role, policy.level)).
// 2. Optimistic concurrency: CONFLICT unless baseVersion is the stored version
//    (checked here for a fast answer, and again atomically in commit_project).
// 3. Diff the incoming document against the stored one and refuse anything
//    beyond the caller's level (see _shared/enforce.ts), or any new rule ERROR.
// 4. Commit: bump version, recompute summary columns with estimateCost, and
//    snapshot a SAVE version (consecutive saves by the same author within 10
//    minutes coalesce into one snapshot — see commit_project in the migration).
//
// `proposals` is server-owned: whatever the client sends is replaced by the
// stored list (use submit-proposal / review-proposal to change it).
import type { SaveProjectResponse } from '../_shared/domain/cloud.ts';
import { requireCaller } from '../_shared/auth.ts';
import { enforceSave } from '../_shared/enforce.ts';
import { int, serve, str, uuid } from '../_shared/http.ts';
import { access, checkBase, commit, loadProject, ownerName, parseProject, toSummary } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const baseVersion = int(body, 'baseVersion');
  const name = str(body, 'name', { optional: true, max: 200 }) || undefined;
  const incoming = parseProject(body.data);

  const a = await access(projectId, caller);
  checkBase(a, baseVersion);

  const before = a.project.data;
  const after = structuredClone(incoming);
  if (name) after.name = name;
  if (before.proposals === undefined) delete after.proposals;
  else after.proposals = structuredClone(before.proposals);

  enforceSave(before, after, { level: a.level, isOwner: a.isOwner, isFullMember: a.role === 'FULL' });

  const { version } = await commit({
    projectId,
    baseVersion,
    data: after,
    name: after.name?.trim() || a.project.name,
    authorId: caller.id,
    reason: 'SAVE',
  });

  const row = (await loadProject(projectId))!;
  const owner = a.isOwner ? caller.displayName : await ownerName(row.owner_id);
  const res: Omit<SaveProjectResponse, 'ok'> = { version, summary: toSummary(row, a.role, owner) };
  return res;
});
