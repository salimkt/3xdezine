// submit-proposal — SubmitProposalRequest -> SubmitProposalResponse.
// Any member whose effective level is FINISHES or above may propose. The
// author is the caller's profile display name, never a client-supplied string.
// Proposals are not refused for breaking rules — createProposal records the
// violations for the reviewer — but every edit must refer to something that
// exists (checked with checkEdit at FULL, i.e. ignoring the caller's level).
import type { SubmitProposalResponse } from '../_shared/domain/cloud.ts';
import { checkEdit, createProposal, effectivePolicy } from '../_shared/domain/rules.ts';
import { requireCaller } from '../_shared/auth.ts';
import { parseEdits } from '../_shared/edits.ts';
import { forbidden, int, invalid, serve, str, uuid } from '../_shared/http.ts';
import { access, catalog, checkBase, commit, rank } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const baseVersion = int(body, 'baseVersion');
  const edits = parseEdits(body.edits);
  const note = str(body, 'note', { optional: true, max: 1000 }) || undefined;

  const a = await access(projectId, caller);
  if (rank(a.level) < rank('FINISHES')) throw forbidden('You have view-only access to this project, so you can’t propose changes.');
  checkBase(a, baseVersion);

  const project = a.project.data;
  const check = checkEdit(project, edits, { ...effectivePolicy(project), level: 'FULL' });
  if (!check.allowed) throw invalid(check.reason ?? 'These edits don’t apply to this plan.');

  const proposal = createProposal(project, edits, caller.displayName, catalog, note);
  const next = structuredClone(project);
  next.proposals = [...(next.proposals ?? []), proposal];

  const { version } = await commit({ projectId, baseVersion, data: next, authorId: caller.id });
  const res: Omit<SubmitProposalResponse, 'ok'> = { proposal, version };
  return res;
});
