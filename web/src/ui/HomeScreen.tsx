import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Catalog, PlanTemplateMeta, Project } from '@shared/types';
import { estimateCost } from '@shared/cost';
import { useStore } from '../store';
import { BLANK_META, loadTemplate, loadTemplateIndex } from '../lib/templates';
import { loadSavedProject } from '../lib/persist';
import { polygonArea } from '../lib/planMath';
import { money } from '../lib/format';
import { PlanThumb } from './PlanThumb';
import { IconChevron } from './icons';
import { CLOUD_ENABLED, useCloud } from '../cloud/state';

// The cloud strip shares a chunk with the shell's cloud root; neither exists
// for a build without VITE_SUPABASE_URL.
const HomeAccount = lazy(() => import('../cloud/ui/shell').then((m) => ({ default: m.HomeAccount })));
const HomeProjects = lazy(() => import('../cloud/ui/shell').then((m) => ({ default: m.HomeProjects })));

type Category = 'ALL' | PlanTemplateMeta['category'];

const CATEGORIES: Array<[Category, string]> = [
  ['ALL', 'All'],
  ['STUDIO', 'Studio'],
  ['APARTMENT', 'Apartment'],
  ['VILLA', 'Villa'],
  ['COMMERCIAL', 'Commercial'],
];

const SQFT_PER_SQM = 10.7639;

/**
 * Tiles price themselves after they draw, one per tick, so eight
 * estimates never land in the same frame as the entrance animation. The
 * engine itself is tiny and already in the shell (the rules engine uses it).
 */
const totals = new WeakMap<Project, number>();
let queue: Promise<unknown> = Promise.resolve();
function estimate(project: Project, catalog: Catalog): Promise<number> {
  const hit = totals.get(project);
  if (hit !== undefined) return Promise.resolve(hit);
  const next = queue.then(
    () =>
      new Promise<number>((resolve) =>
        window.setTimeout(() => {
          const total = estimateCost(project, catalog).total;
          totals.set(project, total);
          resolve(total);
        }, 16),
      ),
  );
  queue = next.catch(() => undefined);
  return next;
}

function bhkLabel(bhk: number) {
  return bhk === 0 ? 'Studio' : `${bhk} BHK`;
}

function areaLine(sqm: number) {
  return (
    <>
      <b className="mono">{sqm.toFixed(0)}</b> m² · <span className="mono">{Math.round(sqm * SQFT_PER_SQM).toLocaleString('en-IN')}</span> sq ft
    </>
  );
}

function useTemplateProject(meta: PlanTemplateMeta) {
  const [project, setProject] = useState<Project | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadTemplate(meta)
      .then((p) => live && setProject(p))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [meta]);
  return { project, failed };
}

function useEstimate(project: Project | null, catalog: Catalog) {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!project) return;
    let live = true;
    estimate(project, catalog)
      .then((t) => live && setTotal(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, catalog]);
  return total;
}

function Tile({
  meta,
  index,
  onOpen,
}: {
  meta: PlanTemplateMeta;
  index: number;
  onOpen: (project: Project) => void;
}) {
  const catalog = useStore((s) => s.catalog);
  const { project, failed } = useTemplateProject(meta);
  const total = useEstimate(project, catalog);
  const style = catalog.styles.find((s) => s.id === meta.styleId);

  return (
    <button
      className="home-tile"
      style={{ ['--i' as string]: index }}
      disabled={!project}
      onClick={() => project && onOpen(project)}
      aria-label={`Open ${meta.name}`}
    >
      <span className="home-thumb">
        {project ? (
          <PlanThumb project={project} catalog={catalog} className="home-thumb-svg" />
        ) : (
          <span className={`home-thumb-wait ${failed ? 'home-thumb-failed' : ''}`}>
            {failed ? 'Plan unavailable' : ''}
          </span>
        )}
        <span className="home-tile-tag">{bhkLabel(meta.bhk)}</span>
      </span>
      <span className="home-tile-body">
        <span className="home-tile-name">{meta.name}</span>
        {meta.tagline && <span className="home-tile-tagline">{meta.tagline}</span>}
        <span className="home-tile-facts">
          <span>{areaLine(meta.builtUpSqm)}</span>
          <span>
            <b className="mono">{meta.rooms}</b> rooms
          </span>
          {style && <span>{style.name}</span>}
        </span>
        <span className="home-tile-cost">
          <span className="home-tile-cost-label">Est. buffered total</span>
          <span className={`mono home-tile-cost-value ${total === null ? 'is-pending' : ''}`}>
            {total === null ? '₹ —' : money(total, project?.currency ?? 'INR')}
          </span>
        </span>
      </span>
    </button>
  );
}

