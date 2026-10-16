import { PRICES, type DocType, type Entitlements, type Paise, type PlanId, type PlanPrice } from '@shared/business';
import { SEAT_ADDON_MONTHLY, STUDIO_INCLUDED_SEATS, entitlementsFor, entitlementsForProject } from '@shared/plans';
import { PLAN_LABEL } from '../state';
import { mailto } from '../../legal/business';

/**
 * The plan menu, shared by the public pricing page (`#/pricing`) and the
 * in-app Plans dialog. Prices come from `PRICES` and the comparison from
 * `entitlementsFor` — the same functions the Edge Functions enforce — so what
 * the page promises cannot drift from what the server grants.
 */

export type Interval = 'MONTH' | 'YEAR';

export interface Tier {
  plan: PlanId;
  tagline: string;
  /** Headline bullets on the card; the full comparison is `COMPARE`. */
  features: string[];
  /** Sales-led tiers have no checkout. */
  contact?: boolean;
}

/** Business is sales-led and not in PRICES (create-checkout refuses it). */
export const BUSINESS_FROM_MONTHLY: Paise = 14_99_900;

const STUDIO = entitlementsFor('STUDIO');

export const TIERS: Tier[] = [
  {
    plan: 'FREE',
    tagline: 'Plan, 3D, estimate and NBC checks — the whole design tool.',
    features: [
      `${entitlementsFor('FREE').maxActiveProjects} active projects`,
      'Quotations with client approval links',
      '“Made with 3xDezine” on every share',
      'Default rate card, editable per line',
      `${entitlementsFor('FREE').historyDays}-day history`,
    ],
  },
  {
    plan: 'PROJECT_PASS',
    tagline: 'One client, done properly — no subscription.',
    features: ['This project’s quotes unbranded, with your studio details', 'Every document type and the modular configurator', 'Client approval link', 'Valid 90 days'],
  },
  {
    plan: 'SOLO',
    tagline: 'For the independent designer quoting every week.',
    features: [
      'Unlimited projects',
      'Branded GST quotes and tax invoices',
      'Your own rate cards',
      'Modular kitchen & wardrobe configurator',
      'Variation orders after approval',
      `${entitlementsFor('SOLO').historyDays}-day history`,
    ],
  },
  {
    plan: 'STUDIO',
    tagline: 'A small team sharing one studio.',
    features: [
      'Everything in Solo',
      `${STUDIO.seats} seats with roles (+${rupees(SEAT_ADDON_MONTHLY)}/seat/month)`,
      'Shared rate cards and branding',
      'Unlimited history',
    ],
  },
  {
    plan: 'BUSINESS',
    tagline: 'White-label catalogue for dealers, brands and kitchen makers.',
    features: [`From ${rupees(BUSINESS_FROM_MONTHLY)}/month`, 'Your catalogue and rate packs', 'Sales-led onboarding'],
    contact: true,
  },
];

export const RANK: Record<PlanId, number> = { FREE: 0, PROJECT_PASS: 1, SOLO: 2, STUDIO: 3, BUSINESS: 4 };

/** ₹ with Indian grouping, whole rupees. Local so the public page needs no money engine. */
export function rupees(paise: Paise): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

export function priceOf(plan: PlanId, interval: Interval): PlanPrice | undefined {
  if (plan === 'PROJECT_PASS') return PRICES.find((p) => p.plan === plan);
  return PRICES.find((p) => p.plan === plan && p.interval === interval);
}

export function priceLine(plan: PlanId, interval: Interval): { amount: string; per: string } {
  if (plan === 'FREE') return { amount: '₹0', per: 'forever' };
  if (plan === 'BUSINESS') return { amount: rupees(BUSINESS_FROM_MONTHLY), per: 'from, per month' };
  const p = priceOf(plan, interval);
  if (!p) return { amount: '—', per: '' };
  const per = p.interval === 'ONE_TIME' ? 'per project, one-off' : p.interval === 'YEAR' ? 'per year' : 'per month';
  return { amount: rupees(p.amount), per };
}

