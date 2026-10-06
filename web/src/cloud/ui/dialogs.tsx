import { useCallback, useEffect, useState } from 'react';
import type { LinkRole, MemberRole } from '@shared/cloud';
import { shareUrl, useCloud } from '../state';
import type { Sharing } from '../engine';
import { Avatar, Dialog, ErrorLine, MEMBER_ROLES, RoleBadge, ago, useAction, withEngine } from './common';

const EXPIRY: Array<[number, string]> = [
  [0, 'Never expires'],
  [1, '1 day'],
  [7, '7 days'],
  [30, '30 days'],
];

/** Owner-only: members, pending invites and share links for the open project. */
export function ShareDialog() {
  const active = useCloud((s) => s.active);
  const close = () => useCloud.setState({ dialog: null });
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('FINISHES');
  const [linkRole, setLinkRole] = useState<LinkRole>('VIEW');
  const [expiry, setExpiry] = useState(7);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const projectId = active?.id;

  const reload = useCallback(async () => {
    if (!projectId) return;
    setSharing(await withEngine((e) => e.loadSharing(projectId)));
  }, [projectId]);

  useEffect(() => {
    void run(reload);
  }, [reload]);

  if (!active || active.role !== 'OWNER') return null;

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return;
    void run(async () => {
      const r = await withEngine((e) => e.inviteMember(active.id, email, role));
      setNote(
        r.member
          ? `${r.member.displayName} already has an account and was added.`
          : `Invited ${r.invite.email}. They’ll see it on their home screen after signing in with that email.`,
      );
      setEmail('');
      await reload();
    });
  };

  const copy = async (token: string) => {
    const url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(token);
    window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1600);
  };

  const links = sharing?.links.filter((l) => !l.revoked && (!l.expiresAt || new Date(l.expiresAt).getTime() > Date.now())) ?? [];

  return (
    <Dialog title={`Share “${active.name}”`} onClose={close} width={520}>
      <div className="cloud-stack">
        <form className="cloud-invite-form" onSubmit={invite}>
          <input
            className="input"
            type="email"
            placeholder="Invite by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email to invite"
          />
          <select className="input select" value={role} onChange={(e) => setRole(e.target.value as MemberRole)} aria-label="Role">
            {MEMBER_ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={busy || !email.trim()} type="submit">
            Invite
          </button>
        </form>
        <p className="cloud-hint">{MEMBER_ROLES.find((r) => r.id === role)?.detail}</p>
        {note && <p className="cloud-note">{note}</p>}
        <ErrorLine text={error} />

        <section className="cloud-share-block">
          <h3>People</h3>
          {!sharing && <p className="cloud-hint">Loading…</p>}
          {sharing && sharing.members.length === 0 && sharing.invites.length === 0 && (
            <p className="cloud-hint">Only you so far.</p>
          )}
          <ul className="cloud-people">
            {sharing?.members.map((m) => (
              <li key={m.userId}>
                <Avatar name={m.displayName} color={m.avatarColor} />
                <span className="cloud-person">
                  <b>{m.displayName}</b>
                  {m.email && <small>{m.email}</small>}
                </span>
                <select
                  className="input select cloud-role-select"
                  value={m.role}
                  aria-label={`Role for ${m.displayName}`}
                  onChange={(e) => {
                    // Read now: the controlled select snaps back before the engine call runs.
                    const next = e.target.value as MemberRole;
                    void run(async () => {
                      await withEngine((en) => en.setMemberRole(active.id, m.userId, next));
                      await reload();
                    });
                  }}
                >
                  {MEMBER_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() =>
                    void run(async () => {
                      await withEngine((en) => en.removeMember(active.id, m.userId));
                      await reload();
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
            {sharing?.invites.map((inv) => (
              <li key={inv.id} className="cloud-pending">
                <Avatar name={inv.email} />
                <span className="cloud-person">
                  <b>{inv.email}</b>
                  <small>Invited {ago(inv.createdAt)} · pending</small>
                </span>
                <RoleBadge role={inv.role} />
              </li>
            ))}
          </ul>
        </section>

        <section className="cloud-share-block">
          <h3>Links</h3>
          <p className="cloud-hint">Anyone with a link can open the plan, even signed out. Links stop at Finishes — moving walls needs a named member.</p>
          <div className="cloud-link-form">
            <div className="segmented" role="radiogroup" aria-label="Link access">
              {(['VIEW', 'FINISHES'] as const).map((r) => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={linkRole === r}
                  className={`seg ${linkRole === r ? 'seg-on' : ''}`}
                  onClick={() => setLinkRole(r)}
                >
                  {r === 'VIEW' ? 'View' : 'Finishes'}
                </button>
              ))}
            </div>
            <select className="input select" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} aria-label="Expiry">
              {EXPIRY.map(([d, label]) => (
                <option key={d} value={d}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await withEngine((e) => e.createShareLink(active.id, linkRole, expiry || undefined));
                  await reload();
                  await copy(r.link.token);
                })
              }
            >
              Create link
            </button>
          </div>
          <ul className="cloud-links">
            {links.map((l) => (
              <li key={l.token}>
                <RoleBadge role={l.role} />
                <span className="mono cloud-link-url" title={shareUrl(l.token)}>
                  …/share/{l.token.slice(0, 10)}…
                </span>
                <small className="cloud-link-exp">
                  {l.expiresAt ? `expires ${new Date(l.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : 'no expiry'}
                </small>
                <button className="btn btn-small" onClick={() => void copy(l.token)}>
                  {copied === l.token ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() =>
                    void run(async () => {
                      await withEngine((e) => e.revokeShareLink(active.id, l.token));
                      await reload();
                    })
                  }
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

/** Two writers, one version: the user decides, nothing is overwritten silently. */
export function ConflictDialog() {
  const save = useCloud((s) => s.save);
  const name = useCloud((s) => s.active?.name ?? 'this project');
  const { busy, error, run } = useAction();
  return (
    <Dialog title="Someone else saved this project" onClose={() => undefined} width={440} closable={false}>
      <div className="cloud-stack">
        <p className="cloud-lead">
          <b>{name}</b> changed on the server{save.currentVersion ? ` (now version ${save.currentVersion})` : ''} while you
          were editing. Your latest changes are not saved yet.
        </p>
        <div className="cloud-choice">
          <button className="cloud-choice-btn" disabled={busy} onClick={() => void run(() => withEngine((e) => e.reloadTheirs()))}>
            <b>Reload theirs</b>
            <small>Load the newest version. Your unsaved changes are discarded.</small>
          </button>
          <button className="cloud-choice-btn" disabled={busy} onClick={() => void run(() => withEngine((e) => e.keepMine()))}>
            <b>Keep mine</b>
            <small>Save your plan as a new version on top. Their changes stay in the version history.</small>
          </button>
        </div>
        <ErrorLine text={error} />
      </div>
    </Dialog>
  );
}
