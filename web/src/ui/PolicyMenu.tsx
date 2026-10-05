import { useEffect, useRef, useState } from 'react';
import type { EditLevel } from '@shared/types';
import { useStore } from '../store';
import { effectivePolicy } from '@shared/rules';
import { IconChevron, IconLock } from './icons';

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

  return (
    <div ref={wrap} style={{ display: 'contents' }}>
      <button
        className={`btn btn-ghost policy-btn ${open ? 'btn-ghost-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Edit permissions for this plan"
      >
        <IconLock size={13} />
        {current.label}
        {policy.requireReview && <span className="policy-review-dot" title="Review required" />}
        <IconChevron size={12} className={`caret ${open ? 'caret-open' : ''}`} />
      </button>
      {open && (
        <div className="popover policy-menu" role="dialog" aria-label="Edit permissions">
          <span className="popover-title">Editing</span>
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
          <label className="field">
            <span className="field-label">Your name on proposals</span>
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
