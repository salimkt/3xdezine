import { Component, type ReactNode, useEffect } from 'react';
import { useStore } from '../store';
import { getCatalog } from '../lib/api';
import { Viewport } from '../three/Viewport';
import { PlanEditor } from './PlanEditor';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { MaterialPalette } from './MaterialPalette';
import { CostPanel } from './CostPanel';
import { SuggestionsPanel } from './SuggestionsPanel';

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
        <div className="viewport-fallback viewport-error">
          <strong>3D viewport unavailable</strong>
          <span>{this.state.error.message}</span>
          <span className="dim">
            The plan, materials and cost estimate below keep working.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const view = useStore((s) => s.view);
  const setCatalog = useStore((s) => s.setCatalog);

  // Prefer the served catalog when the backend is up; fall back silently to the
  // bundled seed, which is the same file the backend seeds from.
  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        if (catalog?.materials?.length) setCatalog(catalog);
      })
      .catch(() => undefined);
  }, [setCatalog]);

  return (
    <div className="app">
      <TopBar />
      <main className={`workspace workspace-${view}`}>
        {view !== '3d' && (
          <section className="pane pane-plan">
            <PlanEditor />
          </section>
        )}
        {view !== '2d' && (
          <section className="pane pane-3d">
            <ViewportBoundary>
              <Viewport />
            </ViewportBoundary>
          </section>
        )}
        <aside className="rail">
          <Inspector />
          <MaterialPalette />
          <CostPanel />
          <SuggestionsPanel />
        </aside>
      </main>
    </div>
  );
}
