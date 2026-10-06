import { useEffect, useState } from 'react';
import type { VersionReason } from '@shared/cloud';
import { useStore } from '../../store';
import { polygonArea } from '../../lib/planMath';
import { money } from '../../lib/format';
import { useCost } from '../../ui/CostPanel';
import { signedMoney } from '../../ui/ProposalsPanel';
import { IconLock } from '../../ui/icons';
import { ROLE_LABEL, useCloud, useHistoryPanel, type SaveState } from '../state';
import type { VersionRow } from '../engine';
import { AccountChip, Avatar, ErrorLine, SignInButton, ago, useAction, withEngine } from './common';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline',
  conflict: 'Conflict',
  forbidden: 'Not saved',
  readonly: 'Read-only',
};

/** Top-bar cluster: save state, history, share, account — or "Save to cloud" / "Sign in". */
export function TopBarCloud() {
  const status = useCloud((s) => s.status);
  const active = useCloud((s) => s.active);
  const save = useCloud((s) => s.save);
  const history = useHistoryPanel((s) => s.open);
  const { busy, run, error } = useAction();
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    if (error) notify(error, 'warn');
  }, [error, notify]);

  if (status === 'off') return null;

  return (
    <>
      {active && save.state !== 'idle' && (
        <span
          className={`cloud-save cloud-save-${save.state}`}
          title={save.message ?? (save.state === 'saved' ? `Version ${active.version}` : SAVE_LABEL[save.state])}
          role="status"
          aria-live="polite"
        >
          <i className="dot" />
          {SAVE_LABEL[save.state]}
        </span>
      )}
      {active && (
        <span className="cloud-role-pill" title={`Your access: ${ROLE_LABEL[active.role]}${active.cap !== (active.role === 'OWNER' ? active.cap : active.role) ? ` (project capped at ${ROLE_LABEL[active.cap]})` : ''}`}>
          {ROLE_LABEL[active.link && !active.link.joined ? 'VIEW' : active.role]}
        </span>
      )}
      {active && status === 'signedIn' && !active.link && (
        <button
          className={`btn btn-ghost ${history ? 'btn-ghost-on' : ''}`}
          onClick={() => useHistoryPanel.setState({ open: !history })}
          aria-pressed={history}
          title="Version history"
        >
          History
        </button>
      )}
      {active?.role === 'OWNER' && (
        <button className="btn btn-ghost" onClick={() => useCloud.setState({ dialog: 'share' })}>
          Share
        </button>
      )}
      {!active && status === 'signedIn' && (
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void run(() => withEngine((e) => e.saveCurrentToCloud()))}
          title="Keep this plan in your cloud projects"
        >
          {busy ? 'Saving…' : 'Save to cloud'}
        </button>
      )}
      {status === 'signedIn' ? <AccountChip compact /> : <SignInButton />}
      <StudioBanners />
    </>
  );
}

