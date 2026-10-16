import { FOOTER_LINKS, siteUrl } from './routes';

/**
 * Pricing · Terms · Privacy · Refunds · Contact · About — on the home screen,
 * the mobile landing, every public page and (compact, new tab) the client
 * approval page. Lives in the shell, so it stays tiny.
 */
export function SiteFooter({ compact = false, newTab = false }: { compact?: boolean; newTab?: boolean }) {
  return (
    <footer className={compact ? 'site-foot site-foot-compact' : 'site-foot'}>
      <nav aria-label="3xDezine">
        {FOOTER_LINKS.map(([route, label]) => (
          <a key={route} href={newTab ? siteUrl(route) : `#/${route}`} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>
            {label}
          </a>
        ))}
      </nav>
      <small>© 2026 3xDezine</small>
    </footer>
  );
}
