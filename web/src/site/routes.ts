/**
 * Public pages — pricing and the legal/business pages — as hash routes
 * (`#/pricing`, `#/terms` …), so a shared link works under the GitHub Pages
 * base path with no server rewrites. This file is in the shell; the pages
 * themselves are lazy chunks (see SiteRoot) and load neither three.js nor
 * supabase-js.
 */

export const SITE_ROUTES = ['pricing', 'terms', 'privacy', 'refunds', 'contact', 'about', 'delivery'] as const;
export type SiteRoute = (typeof SITE_ROUTES)[number];

/** What the footer links to, in order. Delivery is linked from Terms/Refunds/Pricing. */
export const FOOTER_LINKS: Array<[SiteRoute, string]> = [
  ['pricing', 'Pricing'],
  ['terms', 'Terms'],
  ['privacy', 'Privacy'],
  ['refunds', 'Refunds'],
  ['contact', 'Contact'],
  ['about', 'About'],
];

const ROUTE_RE = new RegExp(`^#/(${SITE_ROUTES.join('|')})/?$`);

export function siteRouteFromUrl(): SiteRoute | null {
  if (typeof location === 'undefined') return null;
  const m = ROUTE_RE.exec(location.hash);
  return m ? (m[1] as SiteRoute) : null;
}

/** Absolute URL, for links that open a page in a new tab (studio, approval page). */
export function siteUrl(route: SiteRoute): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/${route}`;
}
