import type { EditProposal, Project, RuleViolation } from '@shared/types';
import { applyEdits, validatePlan } from '@shared/rules';
import { useStore } from '../store';
import { useMemo } from 'react';

/**
 * `validatePlan` is pure in the project, and several panels ask for it on the
 * same render, so results are cached per project object.
 */
const cache = new WeakMap<Project, RuleViolation[]>();

export function planViolations(project: Project): RuleViolation[] {
  let result = cache.get(project);
  if (!result) {
    try {
      result = validatePlan(project);
    } catch (error) {
      console.warn('[3xDezine] plan check failed', error);
      result = [];
    }
    cache.set(project, result);
  }
  return result;
}

export function usePlanViolations(): RuleViolation[] {
  const project = useStore((s) => s.project);
  return planViolations(project);
}

export function severityCounts(list: RuleViolation[]) {
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const v of list) counts[v.severity]++;
  return counts;
}

export function usePreviewProposal(): EditProposal | null {
  const id = useStore((s) => s.previewProposalId);
  const proposals = useStore((s) => s.project.proposals);
  return useMemo(() => proposals?.find((p) => p.id === id) ?? null, [proposals, id]);
}

const proposedCache = new WeakMap<EditProposal, { base: Project; result: Project }>();

/** The plan as a proposal would leave it. */
export function proposedProject(project: Project, proposal: EditProposal): Project {
  const hit = proposedCache.get(proposal);
  if (hit && hit.base === project) return hit.result;
  const result = applyEdits(project, proposal.edits);
  proposedCache.set(proposal, { base: project, result });
  return result;
}

/** What the 3D view draws: the live plan, or a proposal being previewed. */
export function useDisplayProject(): Project {
  const project = useStore((s) => s.project);
  const in3d = useStore((s) => s.previewIn3d);
  const proposal = usePreviewProposal();
  return in3d && proposal ? proposedProject(project, proposal) : project;
}
