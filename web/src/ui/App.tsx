import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCatalog } from '../lib/api';
import { MobileGate } from './AndroidApp';
import { HomeScreen } from './HomeScreen';
import { CLOUD_ENABLED } from '../cloud/state';

/** Sign-in, sharing and sync UI; never requested when cloud isn't configured. */
const CloudRoot = lazy(() => import('../cloud/ui/shell').then((m) => ({ default: m.CloudRoot })));

/**
 * The shell: home screen, mobile landing and catalogue fetch. The studio (plan
 * editor, rail, renderer) is a separate chunk so the first paint carries none
 * of three.js — and it is prefetched as soon as the home screen is idle, so
 * choosing a tile rarely waits on the network.
 */
const loadStudio = () => import('./Studio');
const Studio = lazy(loadStudio);
const loadViewport = () => import('../three/Viewport');

function whenIdle(callback: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(callback, { timeout: 2500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 600);
  return () => window.clearTimeout(id);
}

function StudioLoading() {
  return (
    <div className="studio-loading" role="status">
      <div className="spinner" />
      <span>Opening the studio…</span>
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const projectName = useStore((s) => s.project.name);
  const setCatalog = useStore((s) => s.setCatalog);
  // Once opened the studio stays mounted behind the home screen: its WebGPU
  // device and compiled post stack are seconds of work to rebuild.
  const [studioMounted, setStudioMounted] = useState(screen === 'studio');

  useEffect(() => {
    if (screen === 'studio') setStudioMounted(true);
  }, [screen]);

  // Prefer the served catalog when the backend is up; fall back silently to the
  // bundled seed, which is the same file the backend seeds from.
  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        if (catalog?.materials?.length) setCatalog(catalog);
      })
      .catch(() => undefined);
  }, [setCatalog]);

  useEffect(
    () =>
      whenIdle(() => {
        loadStudio().catch(() => undefined);
        loadViewport().catch(() => undefined);
      }),
    [],
  );

  return (
    <>
      <MobileGate projectName={projectName} />
      {studioMounted && (
        <Suspense fallback={<StudioLoading />}>
          <Studio hidden={screen !== 'studio'} />
        </Suspense>
      )}
      {screen === 'home' && <HomeScreen />}
      {CLOUD_ENABLED && (
        <Suspense fallback={null}>
          <CloudRoot />
        </Suspense>
      )}
    </>
  );
}
