import { useEffect, useRef, useState } from 'react';
import type { PlanTemplateMeta, Project } from '@shared/types';
import { useStore } from '../../store';
import { loadSavedProject } from '../../lib/persist';
import { BLANK_META, loadTemplate, loadTemplateIndex } from '../../lib/templates';
import { money } from '../../lib/format';
import { PlanThumb } from '../../ui/PlanThumb';
import { IconChevron, IconPlus } from '../../ui/icons';
import { loadEngine, useCloud, wantsEngineAtStart } from '../state';
import type { PendingInvite, ProjectTile } from '../engine';
import {
  AccountChip,
  AccountDialog,
  Dialog,
  ErrorLine,
  RoleBadge,
  SignInButton,
  SignInDialog,
  ago,
  useAction,
  withEngine,
} from './common';
import { ConflictDialog, ShareDialog } from './dialogs';

const SQFT_PER_SQM = 10.7639;

/**
 * Mounted once by the shell when cloud is configured: restores a session (or
 * completes a sign-in / share link) at startup, and hosts every cloud dialog,
 * so they sit above both the home screen and the studio.
 */
export function CloudRoot() {
  const dialog = useCloud((s) => s.dialog);
  const save = useCloud((s) => s.save.state);
  const flash = useCloud((s) => s.flash);
  const screen = useStore((s) => s.screen);
  const [shown, setShown] = useState<typeof flash>(null);

  useEffect(() => {
    if (wantsEngineAtStart()) loadEngine().catch((e) => console.warn('[3xDezine] cloud unavailable', e));
    else useCloud.setState({ status: 'signedOut' });
  }, []);

  // A share link pasted into an already-open tab only changes the hash.
  useEffect(() => {
    const onHash = () => {
      if (/^#\/share\//.test(location.hash) && useCloud.getState().status !== 'signedIn') loadEngine().catch(() => undefined);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!flash) return;
    setShown(flash);
    const t = window.setTimeout(() => setShown((f) => (f?.at === flash.at ? null : f)), 4200);
    return () => window.clearTimeout(t);
  }, [flash]);

  return (
    <>
      {dialog === 'signin' && <SignInDialog />}
      {dialog === 'account' && <AccountDialog />}
      {dialog === 'share' && <ShareDialog />}
      {save === 'conflict' && <ConflictDialog />}
      {shown && screen === 'home' && (
        <div key={shown.at} className={`toast toast-${shown.tone} cloud-flash`} role="status" aria-live="polite">
          <span>{shown.text}</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------

export function HomeAccount() {
  const status = useCloud((s) => s.status);
  if (status === 'off') return null;
  return <div className="cloud-home-account">{status === 'signedIn' ? <AccountChip /> : <SignInButton className="btn" />}</div>;
}

export function HomeProjects() {
  const status = useCloud((s) => s.status);
  const listRev = useCloud((s) => s.listRev);
  const [tiles, setTiles] = useState<ProjectTile[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let live = true;
    withEngine(async (e) => {
      const [list, inv] = await Promise.all([e.listProjects(), e.listMyInvites()]);
      if (!live) return;
      setTiles(list);
      setInvites(inv);
      setError(null);
    }).catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [status, listRev]);

  if (status === 'off') return null;
  if (status !== 'signedIn') {
    return (
      <section className="cloud-banner" aria-label="Cloud projects">
        <div>
          <b>Your projects, anywhere</b>
          <span>Sign in to keep plans in the cloud, see version history, and share them with clients and site teams.</span>
        </div>
        <SignInButton className="btn btn-primary" />
      </section>
    );
  }

  return (
    <section className="cloud-section" aria-label="Your projects">
      <header className="cloud-section-head">
        <h2>Your projects</h2>
        {tiles && <span className="badge badge-quiet">{tiles.length}</span>}
        <span className="topbar-spacer" />
        <NewProjectMenu />
      </header>
      {invites.length > 0 && <Invites invites={invites} />}
      <ErrorLine text={error} />
      {tiles === null && !error && (
        <div className="home-grid">
          {[0, 1].map((i) => (
            <div key={i} className="home-tile cloud-tile-skeleton" style={{ ['--i' as string]: i }}>
              <span className="home-thumb">
                <span className="home-thumb-wait" />
              </span>
              <span className="home-tile-body" />
            </div>
          ))}
        </div>
      )}
      {tiles && tiles.length === 0 && (
        <p className="home-empty">
          Nothing in the cloud yet. Use <b>New project</b> to save a template or your current plan.
        </p>
      )}
      {tiles && tiles.length > 0 && (
        <div className="home-grid">
          {tiles.map((t, i) => (
            <CloudTile key={t.id} tile={t} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function Invites({ invites }: { invites: PendingInvite[] }) {
  const { busy, error, run } = useAction();
  return (
    <div className="cloud-invites">
      {invites.map((inv) => (
        <div key={inv.id} className="cloud-invite">
          <span>
            <b>{inv.invitedByName}</b> invited you to <b>{inv.projectName}</b> with{' '}
            <RoleBadge role={inv.role} /> access
          </span>
          <button
            className="btn btn-small btn-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const id = await withEngine((e) => e.acceptInvite(inv.id));
                await withEngine((e) => e.openCloudProject(id));
              })
            }
          >
            Accept
          </button>
        </div>
      ))}
      <ErrorLine text={error} />
    </div>
  );
}

function AreaLine({ sqm }: { sqm: number }) {
  const sqft = useCloud((s) => s.profile?.preferences.showSqft ?? true);
  return (
    <>
      <b className="mono">{sqm.toFixed(0)}</b> m²
      {sqft && (
        <>
          {' '}
          · <span className="mono">{Math.round(sqm * SQFT_PER_SQM).toLocaleString('en-IN')}</span> sq ft
        </>
      )}
    </>
  );
}

function CloudTile({ tile, index }: { tile: ProjectTile; index: number }) {
  const catalog = useStore((s) => s.catalog);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tile.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAction();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  const open = () => void run(() => withEngine((e) => e.openCloudProject(tile.id)));
  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === tile.name) return setName(tile.name);
    void run(() => withEngine((e) => e.renameProject(tile.id, next)));
  };

  return (
    <div ref={wrap} className="cloud-tile-wrap" style={{ ['--i' as string]: index }}>
      <button className={`home-tile cloud-tile ${busy ? 'is-busy' : ''}`} onClick={open} disabled={busy || renaming} aria-label={`Open ${tile.name}`}>
        <span className="home-thumb">
          {tile.data ? (
            <PlanThumb project={tile.data} catalog={catalog} className="home-thumb-svg" />
          ) : (
            <span className="home-thumb-wait" />
          )}
          <RoleBadge role={tile.role} className="home-tile-tag cloud-tile-role" />
          {tile.pendingProposals > 0 && (
            <span className="home-tile-tag cloud-tile-pending">
              {tile.pendingProposals} proposal{tile.pendingProposals === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="home-tile-body">
          <span className="home-tile-name">{name}</span>
          <span className="home-tile-tagline">
            Updated {ago(tile.updatedAt)}
            {tile.role !== 'OWNER' && ` · by ${tile.ownerName}`}
          </span>
          <span className="home-tile-facts">
            <span>
              <AreaLine sqm={tile.builtUpSqm} />
            </span>
            <span>
              <b className="mono">{tile.rooms}</b> rooms
            </span>
            <span className="mono">v{tile.version}</span>
          </span>
          <span className="home-tile-cost">
            <span className="home-tile-cost-label">Buffered total</span>
            <span className="mono home-tile-cost-value">{money(tile.bufferedTotal, tile.currency)}</span>
          </span>
        </span>
      </button>
      <button
        className={`cloud-tile-more ${menu ? 'is-open' : ''}`}
        onClick={() => setMenu((m) => !m)}
        aria-label={`More actions for ${tile.name}`}
        aria-expanded={menu}
      >
        ···
      </button>
      {menu && (
        <div className="cloud-menu" role="menu">
          {(tile.role === 'OWNER' || tile.role === 'FULL' || tile.role === 'LAYOUT' || tile.role === 'FINISHES') && (
            <button role="menuitem" onClick={() => (setMenu(false), setRenaming(true))}>
              Rename
            </button>
          )}
          <button role="menuitem" onClick={() => (setMenu(false), void run(() => withEngine((e) => e.duplicateProject(tile.id))))}>
            Duplicate
          </button>
          {tile.role === 'OWNER' && (
            <button role="menuitem" className="cloud-menu-danger" onClick={() => (setMenu(false), setConfirmDelete(true))}>
              Delete…
            </button>
          )}
        </div>
      )}
      {error && <p className="cloud-error cloud-tile-error">{error}</p>}
      {renaming && (
        <Dialog
          title="Rename project"
          onClose={() => {
            setName(tile.name);
            setRenaming(false);
          }}
          width={380}
        >
          <form
            className="cloud-stack"
            onSubmit={(e) => {
              e.preventDefault();
              commitRename();
            }}
          >
            <input className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            <div className="cloud-actions">
              <span className="topbar-spacer" />
              <button type="button" className="btn" onClick={() => (setName(tile.name), setRenaming(false))}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                Rename
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {confirmDelete && (
        <Dialog title="Delete project?" onClose={() => setConfirmDelete(false)} width={380}>
          <div className="cloud-stack">
            <p className="cloud-lead">
              <b>{tile.name}</b> will be deleted for you and everyone it’s shared with, along with its version history.
              This can’t be undone.
            </p>
            <div className="cloud-actions">
              <span className="topbar-spacer" />
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmDelete(false);
                  void run(() => withEngine((e) => e.deleteProject(tile.id)));
                }}
              >
                Delete project
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NewProjectMenu() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<PlanTemplateMeta[]>([]);
  const { busy, error, run } = useAction();
  const wrap = useRef<HTMLDivElement>(null);
  const active = useCloud((s) => s.active);
  const working = useStore((s) => s.project);
  const openedAt = useStore((s) => s.openedAt);

  useEffect(() => {
    if (!open) return;
    loadTemplateIndex().then((list) => setIndex([...list, BLANK_META]));
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // The local working plan: what "Continue" would open.
  const local: Project | null = active ? (loadSavedProject()?.project ?? null) : openedAt > 0 || loadSavedProject() ? working : null;

  const create = (getProject: () => Promise<Project>) =>
    void run(async () => {
      const project = await getProject();
      const summary = await withEngine((e) => e.createProject(project.name, project, project.templateId));
      setOpen(false);
      await withEngine((e) => e.openCloudProject(summary.id));
    });

  return (
    <div ref={wrap} className="cloud-new">
      <button className="btn btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={busy}>
        <IconPlus size={12} />
        {busy ? 'Creating…' : 'New project'}
        <IconChevron size={11} className={`caret ${open ? 'caret-open' : ''}`} />
      </button>
      {open && (
        <div className="cloud-menu cloud-new-menu" role="menu">
          {local && (
            <button role="menuitem" onClick={() => create(async () => structuredClone(local))}>
              <b>Save current plan to cloud</b>
              <small>{local.name}</small>
            </button>
          )}
          <span className="cloud-menu-label">From a template</span>
          {index.map((meta) => (
            <button key={meta.id} role="menuitem" onClick={() => create(() => loadTemplate(meta))}>
              <b>{meta.name}</b>
              <small>
                {meta.bhk === 0 ? 'Studio' : `${meta.bhk} BHK`} · {meta.builtUpSqm.toFixed(0)} m²
              </small>
            </button>
          ))}
          <ErrorLine text={error} />
        </div>
      )}
    </div>
  );
}

