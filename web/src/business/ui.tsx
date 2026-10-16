import { useEffect, useState, type ReactNode } from 'react';
import type { PaymentMilestone } from '@shared/business';

/** Small form pieces shared by the quote builder and studio settings. */

export function BizField({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field biz-field ${wide ? 'biz-field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="biz-field-hint">{hint}</span>}
    </label>
  );
}

/** One item per line; blank lines dropped on commit. */
export function ListEditor({
  value,
  onChange,
  rows = 4,
  placeholder,
  ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    // Follow outside changes, but don't fight the caret while typing.
    if (text.split('\n').map((t) => t.trim()).filter(Boolean).join('\n') !== value.join('\n')) setText(value.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <textarea
      className="input biz-textarea"
      rows={rows}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split('\n').map((t) => t.trim()).filter(Boolean));
      }}
    />
  );
}

export type MilestoneRow = { label: string; pct: number; trigger?: PaymentMilestone['trigger'] };

const TRIGGERS: Array<[PaymentMilestone['trigger'], string]> = [
  ['ON_SIGNING', 'On signing'],
  ['ON_APPROVAL', 'On approval'],
  ['ON_DELIVERY', 'On delivery'],
  ['ON_HANDOVER', 'On handover'],
];

/** Label + % rows that must total 100. Amounts are shown when a total is given. */
export function MilestonesEditor<T extends MilestoneRow>({
  value,
  onChange,
  withTrigger,
  amounts,
}: {
  value: T[];
  onChange: (next: T[]) => void;
  withTrigger?: boolean;
  amounts?: string[];
}) {
  const total = value.reduce((s, m) => s + (Number(m.pct) || 0), 0);
  const ok = Math.abs(total - 100) < 0.001;
  const set = (i: number, patch: Partial<T>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div className="biz-milestones">
      {value.map((m, i) => (
        <div key={i} className="biz-milestone">
          <input className="input" value={m.label} aria-label={`Milestone ${i + 1} label`} onChange={(e) => set(i, { label: e.target.value } as Partial<T>)} />
          {withTrigger && (
            <select
              className="input select biz-milestone-trigger"
              value={m.trigger ?? 'ON_APPROVAL'}
              aria-label={`Milestone ${i + 1} trigger`}
              onChange={(e) => set(i, { trigger: e.target.value as PaymentMilestone['trigger'] } as Partial<T>)}
            >
              {TRIGGERS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <span className="biz-pct">
            <input
              className="input mono"
              type="number"
              min={0}
              max={100}
              step={1}
              value={m.pct}
              aria-label={`Milestone ${i + 1} percent`}
              onChange={(e) => set(i, { pct: Number(e.target.value) } as Partial<T>)}
            />
            %
          </span>
          {amounts && <span className="mono biz-milestone-amt">{amounts[i] ?? ''}</span>}
          <button className="btn btn-ghost btn-icon" aria-label={`Remove milestone ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div className="biz-milestones-foot">
        <button
          className="btn btn-small"
          onClick={() => onChange([...value, { label: 'Milestone', pct: Math.max(0, 100 - total), trigger: 'ON_DELIVERY' } as T])}
        >
          Add milestone
        </button>
        <span className={`mono ${ok ? 'biz-ok' : 'biz-bad'}`} role={ok ? undefined : 'alert'}>
          Total {Math.round(total * 100) / 100}% {ok ? '' : '— must be 100%'}
        </span>
      </div>
    </div>
  );
}

export function UpgradeNote({ children, onUpgrade, cta = 'See plans' }: { children: ReactNode; onUpgrade: () => void; cta?: string }) {
  return (
    <div className="biz-upgrade">
      <span>{children}</span>
      <button className="btn btn-small btn-primary" onClick={onUpgrade}>
        {cta}
      </button>
    </div>
  );
}