/** What a year costs on monthly billing minus the yearly price; null if not sold both ways. */
export function yearlySaving(plan: PlanId): { amount: Paise; pct: number; monthsFree: number; perMonth: Paise } | null {
  const m = PRICES.find((p) => p.plan === plan && p.interval === 'MONTH');
  const y = PRICES.find((p) => p.plan === plan && p.interval === 'YEAR');
  if (!m || !y) return null;
  const amount = m.amount * 12 - y.amount;
  return { amount, pct: Math.round((amount / (m.amount * 12)) * 100), monthsFree: Math.round(amount / m.amount), perMonth: Math.round(y.amount / 12) };
}

/** "Yearly · 2 months free", from the smallest saving across plans, so it is never overstated. */
export function yearlyToggleLabel(): string {
  const months = Math.min(...(['SOLO', 'STUDIO'] as const).map((p) => yearlySaving(p)?.monthsFree ?? 0));
  return months > 0 ? `Yearly · ${months} months free` : 'Yearly';
}

// ---------------------------------------------------------------------------
// The comparison table — every cell is read from entitlementsFor.
// ---------------------------------------------------------------------------

export const COMPARE_PLANS: PlanId[] = ['FREE', 'PROJECT_PASS', 'SOLO', 'STUDIO', 'BUSINESS'];

/** Entitlements as the server computes them. A Project Pass is Free plus Solo features inside one project. */
export function entitlementsShown(plan: PlanId): Entitlements {
  if (plan === 'PROJECT_PASS') return entitlementsForProject(entitlementsFor('FREE', { passProjectIds: ['pass'] }), 'pass');
  return entitlementsFor(plan);
}

const DOC_SHORT: Record<DocType, string> = {
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma',
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  PLAIN_INVOICE: 'Invoice',
  VARIATION_ORDER: 'Variation order',
};

export type Cell = boolean | string;

export interface CompareRow {
  label: string;
  note?: string;
  value: (e: Entitlements, plan: PlanId) => Cell;
}

export const COMPARE: CompareRow[] = [
  {
    label: 'Active cloud projects',
    value: (e, plan) =>
      e.maxActiveProjects === null ? 'Unlimited' : plan === 'PROJECT_PASS' ? `${e.maxActiveProjects} (the pass unlocks one)` : String(e.maxActiveProjects),
  },
  { label: 'Floor plans, 3D, live estimate, NBC checks', value: () => true },
  { label: 'Quotations with a client approval link', value: (e) => e.clientApprovals },
  { label: 'Your branding — no “Made with 3xDezine” mark', value: (e) => e.brandedQuotes },
  {
    label: 'Documents',
    note: 'Tax invoices and bills of supply as your own GST registration allows.',
    value: (e) => e.docTypes.filter((d) => d !== 'VARIATION_ORDER').map((d) => DOC_SHORT[d]).join(', '),
  },
  { label: 'Saved rate cards', value: (e) => e.rateCards },
  { label: 'Modular kitchen & wardrobe configurator', value: (e) => e.modular },
  { label: 'Variation orders after approval', value: (e) => e.variationOrders },
  {
    label: 'Seats',
    value: (e) => (e.seats >= STUDIO_INCLUDED_SEATS ? `${e.seats} included, +${rupees(SEAT_ADDON_MONTHLY)}/seat/mo` : String(e.seats)),
  },
  { label: 'Version history', value: (e) => (e.historyDays === null ? 'Unlimited' : `${e.historyDays} days`) },
  { label: 'White-label catalogue', note: 'Sales-led.', value: (_e, plan) => plan === 'BUSINESS' },
];

// ---------------------------------------------------------------------------
// CTAs without a backend
// ---------------------------------------------------------------------------

/** "Notify me" / "Talk to us": a mailto with the plan in the subject. */
export function planMailto(plan: PlanId, interval: Interval): string {
  const label = PLAN_LABEL[plan];
  if (plan === 'BUSINESS') {
    return mailto(`3xDezine Business — enquiry`, 'Company:\nWhat you sell (catalogue, kitchens, materials…):\nCity:\nPhone (optional):\n');
  }
  const iv = plan === 'PROJECT_PASS' ? '' : interval === 'YEAR' ? ' (yearly)' : ' (monthly)';
  return mailto(`3xDezine ${label}${iv} — notify me`, `Please let me know when ${label} is available to buy.\n\nName:\nStudio / city:\n`);
}
