import { useState } from 'react';
import type { EditProposal, PlanEdit } from '@shared/types';
import { useStore } from '../store';
import { effectivePolicy } from '@shared/rules';
import { money } from '../lib/format';
import { planViolations, severityCounts } from '../lib/checks';
import type { RuleViolation } from '@shared/types';

const violationKey = (v: RuleViolation) =>
  `${v.ruleId}|${v.roomId ?? ''}|${v.wallId ?? ''}|${v.openingId ?? ''}`;
import { SeverityIcon } from './PlanCheckPanel';
import { IconChevron } from './icons';

export function signedMoney(delta: number | undefined, currency: string) {
  if (delta === undefined || Math.abs(delta) < 0.5) return { text: `±${money(0, currency)}`, tone: 'flat' };
  return {
    text: `${delta > 0 ? '+' : '−'}${money(Math.abs(delta), currency)}`,
    tone: delta > 0 ? 'up' : 'down',
  };
}

function ago(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export function describeEdit(edit: PlanEdit): string {
  switch (edit.kind) {
    case 'MOVE_CORNER': {
      const d = Math.hypot(edit.to.x - edit.from.x, edit.to.z - edit.from.z);
      return `Move a corner ${d.toFixed(2)} m`;
    }
    case 'MOVE_OPENING':
      return 'Slide an opening';
    case 'RESIZE_OPENING':
      return `Resize an opening to ${edit.widthM.toFixed(2)} m`;
    case 'ADD_OPENING':
      return 'Add an opening';
    case 'REMOVE_OPENING':
      return 'Remove an opening';
  }
}

function ProposalCard({ proposal, selected }: { proposal: EditProposal; selected: boolean }) {
  const currency = useStore((s) => s.project.currency);
  const preview = useStore((s) => s.previewProposal);
  const in3d = useStore((s) => s.previewIn3d);
  const setIn3d = useStore((s) => s.setPreviewIn3d);
  const accept = useStore((s) => s.acceptProposal);
  const reject = useStore((s) => s.rejectProposal);
  const project = useStore((s) => s.project);
  const cost = signedMoney(proposal.costDelta, currency);
  const pending = proposal.status === 'PENDING';
  // A reviewer cares what the proposal *adds*; what the plan already had is
  // summarised, not repeated.
  const existing = new Set(pending ? planViolations(project).map(violationKey) : []);
  const added = pending ? proposal.violations.filter((v) => !existing.has(violationKey(v))) : [];
  const carried = pending ? proposal.violations.length - added.length : 0;
  const counts = severityCounts(added);

  return (
    <li className={`proposal ${selected ? 'proposal-on' : ''} proposal-${proposal.status.toLowerCase()}`}>
      <button
        className="proposal-head"
        onClick={() => preview(selected ? null : proposal.id)}
        aria-expanded={selected}
        title={selected ? 'Hide the diff' : 'Show the diff on the plan'}
      >
        <span className="proposal-avatar" aria-hidden>
          {(proposal.author.trim()[0] ?? '?').toUpperCase()}
        </span>
        <span className="proposal-who">
          <b>{proposal.author}</b>
          <small>
            {ago(proposal.createdAt)}
            {!pending && ` · ${proposal.status.toLowerCase()}`}
          </small>
        </span>
        <span className={`mono proposal-delta delta-${cost.tone}`}>{cost.text}</span>
      </button>
      {proposal.note && <p className="proposal-note">“{proposal.note}”</p>}
      <div className="proposal-tags">
        {proposal.edits.map((e, i) => (
          <span key={i} className="proposal-tag">
            {describeEdit(e)}
          </span>
        ))}
        {counts.ERROR > 0 && (
          <span className="sev sev-error">
            {counts.ERROR} new error{counts.ERROR === 1 ? '' : 's'}
          </span>
        )}
        {counts.WARNING > 0 && (
          <span className="sev sev-warning">
            {counts.WARNING} new warning{counts.WARNING === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {selected && (
        <div className="proposal-detail">
          {added.length === 0 && (
            <p className="proposal-clean">
              {pending ? 'Adds no new rule issues.' : `Decided — ${proposal.status.toLowerCase()}.`}
            </p>
          )}
          {added.length > 0 && (
            <ul className="proposal-violations">
              {added.map((v, i) => (
                <li key={i} className={`sev-row sev-row-${v.severity.toLowerCase()}`}>
                  <SeverityIcon severity={v.severity} size={11} />
                  <span>
                    {v.message}
                    {v.reference && <small> · {v.reference}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {carried > 0 && (
            <p className="proposal-carried">
              +{carried} issue{carried === 1 ? '' : 's'} the plan already has
            </p>
          )}
          {pending && (
            <div className="proposal-actions">
              <button className={`chip ${in3d ? 'chip-on' : ''}`} onClick={() => setIn3d(!in3d)}>
                Preview in 3D
              </button>
              <span className="topbar-spacer" />
              <button className="btn btn-small" onClick={() => reject(proposal.id)}>
                Reject
              </button>
              <button
                className="btn btn-small btn-primary"
                onClick={() => accept(proposal.id)}
                title={counts.ERROR ? 'Accepting will leave rule errors in the plan' : 'Apply this change to the plan'}
              >
                Accept
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ProposalsPanel() {
  const proposals = useStore((s) => s.project.proposals);
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.previewProposalId);
  const [showHistory, setShowHistory] = useState(false);
  const review = effectivePolicy(project).requireReview;

  const list = proposals ?? [];
  const pending = list.filter((p) => p.status === 'PENDING');
  const history = list.filter((p) => p.status !== 'PENDING');
  if (!review && list.length === 0) return null;

  return (
    <div className="panel proposals-panel">
      <header className="panel-header">
        <h2>Proposals</h2>
        <span className={`badge ${pending.length ? 'badge-accent' : 'badge-quiet'}`}>{pending.length} pending</span>
      </header>
      {pending.length === 0 && (
        <p className="hint">
          {review
            ? 'Review is on: drag a corner in the plan and the change is filed here instead of applied.'
            : 'No pending proposals.'}
        </p>
      )}
      {pending.length > 0 && (
        <ul className="proposal-list">
          {[...pending].reverse().map((p) => (
            <ProposalCard key={p.id} proposal={p} selected={p.id === selectedId} />
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <>
          <button className="check-group-head" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <span>History</span>
            <span className="mono check-count">{history.length}</span>
            <IconChevron size={11} className={`caret ${showHistory ? 'caret-open' : ''}`} />
          </button>
          {showHistory && (
            <ul className="proposal-list">
              {[...history].reverse().map((p) => (
                <ProposalCard key={p.id} proposal={p} selected={p.id === selectedId} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
