import { useState } from 'react';
import type { RuleSeverity, RuleViolation } from '@shared/types';
import { useStore } from '../store';
import { severityCounts, usePlanViolations } from '../lib/checks';
import { IconAlert, IconCheck, IconChevron, IconInfo } from './icons';

const ORDER: RuleSeverity[] = ['ERROR', 'WARNING', 'INFO'];
const LABEL: Record<RuleSeverity, string> = { ERROR: 'Errors', WARNING: 'Warnings', INFO: 'Notes' };

export function SeverityIcon({ severity, size = 12 }: { severity: RuleSeverity; size?: number }) {
  return severity === 'INFO' ? <IconInfo size={size} /> : <IconAlert size={size} />;
}

/** Compact "2 · 3" count badge, used in the plan toolbar and the panel header. */
export function PlanCheckBadge({ onClick }: { onClick?: () => void }) {
  const counts = severityCounts(usePlanViolations());
  const clean = counts.ERROR + counts.WARNING + counts.INFO === 0;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={`check-badge ${clean ? 'check-badge-ok' : counts.ERROR ? 'check-badge-error' : 'check-badge-warn'}`}
      onClick={onClick}
      title={
        clean
          ? 'Plan check: no issues'
          : `Plan check: ${counts.ERROR} errors, ${counts.WARNING} warnings, ${counts.INFO} notes`
      }
    >
      {clean ? (
        <>
          <IconCheck size={9} /> NBC
        </>
      ) : (
        <>
          {counts.ERROR > 0 && (
            <span className="sev sev-error">
              <IconAlert size={11} />
              {counts.ERROR}
            </span>
          )}
          {counts.WARNING > 0 && (
            <span className="sev sev-warning">
              <IconAlert size={11} />
              {counts.WARNING}
            </span>
          )}
          {counts.INFO > 0 && (
            <span className="sev sev-info">
              <IconInfo size={11} />
              {counts.INFO}
            </span>
          )}
        </>
      )}
    </Tag>
  );
}

export function PlanCheckPanel() {
  const violations = usePlanViolations();
  const floor = useStore((s) => s.project.floors[0]);
  const select = useStore((s) => s.select);
  const focusOn = useStore((s) => s.focusOn);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ INFO: true });

  const go = (v: RuleViolation) => {
    if (v.roomId) {
      select('room', v.roomId);
      focusOn('room', v.roomId);
    } else if (v.wallId) {
      select('wall', v.wallId);
      focusOn('wall', v.wallId);
    } else if (v.openingId) {
      const wallId = floor?.openings.find((o) => o.id === v.openingId)?.wallId;
      if (wallId) {
        select('wall', wallId);
        focusOn('wall', wallId);
      }
    }
  };

  const place = (v: RuleViolation) => {
    if (v.roomId) return floor?.rooms.find((r) => r.id === v.roomId)?.name;
    if (v.wallId) return floor?.walls.find((w) => w.id === v.wallId)?.exterior ? 'Exterior wall' : 'Wall';
    if (v.openingId) return 'Opening';
    return undefined;
  };

  return (
    <div className="panel check-panel" id="plan-check">
      <header className="panel-header">
        <h2>Plan check</h2>
        <PlanCheckBadge />
      </header>
      {violations.length === 0 ? (
        <p className="hint check-clean">
          <IconCheck size={10} /> Every room and wall meets the rules this studio checks (NBC 2016
          minimums for area, width, light and ventilation).
        </p>
      ) : (
        <div className="check-groups">
          {ORDER.map((severity) => {
            const list = violations.filter((v) => v.severity === severity);
            if (!list.length) return null;
            const isCollapsed = collapsed[severity];
            return (
              <section key={severity} className={`check-group check-${severity.toLowerCase()}`}>
                <button
                  className="check-group-head"
                  onClick={() => setCollapsed((c) => ({ ...c, [severity]: !c[severity] }))}
                  aria-expanded={!isCollapsed}
                >
                  <SeverityIcon severity={severity} />
                  <span>{LABEL[severity]}</span>
                  <span className="mono check-count">{list.length}</span>
                  <IconChevron size={11} className={`caret ${isCollapsed ? '' : 'caret-open'}`} />
                </button>
                {!isCollapsed && (
                  <ul className="check-list">
                    {list.map((v, i) => {
                      const where = place(v);
                      const target = v.roomId || v.wallId || v.openingId;
                      return (
                        <li key={`${v.ruleId}-${v.roomId ?? v.wallId ?? v.openingId ?? i}`}>
                          <button
                            className="check-item"
                            onClick={() => go(v)}
                            disabled={!target}
                            title={target ? 'Select and frame it in the plan' : undefined}
                          >
                            <span className="check-msg">{v.message}</span>
                            <span className="check-meta">
                              {where && <span className="check-where">{where}</span>}
                              {v.reference && <span className="check-ref">{v.reference}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
