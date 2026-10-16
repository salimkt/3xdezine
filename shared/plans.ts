/**
 * 3xDezine — plans and entitlements, per docs/strategy.md "Pricing".
 *
 * Enforced server-side (the Edge Functions call these); the web client uses
 * the same functions only to decide what to show.
 */

import type { DocType, Entitlements, GstRegistration, Paise, PlanId, PlanPrice } from './business.js';
import { PRICES } from './business.js';
import { allowedDocTypes } from './gst.js';

/** Every document type; a paid plan may issue whichever the studio's GST registration allows. */
export const ALL_DOC_TYPES: DocType[] = ['QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE', 'VARIATION_ORDER'];

/** Studio includes 3 seats; extra seats are ₹599/seat/month (strategy.md). Not in PRICES (it is a quantity add-on). */
export const STUDIO_INCLUDED_SEATS = 3;
export const SEAT_ADDON_MONTHLY: Paise = 59_900;

export interface EntitlementOptions {
  /** Projects unlocked by Project Pass purchases (each ₹499, one-off). */
  passProjectIds?: string[];
  /** STUDIO / BUSINESS: TOTAL seats on the subscription (never fewer than the 3 included). */
  seats?: number;
  /** End of the paid period; ignored for FREE. */
  periodEnd?: string | null;
}

const FREE: Omit<Entitlements, 'passProjectIds' | 'currentPeriodEnd'> = {
  plan: 'FREE',
  maxActiveProjects: 2,
  brandedQuotes: false,
  docTypes: ['QUOTATION'],
  clientApprovals: true,
  rateCards: false,
  modular: false,
  variationOrders: false,
  seats: 1,
  historyDays: 7,
};

/** Solo-level features — what a paid plan, or a Project Pass project, gets. */
const SOLO_FEATURES = {
  brandedQuotes: true,
  docTypes: ALL_DOC_TYPES,
  rateCards: true,
  modular: true,
  variationOrders: true,
  historyDays: 90 as number | null,
};

/**
 * Account entitlements.
 *  - FREE: 2 active projects, watermarked quotations only, approvals, default
 *    rate card, no modular, no VOs, 1 seat, 7-day history.
 *  - PROJECT_PASS is not a plan of its own: it returns FREE (plan 'FREE') with
 *    the pass project ids; use `entitlementsForProject` for a given project.
 *  - SOLO: unlimited projects, branded quotes, every doc type the GST
 *    registration allows, rate cards, modular, VOs, 1 seat, 90-day history.
 *  - STUDIO: Solo + 3 seats (or more if bought) and unlimited history.
 *  - BUSINESS: as STUDIO (white-label is sales-led, later).
 * Pass ids are kept on paid plans too, so a downgrade does not lose them.
 */
export function entitlementsFor(plan: PlanId, opts: EntitlementOptions = {}): Entitlements {
  const passProjectIds = [...new Set(opts.passProjectIds ?? [])].sort();
  if (plan === 'FREE' || plan === 'PROJECT_PASS') {
    return { ...FREE, docTypes: [...FREE.docTypes], passProjectIds, currentPeriodEnd: null };
  }
  const base: Entitlements = {
    ...FREE,
    ...SOLO_FEATURES,
    docTypes: [...ALL_DOC_TYPES],
    plan,
    maxActiveProjects: null,
    passProjectIds,
    currentPeriodEnd: opts.periodEnd ?? null,
  };
  if (plan === 'SOLO') return base;
  return { ...base, seats: Math.max(STUDIO_INCLUDED_SEATS, Math.floor(opts.seats ?? STUDIO_INCLUDED_SEATS)), historyDays: null };
}

/**
 * Entitlements that apply inside one project: on FREE, a Project Pass project
 * gets Solo-level features (branded, all doc types, rate cards, modular, VOs,
 * 90-day history) for that project only. Otherwise unchanged.
 */
export function entitlementsForProject(ent: Entitlements, projectId: string): Entitlements {
  if (ent.plan !== 'FREE' || !ent.passProjectIds.includes(projectId)) return ent;
  return { ...ent, ...SOLO_FEATURES, docTypes: [...ALL_DOC_TYPES] };
}

/** Doc types actually issuable: the plan's list ∩ what the GST registration allows. */
export function issuableDocTypes(ent: Entitlements, registration: GstRegistration): DocType[] {
  const allowed = allowedDocTypes(registration);
  return ent.docTypes.filter((d) => allowed.includes(d) && (d !== 'VARIATION_ORDER' || ent.variationOrders));
}

/** The price for a plan and interval from PRICES; undefined when it is not sold that way (FREE, BUSINESS). */
export function priceFor(plan: PlanId, interval: PlanPrice['interval']): PlanPrice | undefined {
  return PRICES.find((p) => p.plan === plan && p.interval === interval);
}
