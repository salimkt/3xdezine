import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import type { SiteRoute } from './routes';
import { SiteFooter } from './SiteFooter';
import './site.css';

/**
 * Layout for the public pages: a light header, the page, the footer. Each page
 * is its own chunk; this one carries only the frame, so a shared link to
 * `#/privacy` downloads the frame plus the privacy text and nothing else.
 */

const PAGES: Record<SiteRoute, LazyExoticComponent<ComponentType>> = {
  pricing: lazy(() => import('./pages/PricingPage')),
  terms: lazy(() => import('./pages/Terms')),
  privacy: lazy(() => import('./pages/Privacy')),
  refunds: lazy(() => import('./pages/Refunds')),
  contact: lazy(() => import('./pages/Contact')),
  about: lazy(() => import('./pages/About')),
  delivery: lazy(() => import('./pages/Delivery')),
};

const TITLES: Record<SiteRoute, string> = {
  pricing: 'Pricing',
  terms: 'Terms and Conditions',
  privacy: 'Privacy Policy',
  refunds: 'Cancellation and Refund Policy',
  contact: 'Contact us',
  about: 'About',
  delivery: 'Delivery Policy',
};

const NAV: Array<[SiteRoute, string]> = [
  ['pricing', 'Pricing'],
  ['about', 'About'],
  ['contact', 'Contact'],
];

export default function SiteRoot({ route }: { route: SiteRoute }) {
  const scroller = useRef<HTMLDivElement>(null);
  const Page = PAGES[route];

  useEffect(() => {
    const previous = document.title;
    document.title = `${TITLES[route]} · 3xDezine`;
    scroller.current?.scrollTo({ top: 0 });
    return () => {
      document.title = previous;
    };
  }, [route]);

  return (
    <div className="site" ref={scroller}>
      <header className="site-top">
        <a className="brand site-brand" href="#/" aria-label="3xDezine home">
          <span className="brand-mark">3×</span>
          <span className="brand-text">Dezine</span>
        </a>
        <nav className="site-nav" aria-label="Site">
          {NAV.map(([r, label]) => (
            <a key={r} href={`#/${r}`} aria-current={r === route ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <a className="btn btn-primary site-open" href="#/">
          Open the studio
        </a>
      </header>
      <main className="site-main">
        <Suspense fallback={<div className="site-loading" role="status"><div className="spinner" /></div>}>
          <Page />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
