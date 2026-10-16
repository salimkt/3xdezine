/**
 * Every business identifier the public pages print — one place to change them.
 *
 * Read by the pricing page, the legal pages (Terms, Privacy, Refunds, Contact,
 * About, Delivery) and the pricing dialog. Lazy chunks only: nothing here is
 * in the first paint.
 *
 * RULE: never invent an identifier. A value we don't have yet is `null`, and
 * the pages render it as "To be added" — a reviewer (Razorpay, a lawyer, a
 * customer) must be able to see what is missing rather than read a fake.
 */

export interface GrievanceOfficer {
  name: string;
  /** Usually the owner for a sole operator; a named role once there is a team. */
  designation: string;
  email: string;
  phone: string | null;
}

export interface BusinessIdentity {
  productName: string;
  /** The legal person the customer contracts with. */
  legalEntity: string;
  /** The individual behind a sole-proprietor operation. */
  operator: string;
  /** Public contact for support, billing, sales and legal notices. */
  email: string;
  phone: string | null;
  /** Registered / principal place of business, one string as it should print. */
  address: string | null;
  /** 15-character GSTIN once registered. */
  gstin: string | null;
  grievanceOfficer: GrievanceOfficer;
  /** City whose courts have jurisdiction under the Terms (e.g. 'Kozhikode', 'Bengaluru'). */
  jurisdictionCity: string | null;
  /** Where the cloud database lives once the Supabase project exists, e.g. 'Mumbai, India (AWS ap-south-1)'. */
  dataRegion: string | null;
  /** The deployed web app. */
  website: string;
  /** Commitments the pages make; owner's decision, kept here so they change in one place. */
  supportReplyDays: number;
  grievanceAckHours: number;
  grievanceResolveDays: number;
}

export const BUSINESS: BusinessIdentity = {
  productName: '3xDezine',
  legalEntity: '3xDezine (operated by Muhammed Salim K T)',
  operator: 'Muhammed Salim K T',
  // CONFIRM: already public on the owner's GitHub profile. Swap for a domain
  // address (e.g. support@…) once one exists — it is used everywhere from here.
  email: 'mohdsalimkt@gmail.com',
  phone: null, // To be added — never invent one.
  address: null, // To be added — Razorpay checks this against KYC.
  gstin: null, // To be added once GST-registered; see GST_REGISTERED below.
  grievanceOfficer: {
    name: 'Muhammed Salim K T', // CONFIRM
    designation: 'Founder and Grievance Officer',
    email: 'mohdsalimkt@gmail.com', // CONFIRM
    phone: null,
  },
  jurisdictionCity: null, // CONFIRM with a lawyer: usually the city of the registered address.
  dataRegion: null, // Fill in when the Supabase project is created (Mumbai is the plan).
  website: 'https://salimkt.github.io/3xdezine/',
  supportReplyDays: 2,
  grievanceAckHours: 48,
  grievanceResolveDays: 30,
};

/**
 * Flip to true on the day 3xDezine has a GSTIN. Every price line and note on
 * the pricing page and dialog switches from "excludes GST" to "+ 18% GST".
 * The server adds GST at checkout independently — keep the two in step.
 */
export const GST_REGISTERED = false;
export const GST_RATE_PCT = 18;

/** Short suffix after a price. */
export function gstSuffix(): string {
  return GST_REGISTERED ? `+ ${GST_RATE_PCT}% GST` : 'excl. GST';
}

/** The one-sentence note under every price list. */
export function gstNote(): string {
  return GST_REGISTERED
    ? `Prices exclude GST. ${GST_RATE_PCT}% GST is added at checkout, and you receive a GST tax invoice.`
    : `Prices exclude GST. GST at ${GST_RATE_PCT}% will be added once 3xDezine is GST-registered.`;
}

/** Shown on every legal page until a lawyer has signed them off. */
export const LEGAL_DRAFT = true;
export const LEGAL_LAST_UPDATED = '16 October 2026';

export const TO_BE_ADDED = 'To be added';

export function orTbd(value: string | null): string {
  return value ?? TO_BE_ADDED;
}

/** A `mailto:` with a subject and optional body — no form service, no backend. */
export function mailto(subject: string, body?: string, to: string = BUSINESS.email): string {
  const q = [`subject=${encodeURIComponent(subject)}`];
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}?${q.join('&')}`;
}
