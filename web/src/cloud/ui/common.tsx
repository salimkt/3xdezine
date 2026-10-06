import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccessRole, MemberRole } from '@shared/cloud';
import { GOOGLE_ENABLED, ROLE_LABEL, loadEngine, useCloud, type Engine } from '../state';
import { useStore } from '../../store';
import './cloud.css';

/** Runs an engine action, loading the SDK first if this is the first cloud action. */
export async function withEngine<T>(fn: (engine: Engine) => Promise<T>): Promise<T> {
  return fn(await loadEngine());
}

/** busy / error state for one async action. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (live.current) setError((e as Error).message || 'Something went wrong.');
      return undefined;
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function ago(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 86400 * 6) return `${Math.round(sec / 86400)} d ago`;
  return new Date(t).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export function Avatar({ name, color, size = 24 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      className="cloud-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: color ?? 'var(--n-6)' }}
      aria-hidden
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function RoleBadge({ role, className = '' }: { role: AccessRole; className?: string }) {
  return <span className={`cloud-role cloud-role-${role.toLowerCase()} ${className}`}>{ROLE_LABEL[role]}</span>;
}

export const MEMBER_ROLES: Array<{ id: MemberRole; label: string; detail: string }> = [
  { id: 'VIEW', label: 'View', detail: 'Can look, nothing else.' },
  { id: 'FINISHES', label: 'Finishes', detail: 'Can change materials and propose layout changes.' },
  { id: 'LAYOUT', label: 'Layout', detail: 'Can move interior walls and openings.' },
  { id: 'FULL', label: 'Full', detail: 'Everything but permissions; can review proposals.' },
];

/** A centred modal on a scrim. Escape and a scrim click close it. */
export function Dialog({
  title,
  onClose,
  children,
  width = 420,
  labelledBy,
  closable = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  labelledBy?: string;
  /** False for a decision the user must make (a save conflict). */
  closable?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closable && closeRef.current();
    window.addEventListener('keydown', onKey);
    // Focus the first field (or the primary action), once, on open.
    const root = box.current;
    const first =
      root?.querySelector<HTMLElement>('input:not([type="checkbox"]), select') ??
      root?.querySelector<HTMLElement>('.btn-primary, .cloud-choice-btn');
    first?.focus();
    if (first instanceof HTMLInputElement && first.value) first.select();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="cloud-scrim" onMouseDown={(e) => closable && e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="cloud-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <header className="cloud-dialog-head">
          <h2>{title}</h2>
          {closable && (
            <button className="btn btn-ghost btn-icon cloud-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="cloud-error" role="alert">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function SignInDialog() {
  const close = () => useCloud.setState({ dialog: null });
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return;
    void run(async () => {
      await withEngine((e) => e.signInWithEmail(email));
      setSentTo(email.trim());
    });
  };

  return (
    <Dialog title="Sign in" onClose={close} width={380}>
      {sentTo ? (
        <div className="cloud-stack">
          <p className="cloud-lead">
            Check <b>{sentTo}</b> — we sent a sign-in link. Open it in this browser and you’ll land back here, signed in.
          </p>
          <div className="cloud-actions">
            <button className="btn btn-ghost" onClick={() => setSentTo(null)}>
              Use another email
            </button>
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="cloud-stack" onSubmit={send}>
          <p className="cloud-lead">
            Keep projects in the cloud, open them anywhere, and share them with clients and site engineers. Without an
            account everything still works, in this browser.
          </p>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@studio.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <ErrorLine text={error} />
          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {GOOGLE_ENABLED && (
            <>
              <div className="cloud-or">
                <span>or</span>
              </div>
              <button
                type="button"
                className="btn btn-block"
                disabled={busy}
                onClick={() => void run(() => withEngine((e) => e.signInWithGoogle()))}
              >
                Continue with Google
              </button>
            </>
          )}
        </form>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const SWATCHES = ['#C0573E', '#B7793A', '#8A8F3C', '#4F8A5B', '#2F8A84', '#3C7BA8', '#5867B0', '#7C5BA6', '#A4528A', '#6B6460'];

export function AccountChip({ compact = false }: { compact?: boolean }) {
  const profile = useCloud((s) => s.profile);
  const user = useCloud((s) => s.user);
  if (!user) return null;
  const name = profile?.displayName || user.email;
  return (
    <button
      className={`cloud-chip ${compact ? 'cloud-chip-compact' : ''}`}
      onClick={() => useCloud.setState({ dialog: 'account' })}
      title={`Signed in as ${user.email}`}
      aria-label="Account"
    >
      <Avatar name={name} color={profile?.avatarColor} size={22} />
      {!compact && <span className="cloud-chip-name">{name}</span>}
    </button>
  );
}

export function AccountDialog() {
  const profile = useCloud((s) => s.profile);
  const user = useCloud((s) => s.user);
  const close = () => useCloud.setState({ dialog: null });
  const [name, setName] = useState(profile?.displayName ?? '');
  const [color, setColor] = useState(profile?.avatarColor ?? SWATCHES[5]);
  const [showSqft, setShowSqft] = useState(profile?.preferences.showSqft ?? true);
  const [hour, setHour] = useState(profile?.preferences.defaultHour ?? 15.5);
  const { busy, error, run } = useAction();

  if (!user) return null;

  const save = () =>
    void run(async () => {
      await withEngine((e) =>
        e.updateProfile({ displayName: name, avatarColor: color, preferences: { showSqft, defaultHour: hour } }),
      );
      useStore.getState().patchRender({ sunHour: hour });
      close();
    });

  return (
    <Dialog title="Account" onClose={close} width={400}>
      <div className="cloud-stack">
        <div className="cloud-account-head">
          <Avatar name={name || user.email} color={color} size={40} />
          <div>
            <b>{name || 'Your name'}</b>
            <small>{user.email}</small>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Display name — shown on proposals and versions</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Avatar colour</span>
          <div className="cloud-swatches" role="radiogroup" aria-label="Avatar colour">
            {SWATCHES.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color.toUpperCase() === c}
                aria-label={c}
                className={`cloud-swatch ${color.toUpperCase() === c ? 'cloud-swatch-on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <label className="policy-toggle">
          <input type="checkbox" checked={showSqft} onChange={(e) => setShowSqft(e.target.checked)} />
          <span>
            <b>Show sq ft alongside m²</b>
            <small>On project tiles and the home screen.</small>
          </span>
        </label>
        <label className="slider-row">
          <span>
            Default time of day <b className="mono">{fmtHour(hour)}</b>
          </span>
          <input type="range" min={6} max={19} step={0.5} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
        </label>
        <ErrorLine text={error} />
        <div className="cloud-actions">
          <button className="btn btn-ghost" onClick={() => void run(() => withEngine((e) => e.signOut())).then(close)}>
            Sign out
          </button>
          <span className="topbar-spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function fmtHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function SignInButton({ className = 'btn btn-ghost' }: { className?: string }) {
  const status = useCloud((s) => s.status);
  return (
    <button className={className} onClick={() => useCloud.setState({ dialog: 'signin' })} disabled={status === 'loading'}>
      {status === 'loading' ? 'Connecting…' : 'Sign in'}
    </button>
  );
}
