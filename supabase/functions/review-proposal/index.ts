// review-proposal — ReviewProposalRequest -> ReviewProposalResponse. OWNER or FULL.
// ACCEPT applies the edits (acceptProposal), refuses if that would add a rule
// ERROR to the current plan, and snapshots a PROPOSAL_ACCEPTED version.
// REJECT only marks the proposal (no snapshot; the version still bumps).
import type { ReviewProposalResponse } from '../_shared/domain/cloud.ts';
import { acceptProposal, rejectProposal } from '../_shared/domain/rules.ts';
import { requireCaller } from '../_shared/auth.ts';
import { refuseNewErrors } from '../_shared/enforce.ts';
import { int, invalid, notFound, oneOf, serve, str, uuid } from '../_shared/http.ts';
import { access, checkBase, commit, requireReviewer } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const proposalId = str(body, 'proposalId', { max: 100 })!;
  const decision = oneOf(body, 'decision', ['ACCEPT', 'REJECT'] as const);
  const baseVersion = int(body, 'baseVersion');

  const a = await access(projectId, caller);
  requireReviewer(a, 'review proposals');
  checkBase(a, baseVersion);

  const project = a.project.data;
  const proposal = project.proposals?.find((p) => p.id === proposalId);
  if (!proposal) throw notFound('That proposal doesn’t exist.');
  if (proposal.status !== 'PENDING') throw invalid(`That proposal was already ${proposal.status.toLowerCase()}.`);

  let next;
  if (decision === 'ACCEPT') {
    next = acceptProposal(project, proposalId);
    refuseNewErrors(project, next, 'accept');
  } else {
    next = rejectProposal(project, proposalId);
  }

  const { version } = await commit({
    projectId,
    baseVersion,
    data: next,
    authorId: caller.id,
    ...(decision === 'ACCEPT' ? { reason: 'PROPOSAL_ACCEPTED' as const } : {}),
  });
  const res: Omit<ReviewProposalResponse, 'ok'> = { version, data: next };
  return res;
});