/** Share-link access and refused saves, floating under the top bar. */
function StudioBanners() {
  const active = useCloud((s) => s.active);
  const status = useCloud((s) => s.status);
  const save = useCloud((s) => s.save);
  const { busy, run, error } = useAction();
  const [hidden, setHidden] = useState<number | null>(null);

  const link = active?.link && !active.link.joined ? active.link : null;
  const refused = save.state === 'forbidden' && hidden !== save.at ? save : null;
  if (!link && !refused) return null;

  return (
    <div className="cloud-banners">
      {link && (
        <div className="cloud-studio-banner">
          <IconLock size={12} />
          <span>
            Shared with you by link — <b>{link.role === 'FINISHES' ? 'Finishes' : 'View'}</b> access.{' '}
            {link.role === 'FINISHES' ? 'Join to change finishes and propose layout changes.' : 'Join to keep it in your projects.'}
          </span>
          {status === 'signedIn' ? (
            <button className="btn btn-small btn-primary" disabled={busy} onClick={() => void run(() => withEngine((e) => e.joinShared()))}>
              {busy ? 'Joining…' : 'Join'}
            </button>
          ) : (
            <button className="btn btn-small btn-primary" onClick={() => useCloud.setState({ dialog: 'signin' })}>
              Sign in to join
            </button>
          )}
          {error && <span className="cloud-error">{error}</span>}
        </div>
      )}
      {refused && (
        <div className="cloud-studio-banner cloud-studio-banner-warn" role="alert">
          <IconLock size={12} />
          <span>
            <b>Change undone.</b> {refused.message}
            {refused.violations && refused.violations.length > 0 && (
              <ul className="cloud-violations">
                {refused.violations.slice(0, 4).map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            )}
          </span>
          <button className="btn btn-small btn-ghost" onClick={() => setHidden(save.at)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

const REASON: Record<VersionReason, string> = {
  CREATE: 'Created',
  SAVE: 'Saved',
  PROPOSAL_ACCEPTED: 'Proposal accepted',
  RESTORE: 'Restored',
};

export function CloudRail() {
  const open = useHistoryPanel((s) => s.open);
  const active = useCloud((s) => s.active);
  if (!open || !active || active.link) return null;
  return <HistoryPanel />;
}

function HistoryPanel() {
  const active = useCloud((s) => s.active)!;
  const project = useStore((s) => s.project);
  const preview = useStore((s) => s.versionPreview);
  const setPreview = useStore((s) => s.setVersionPreview);
  const cost = useCost();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const canRestore = active.role === 'OWNER' || active.role === 'FULL';
  const rooms = project.floors[0]?.rooms ?? [];
  const sqm = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);

  useEffect(() => {
    let live = true;
    withEngine((e) => e.listVersions(active.id))
      .then((list) => live && setVersions(list))
      .catch(() => live && setVersions([]));
    return () => {
      live = false;
    };
  }, [active.id, active.version]);

  useEffect(() => () => useStore.getState().setVersionPreview(null), []);

  const togglePreview = (v: VersionRow) =>
    void run(async () => {
      if (preview?.version.id === v.id) return setPreview(null);
      const data = await withEngine((e) => e.versionData(v.id));
      setPreview({ version: v, project: data });
    });

  return (
    <div className="panel cloud-history">
      <header className="panel-header">
        <h2>Version history</h2>
        <span className="badge badge-quiet">v{active.version}</span>
      </header>
      <p className="hint">
        Now: <b className="mono">{rooms.length}</b> rooms · <b className="mono">{sqm.toFixed(0)}</b> m² ·{' '}
        <span className="mono cloud-gold">{money(cost.total, cost.currency)}</span>
      </p>
      {!versions && <p className="hint">Loading…</p>}
      <ErrorLine text={error} />
      <ul className="cloud-versions">
        {versions?.map((v) => {
          const delta = signedMoney(v.summary.bufferedTotal - cost.total, cost.currency);
          const current = v.version === active.version;
          const on = preview?.version.id === v.id;
          return (
            <li key={v.id} className={`cloud-version ${on ? 'cloud-version-on' : ''}`}>
              <div className="cloud-version-head">
                <Avatar name={v.authorName} size={22} />
                <span className="cloud-person">
                  <b>
                    v{v.version} · {REASON[v.reason]}
                    {current && <span className="cloud-current">current</span>}
                  </b>
                  <small>
                    {v.authorName} · {ago(v.createdAt)}
                  </small>
                </span>
                <span className={`mono proposal-delta delta-${delta.tone}`} title="Buffered total compared with the plan now">
                  {current ? '' : delta.text}
                </span>
              </div>
              <div className="cloud-version-facts">
                <span>
                  <b className="mono">{v.summary.rooms}</b> rooms
                </span>
                <span>
                  <b className="mono">{v.summary.builtUpSqm.toFixed(0)}</b> m²
                </span>
                <span className="mono cloud-gold">{money(v.summary.bufferedTotal, cost.currency)}</span>
              </div>
              {!current && (
                <div className="cloud-version-actions">
                  <button className={`chip ${on ? 'chip-on' : ''}`} disabled={busy} onClick={() => togglePreview(v)}>
                    {on ? 'Hide preview' : 'Preview on plan'}
                  </button>
                  <span className="topbar-spacer" />
                  {canRestore &&
                    (confirm === v.id ? (
                      <>
                        <button className="btn btn-small" onClick={() => setConfirm(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-small btn-primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await withEngine((e) => e.restoreVersion(v.id));
                              setConfirm(null);
                            })
                          }
                        >
                          Restore v{v.version}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-small" onClick={() => setConfirm(v.id)}>
                        Restore…
                      </button>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!canRestore && <p className="hint">Preview any version; the owner or a Full member can restore one.</p>}
    </div>
  );
}
