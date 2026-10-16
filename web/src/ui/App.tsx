import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCatalog } from '../lib/api';
import { MobileGate } from './AndroidApp';
import { HomeScreen } from './HomeScreen';
import { CLOUD_ENABLED } from '../cloud/state';
import { quoteTokenFromUrl, useBiz } from '../business/state';
import { siteRouteFromUrl } from '../site/routes';

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

/** Studio settings, rate card and plans dialogs; a chunk of their own, loaded on first open. */
const BizDialogs = lazy(() => import('../business/BizDialogs'));

/**
 * The client approval page (`#/q/<token>`): a homeowner on a phone, often on
 * mobile data. It renders alone — no studio prefetch, no catalogue fetch, no
 * cloud SDK, and three.js only if they tap "View in 3D".
 */
const ApprovalPage = lazy(() => import('../business/approval/ApprovalPage'));

/**
 * Public pages (`#/pricing`, `#/terms`, `#/privacy`, `#/refunds`, `#/contact`,
 * `#/about`, `#/delivery`): readable signed out, on a phone, by a payment
 * gateway's reviewer. Like the approval page they render alone — no studio
 * prefetch, no three.js, no supabase-js.
 */
const SiteRoot = lazy(() => import('../site/SiteRoot'));

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
  const [quoteToken, setQuoteToken] = useState(quoteTokenFromUrl);
  const [siteRoute, setSiteRoute] = useState(siteRouteFromUrl);
  useEffect(() => {
    const onHash = () => {
      setQuoteToken(quoteTokenFromUrl());
      setSiteRoute(siteRouteFromUrl());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (siteRoute) {
    return (
      <Suspense fallback={<div className="site-boot" role="status"><div className="spinner" /></div>}>
        <SiteRoot route={siteRoute} />
      </Suspense>
    );
  }
  if (quoteToken) {
    return (
      <Suspense fallback={<div className="approval-boot" role="status"><div className="spinner" /></div>}>
        <ApprovalPage token={quoteToken} />
      </Suspense>
    );
  }
  return <StudioApp />;
}

function StudioApp() {
  const bizDialog = useBiz((s) => s.dialog);
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
      {bizDialog && (
        <Suspense fallback={null}>
          <BizDialogs />
        </Suspense>
      )}
      {CLOUD_ENABLED && (
        <Suspense fallback={null}>
          <CloudRoot />
        </Suspense>
      )}
    </>
  );
}
