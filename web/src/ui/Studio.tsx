import { Component, lazy, type ReactNode, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { useStore, type ViewMode } from '../store';
import { DUR, prefersReducedMotion } from '../lib/motion';
import { PlanEditor } from './PlanEditor';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { MaterialPalette } from './MaterialPalette';
import { CostPanel } from './CostPanel';
import { SuggestionsPanel } from './SuggestionsPanel';
import { PlanCheckPanel } from './PlanCheckPanel';
import { ProposalsPanel } from './ProposalsPanel';
import { Toast } from './Toast';
import { IconAlert } from './icons';

/**
 * three.js, the TSL post stack and the scene graph are most of the bundle, and
 * none of it is needed to draw the plan — so the viewport is its own chunk. The
 * shell prefetches it while the home screen is up, so in practice it is warm.
 */
const Viewport = lazy(() => import('../three/Viewport').then((m) => ({ default: m.Viewport })));

function ViewportLoading() {
  return (
    <div className="viewport-overlay">
      <div className="viewport-card">
        <div className="viewport-card-head">
          <div className="spinner" />
          <h3>Loading the renderer</h3>
        </div>
        <p>The plan, the catalogue and the estimate are already live.</p>
        <div className="progress-rail" />
      </div>
    </div>
  );
}

/**
 * A failed 3D pipeline must not take the design tool with it — the plan, the
 * catalog and the estimate all work without a GPU.
 */
class ViewportBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[3xDezine] 3D viewport crashed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="viewport-overlay viewport-error">
          <div className="viewport-card">
            <div className="viewport-card-head">
              <IconAlert size={16} />
              <h3>3D viewport unavailable</h3>
            </div>
            <p>
              This machine&rsquo;s graphics stack refused the render pipeline. The plan, the
              material catalogue and the live estimate are unaffected and keep working.
            </p>
            <div className="viewport-error-detail">{this.state.error.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PaneLayout {
  /** Drives the grid template, and so the animated track sizes. */
  view: ViewMode;
  /** Panes in the DOM. A leaving pane stays mounted until it has shrunk away. */
  plan: boolean;
  three: boolean;
  /**
   * Pixel widths the pane contents are pinned to while the tracks animate. The
   * pane clips its contents instead of resizing them, so the WebGPU canvas
   * resizes at most once per switch — never per frame, which would reallocate
   * every post-processing target and reset TRAA's history on each step.
   */
  freeze: { plan?: number; three?: number };
}

const needs = (view: ViewMode) => ({ plan: view !== '3d', three: view !== '2d' });

/** Mirrors the grid templates in styles.css: `1fr 1.08fr rail`, or one pane and the rail. */
function targetWidths(view: ViewMode, available: number) {
  if (view === 'split') return { plan: available / 2.08, three: (available * 1.08) / 2.08 };
  return view === '2d' ? { plan: available, three: 0 } : { plan: 0, three: available };
}

function usePaneLayout(view: ViewMode) {
  const workspace = useRef<HTMLElement>(null);
  const planPane = useRef<HTMLElement>(null);
  const threePane = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<PaneLayout>(() => ({ view, ...needs(view), freeze: {} }));
  const settled = useRef(view);

  useLayoutEffect(() => {
    if (settled.current === view) return;
    settled.current = view;
    const want = needs(view);
    const ws = workspace.current;
    const stacked = window.matchMedia('(max-width: 860px)').matches;
    if (!ws || stacked || prefersReducedMotion()) {
      setLayout({ view, ...want, freeze: {} });
      return;
    }

    const available = ws.clientWidth - (rail.current?.offsetWidth ?? 0);
    const target = targetWidths(view, available);
    const current = {
      plan: planPane.current?.offsetWidth ?? 0,
      three: threePane.current?.offsetWidth ?? 0,
    };
    setLayout((prev) => ({
      view,
      plan: prev.plan || want.plan,
      three: prev.three || want.three,
      freeze: {
        plan: want.plan ? target.plan : current.plan,
        three: want.three ? target.three : current.three,
      },
    }));
    const timer = window.setTimeout(
      () => setLayout({ view, ...want, freeze: {} }),
      DUR.med + 40,
    );
    return () => window.clearTimeout(timer);
  }, [view]);

  return { layout, refs: { workspace, planPane, threePane, rail } };
}

function frozenStyle(width: number | undefined) {
  return width === undefined ? undefined : { width: `${width}px` };
}

/** Everything behind the home screen. Stays mounted once opened, so the GPU pipeline survives a trip home. */
export default function Studio({ hidden }: { hidden: boolean }) {
  const view = useStore((s) => s.view);
  const { layout, refs } = usePaneLayout(view);

  return (
    <div className={`app ${hidden ? 'app-hidden' : ''}`} inert={hidden} aria-hidden={hidden || undefined}>
      <TopBar />
      <main ref={refs.workspace} className={`workspace workspace-${layout.view}`}>
        {layout.plan && (
          <section ref={refs.planPane} className="pane pane-plan">
            <div
              className={`pane-body ${layout.freeze.plan !== undefined ? 'pane-body-frozen' : ''}`}
              style={frozenStyle(layout.freeze.plan)}
            >
              <PlanEditor />
            </div>
          </section>
        )}
        {layout.three && (
          <section ref={refs.threePane} className="pane pane-3d">
            <div
              className={`pane-body ${layout.freeze.three !== undefined ? 'pane-body-frozen' : ''}`}
              style={frozenStyle(layout.freeze.three)}
            >
              <ViewportBoundary>
                <Suspense fallback={<ViewportLoading />}>
                  <Viewport />
                </Suspense>
              </ViewportBoundary>
            </div>
          </section>
        )}
        <aside ref={refs.rail} className="rail">
          <Inspector />
          <ProposalsPanel />
          <PlanCheckPanel />
          <MaterialPalette />
          <CostPanel />
          <SuggestionsPanel />
        </aside>
      </main>
      <Toast />
    </div>
  );
}