function ContinueTile({ project, savedAt, onOpen }: { project: Project; savedAt?: string; onOpen: () => void }) {
  const catalog = useStore((s) => s.catalog);
  const total = useEstimate(project, catalog);
  const rooms = project.floors[0]?.rooms ?? [];
  const sqm = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const pending = (project.proposals ?? []).filter((p) => p.status === 'PENDING').length;
  const when = savedAt ? new Date(savedAt) : null;

  return (
    <button className="home-tile home-tile-continue" style={{ ['--i' as string]: 0 }} onClick={onOpen}>
      <span className="home-thumb">
        <PlanThumb project={project} catalog={catalog} className="home-thumb-svg" />
        <span className="home-tile-tag home-tile-tag-accent">Continue</span>
      </span>
      <span className="home-tile-body">
        <span className="home-tile-name">{project.name}</span>
        <span className="home-tile-tagline">
          {when && !Number.isNaN(when.getTime())
            ? `Last edited ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
            : 'Your working plan'}
          {pending > 0 && ` · ${pending} proposal${pending === 1 ? '' : 's'} pending`}
        </span>
        <span className="home-tile-facts">
          <span>{areaLine(sqm)}</span>
          <span>
            <b className="mono">{rooms.length}</b> rooms
          </span>
        </span>
        <span className="home-tile-cost">
          <span className="home-tile-cost-label">Buffered total</span>
          <span className={`mono home-tile-cost-value ${total === null ? 'is-pending' : ''}`}>
            {total === null ? '₹ —' : money(total, project.currency)}
          </span>
        </span>
        <span className="home-tile-cta">
          Resume <IconChevron size={11} className="home-cta-icon" />
        </span>
      </span>
    </button>
  );
}

export function HomeScreen() {
  const openProject = useStore((s) => s.openProject);
  const working = useStore((s) => s.project);
  const openedAt = useStore((s) => s.openedAt);
  const cloudOpen = useCloud((s) => s.active !== null);
  const [saved] = useState(loadSavedProject);
  const [index, setIndex] = useState<PlanTemplateMeta[] | null>(null);
  const [category, setCategory] = useState<Category>('ALL');
  const [bhk, setBhk] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    loadTemplateIndex().then((list) => live && setIndex(list));
    return () => {
      live = false;
    };
  }, []);

  const bhkOptions = useMemo(
    () => [...new Set((index ?? []).filter((m) => m.bhk > 0).map((m) => m.bhk))].sort((a, b) => a - b),
    [index],
  );

  const shown = useMemo(
    () =>
      (index ?? []).filter(
        (m) => (category === 'ALL' || m.category === category) && (bhk === null || m.bhk === bhk),
      ),
    [index, category, bhk],
  );

  // Something worth continuing: a plan restored from storage, or one opened this
  // session. A cloud project lives in "Your projects", so Continue then means
  // the local plan this browser remembers.
  const local = cloudOpen ? (saved?.project ?? null) : working;
  const canContinue = cloudOpen ? Boolean(saved) : Boolean(saved) || openedAt > 0;
  const showBlank = (category === 'ALL' || category === 'STUDIO') && bhk === null;

  return (
    <div className="home" role="main">
      <div className="home-inner">
        <header className="home-head">
          <div className="home-brandrow">
            <div className="brand">
              <span className="brand-mark">3×</span>
              <span className="brand-text">
                Dezine
                <small>Studio</small>
              </span>
            </div>
            {CLOUD_ENABLED && (
              <Suspense fallback={null}>
                <HomeAccount />
              </Suspense>
            )}
          </div>
          <div className="home-title">
            <h1>Start from a plan</h1>
            <p>
              Pick a starting layout. Every finish is priced live, in rupees, with a buffer for
              wastage — then walk through it in 3D.
            </p>
          </div>
        </header>

        {CLOUD_ENABLED && (
          <Suspense fallback={null}>
            <HomeProjects />
          </Suspense>
        )}

        <div className="home-filters" role="toolbar" aria-label="Filter templates">
          <div className="segmented">
            {CATEGORIES.map(([id, label]) => (
              <button
                key={id}
                className={`seg ${category === id ? 'seg-on' : ''}`}
                onClick={() => setCategory(id)}
                aria-pressed={category === id}
              >
                {label}
              </button>
            ))}
          </div>
          {bhkOptions.length > 1 && (
            <div className="home-bhk">
              {bhkOptions.map((n) => (
                <button
                  key={n}
                  className={`chip ${bhk === n ? 'chip-on' : ''}`}
                  onClick={() => setBhk((b) => (b === n ? null : n))}
                  aria-pressed={bhk === n}
                >
                  {n} BHK
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="home-grid">
          {canContinue && local && (
            <ContinueTile project={local} savedAt={saved?.savedAt} onOpen={() => openProject(local)} />
          )}
          {shown.map((meta, i) => (
            <Tile key={meta.id} meta={meta} index={i + (canContinue ? 1 : 0)} onOpen={openProject} />
          ))}
          {showBlank && (
            <Tile meta={BLANK_META} index={shown.length + (canContinue ? 1 : 0)} onOpen={openProject} />
          )}
          {index && shown.length === 0 && !showBlank && (
            <p className="home-empty">No template matches those filters.</p>
          )}
        </div>
        {canContinue && (
          <p className="home-note">Opening a template replaces the working plan in this browser.</p>
        )}
      </div>
    </div>
  );
}
