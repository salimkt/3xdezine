import { useEffect, useRef, useState } from 'react';
import type { EditLevel } from '@shared/types';
import { useStore } from '../store';
import { effectivePolicy } from '@shared/rules';
import { IconChevron, IconLock } from './icons';
import { ROLE_LABEL, useCloud } from '../cloud/state';

export const LEVELS: Array<{ id: EditLevel; label: string; detail: string }> = [
  { id: 'VIEW', label: 'View', detail: 'Look only. Nothing can change, finishes included.' },
  { id: 'FINISHES', label: 'Finishes', detail: 'Materials can change; walls and openings are fixed.' },
  {
    id: 'LAYOUT',
    label: 'Layout',
    detail: 'Interior walls move too. The envelope and locked walls stay put.',
  },
  { id: 'FULL', label: 'Full', detail: 'Everything, including exterior and locked walls.' },
];

/** Who-may-change-what, stored on the project so it travels with it. */
export function PolicyMenu() {
  const project = useStore((s) => s.project);
  const setPolicy = useStore((s) => s.setPolicy);
  const author = useStore((s) => s.author);
  const setAuthor = useStore((s) => s.setAuthor);
  const policy = effectivePolicy(project);
  const cloud = useCloud((s) => s.active);
  const signedIn = useCloud((s) => s.status === 'signedIn');
  // On a shared cloud project only the owner sets permissions; everyone else
  // sees their own access, which the editor already enforces.
  const readOnly = Boolean(cloud && cloud.role !== 'OWNER');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = LEVELS.find((l) => l.id === policy.level) ?? LEVELS[2];
  const capLabel = cloud ? ROLE_LABEL[cloud.cap] : current.label;
  const capDetail = LEVELS.find((l) => l.id === cloud?.cap)?.detail;

  return (
    <div ref={wrap} style={{ display: 'contents' }}>
      <button
        className={`btn btn-ghost policy-btn ${open ? 'btn-ghost-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Edit permissions for this plan"
      >
        <IconLock size={13} />
        {readOnly ? capLabel : current.label}
        {policy.requireReview && <span className="policy-review-dot" title="Review required" />}
        <IconChevron size={12} className={`caret ${open ? 'caret-open' : ''}`} />
      </button>
      {open && (
        <div className="popover policy-menu" role="dialog" aria-label="Edit permissions">
          <span className="popover-title">Editing</span>
          {readOnly && cloud && (
            <>
              <p className="policy-detail">
                Your access: <b>{ROLE_LABEL[cloud.link && !cloud.link.joined ? 'VIEW' : cloud.role]}</b>
                {cloud.cap !== cloud.role && !cloud.link && <> — capped at <b>{capLabel}</b> by the owner’s settings</>}.{' '}
                {capDetail}
              </p>
              {cloud.cap === 'FINISHES' && (
                <p className="policy-detail">Drag a corner to propose a layout change; the owner reviews it.</p>
              )}
              <p className="policy-detail">Only the owner can change who may edit what.</p>
            </>
          )}
          {!readOnly && (
            <>
              <div className="segmented segmented-fill" role="radiogroup" aria-label="Edit level">
                {LEVELS.map((level) => (
                  <button
                    key={level.id}
                    role="radio"
                    aria-checked={policy.level === level.id}
                    className={`seg ${policy.level === level.id ? 'seg-on' : ''}`}
                    onClick={() => setPolicy({ level: level.id })}
                    title={level.detail}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <p className="policy-detail">{current.detail}</p>
              <label className="policy-toggle">
                <input
                  type="checkbox"
                  checked={policy.requireReview}
                  onChange={(event) => setPolicy({ requireReview: event.target.checked })}
                />
                <span>
                  <b>Require review</b>
                  <small>Geometry edits become proposals that someone accepts or rejects. Finishes still apply directly.</small>
                </span>
              </label>
              {policy.lockedWallIds.length > 0 && (
                <p className="policy-detail">
                  {policy.lockedWallIds.length} wall{policy.lockedWallIds.length === 1 ? '' : 's'} locked as load-bearing.
                  {policy.level !== 'FULL' && ' Switch to Full to unlock them from the inspector.'}
                </p>
              )}
            </>
          )}
          <label className="field">
            <span className="field-label">{signedIn ? 'Your name (account profile)' : 'Your name on proposals'}</span>
            <input
              className="input"
              value={author}
              placeholder="e.g. Asha (site engineer)"
              maxLength={40}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
