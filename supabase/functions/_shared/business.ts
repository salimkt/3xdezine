/**
 * Studios, rate cards, entitlements and quotations: the server side of
 * shared/business.ts. Every money/GST/quote computation is delegated to the
 * shared engines in ./domain (generated copies of shared/), never re-done here.
 */
import type {
  Address, DocType, Entitlements, Party, PlanId, QuotationDocument, QuoteDraftInput, RateCard,
  RateCardEntry, RateCardOverrides, StudioProfile, SaveQuoteDraftRequest,
} from './domain/business.ts';
import type { Project } from './domain/types.ts';
import { entitlementsFor, entitlementsForProject, issuableDocTypes as planIssuable } from './domain/plans.ts';
import { gstState, validateGstin } from './domain/gst.ts';
import defaultRateCard from './domain/ratecards/metro-mid-2026.ts';
import { admin } from './auth.ts';
import { forbidden, invalid, notFound } from './http.ts';
import type { ProjectRow } from './project.ts';

// ---------------------------------------------------------------------------
// Small validators
// ---------------------------------------------------------------------------

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function text(v: unknown, what: string, max: number, opts: { optional?: boolean; min?: number } = {}): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return undefined;
    throw invalid(`${what} is required.`);
  }
  if (typeof v !== 'string') throw invalid(`${what} must be text.`);
  const t = v.trim();
  if (!t && !opts.optional) throw invalid(`${what} can’t be empty.`);
  if (t.length > max) throw invalid(`${what} is too long (max ${max} characters).`);
  if (opts.min && t.length < opts.min) throw invalid(`${what} is too short.`);
  return t || undefined;
}

function stringList(v: unknown, what: string, maxItems: number, maxLen: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItems) throw invalid(`${what} must be a list of at most ${maxItems} items.`);
  return v.map((s, i) => text(s, `${what} #${i + 1}`, maxLen)!);
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Today's date in India (ISO yyyy-mm-dd) — documents are dated in IST. */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

const PIN = /^[1-9][0-9]{5}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function parseAddress(v: unknown, what = 'The address'): Address {
  if (!isObj(v)) throw invalid(`${what} is required.`);
  const stateCode = text(v.stateCode, `${what}: state code`, 2)!;
  if (!/^[0-9]{2}$/.test(stateCode) || !gstState(stateCode)) throw invalid(`${what}: state code must be a 2-digit GST state code (e.g. 27 for Maharashtra).`);
  const pin = text(v.pin, `${what}: PIN code`, 6)!;
  if (!PIN.test(pin)) throw invalid(`${what}: PIN code must be 6 digits.`);
  return {
    line1: text(v.line1, `${what}: line 1`, 200)!,
    ...(text(v.line2, `${what}: line 2`, 200, { optional: true }) ? { line2: text(v.line2, '', 200)! } : {}),
    city: text(v.city, `${what}: city`, 100)!,
    pin,
    stateName: text(v.stateName, `${what}: state`, 60)!,
    stateCode,
  };
}

function gstinResult(gstin: string): { ok: boolean; message?: string } {
  const r = validateGstin(gstin) as unknown;
  if (typeof r === 'boolean') return { ok: r };
  if (isObj(r)) {
    const ok = (r.ok ?? r.valid) as boolean | undefined;
    const message = (r.message ?? r.error ?? r.reason) as string | undefined;
    return { ok: Boolean(ok), message };
  }
  return { ok: false };
}

export function parseParty(v: unknown, what = 'The client'): Party {
  if (!isObj(v)) throw invalid(`${what} details are required.`);
  const gstin = text(v.gstin, `${what}: GSTIN`, 15, { optional: true })?.toUpperCase();
  if (gstin) {
    const g = gstinResult(gstin);
    if (!g.ok) throw invalid(`${what}: GSTIN ${gstin} is not valid${g.message ? ` — ${g.message}` : ''}.`);
  }
  const pan = text(v.pan, `${what}: PAN`, 10, { optional: true })?.toUpperCase();
  if (pan && !PAN.test(pan)) throw invalid(`${what}: PAN must look like ABCDE1234F.`);
  const email = text(v.email, `${what}: email`, 200, { optional: true });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid(`${what}: email address is not valid.`);
  const phone = text(v.phone, `${what}: phone`, 20, { optional: true });
  if (phone && !/^\+?[0-9 ()-]{6,20}$/.test(phone)) throw invalid(`${what}: phone number is not valid.`);
  const tradeName = text(v.tradeName, `${what}: trade name`, 200, { optional: true });
  return {
    legalName: text(v.legalName, `${what}: name`, 200)!,
    ...(tradeName ? { tradeName } : {}),
    address: parseAddress(v.address, `${what}’s address`),
    ...(gstin ? { gstin } : {}),
    ...(pan ? { pan } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
}

// ---------------------------------------------------------------------------
// Studio profile
// ---------------------------------------------------------------------------

export const MAX_LOGO_BYTES = 64 * 1024;
const LOGO = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
/** Prefix + '/Q/26-27/0042' must stay within GST Rule 46's 16 characters. */
export const PREFIX = /^[A-Z0-9]{1,4}$/;

export function parseStudio(v: unknown): Omit<StudioProfile, 'id'> {
  if (!isObj(v)) throw invalid('`studio` must be a studio profile.');
  const party = parseParty(v, 'The studio');
  const reg = v.gstRegistration;
  if (reg !== 'REGULAR' && reg !== 'COMPOSITION' && reg !== 'UNREGISTERED') {
    throw invalid('`gstRegistration` must be REGULAR, COMPOSITION or UNREGISTERED.');
  }
  if (reg !== 'UNREGISTERED' && !party.gstin) throw invalid('A GST-registered studio needs its GSTIN.');
  if (reg === 'UNREGISTERED' && party.gstin) throw invalid('Remove the GSTIN or set the registration to Regular or Composition.');
  if (party.gstin) {
    if (party.gstin.slice(0, 2) !== party.address.stateCode) {
      throw invalid(`The GSTIN is registered in state ${party.gstin.slice(0, 2)}, but the studio address is in state ${party.address.stateCode} (${party.address.stateName}).`);
    }
    if (party.pan && party.gstin.slice(2, 12) !== party.pan) throw invalid('The PAN does not match the PAN inside the GSTIN.');
  }
  if (typeof v.turnoverAbove5Cr !== 'boolean') throw invalid('`turnoverAbove5Cr` must be true or false.');

  let logoDataUrl: string | undefined;
  if (v.logoDataUrl !== undefined && v.logoDataUrl !== null && v.logoDataUrl !== '') {
    if (typeof v.logoDataUrl !== 'string') throw invalid('The logo must be a data URL.');
    const m = LOGO.exec(v.logoDataUrl);
    if (!m) throw invalid('The logo must be a PNG, JPEG or SVG image (base64 data URL).');
    const b64 = m[2];
    const bytes = (b64.length * 3) / 4 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (bytes > MAX_LOGO_BYTES) throw invalid(`The logo is ${Math.ceil(bytes / 1024)} KB; the limit is 64 KB.`);
    if (m[1] === 'svg+xml') {
      const svg = atob(b64);
      if (/<script|on[a-z]+\s*=|javascript:|<foreignObject/i.test(svg)) throw invalid('SVG logos may not contain scripts or event handlers.');
    }
    logoDataUrl = v.logoDataUrl;
  }
  const brandColorHex = text(v.brandColorHex, 'Brand colour', 7, { optional: true });
  if (brandColorHex && !/^#[0-9A-Fa-f]{6}$/.test(brandColorHex)) throw invalid('Brand colour must look like #1A2B3C.');

  let bank: StudioProfile['bank'];
  if (v.bank !== undefined && v.bank !== null) {
    if (!isObj(v.bank)) throw invalid('Bank details are malformed.');
    const accountNo = text(v.bank.accountNo, 'Bank account number', 18)!;
    if (!/^[0-9]{9,18}$/.test(accountNo)) throw invalid('Bank account number must be 9–18 digits.');
    const ifsc = text(v.bank.ifsc, 'IFSC', 11)!.toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw invalid('IFSC must look like HDFC0001234.');
    const upiId = text(v.bank.upiId, 'UPI id', 100, { optional: true });
    if (upiId && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/.test(upiId)) throw invalid('UPI id must look like name@bank.');
    bank = { accountName: text(v.bank.accountName, 'Bank account name', 200)!, accountNo, ifsc, ...(upiId ? { upiId } : {}) };
  }

  const defaultTerms = stringList(v.defaultTerms, 'Terms', 50, 1000);
  if (!Array.isArray(v.defaultMilestones ?? [])) throw invalid('`defaultMilestones` must be a list.');
  const ms = (v.defaultMilestones ?? []) as unknown[];
  if (ms.length > 12) throw invalid('At most 12 payment milestones.');
  const defaultMilestones = ms.map((m, i) => {
    if (!isObj(m) || typeof m.pct !== 'number' || !(m.pct > 0 && m.pct <= 100)) throw invalid(`Milestone #${i + 1} needs a percentage between 0 and 100.`);
    return { label: text(m.label, `Milestone #${i + 1}`, 80)!, pct: m.pct };
  });
  if (defaultMilestones.length && Math.abs(defaultMilestones.reduce((s, m) => s + m.pct, 0) - 100) > 1e-6) {
    throw invalid('Payment milestones must add up to 100%.');
  }
  const numberPrefix = text(v.numberPrefix, 'Number prefix', 4)!.toUpperCase();
  if (!PREFIX.test(numberPrefix)) throw invalid('The number prefix must be 1–4 letters or digits (e.g. SS), so numbers stay within 16 characters.');

  return {
    ...party,
    gstRegistration: reg,
    turnoverAbove5Cr: v.turnoverAbove5Cr,
    ...(logoDataUrl ? { logoDataUrl } : {}),
    ...(brandColorHex ? { brandColorHex: brandColorHex.toUpperCase() } : {}),
    ...(bank ? { bank } : {}),
    defaultTerms,
    defaultMilestones,
    numberPrefix,
  };
}

export interface StudioRow {
  id: string;
  owner_id: string;
  profile: Omit<StudioProfile, 'id'>;
  created_at: string;
  updated_at: string;
}

export const toStudio = (row: StudioRow): StudioProfile => ({ ...row.profile, id: row.id });

export async function loadStudio(id: string): Promise<StudioRow | undefined> {
  const { data, error } = await admin().from('studios').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as StudioRow | null) ?? undefined;
}

export async function ownedStudio(userId: string): Promise<StudioRow | undefined> {
  const { data, error } = await admin().from('studios').select('*').eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  return (data as StudioRow | null) ?? undefined;
}

export async function studioRole(studio: StudioRow, userId: string): Promise<'OWNER' | 'MEMBER' | undefined> {
  if (studio.owner_id === userId) return 'OWNER';
  const { data, error } = await admin().from('studio_members').select('role').eq('studio_id', studio.id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data?.role as 'OWNER' | 'MEMBER' | undefined) ?? undefined;
}

/** The studio a project quotes as: its own studio_id, else the project owner's studio. */
export async function studioForProject(project: ProjectRow & { studio_id?: string | null }): Promise<StudioRow> {
  const studio = project.studio_id ? await loadStudio(project.studio_id) : await ownedStudio(project.owner_id);
  if (!studio) throw invalid('The project owner needs to set up a studio profile before quoting.');
  return studio;
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

export const RATE_CARDS: Record<string, RateCard> = { [defaultRateCard.id]: defaultRateCard };
export const DEFAULT_RATE_CARD = defaultRateCard;

const GST_RATES = [0, 0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];
const UNITS = ['SQFT', 'SQM', 'RFT', 'RMT', 'POINT', 'NOS', 'SET', 'LS'];
const TRADES = [
  'CIVIL', 'WATERPROOFING', 'FALSE_CEILING', 'ELECTRICAL', 'PLUMBING', 'FLOORING', 'PAINTING', 'CARPENTRY',
  'MODULAR_KITCHEN', 'WARDROBE', 'GLASS_METAL', 'LOOSE_FURNITURE', 'LIGHTING', 'APPLIANCES', 'SANITARY', 'DECOR',
  'DESIGN_FEE', 'MISC',
];
const RULE_KINDS = ['FLOOR_AREA', 'CEILING_AREA', 'WALL_AREA', 'PERIMETER', 'COUNT_OPENINGS', 'POINTS_PER_ROOM', 'FIXED', 'MANUAL'];
const MAX_RATE = 1_00_00_000_00; // ₹1 crore per unit, in paise

function rate(v: unknown, what: string): number {
  if (!isInt(v) || v < 0 || v > MAX_RATE) throw invalid(`${what} must be a whole number of paise between 0 and ₹1 crore.`);
  return v;
}
function hsn(v: unknown, what: string): string {
  if (typeof v !== 'string' || !/^[0-9]{4,8}$/.test(v)) throw invalid(`${what} must be a 4–8 digit HSN/SAC code.`);
  return v;
}
function gstRate(v: unknown, what: string): number {
  if (typeof v !== 'number' || !GST_RATES.includes(v)) throw invalid(`${what} must be one of ${GST_RATES.join(', ')}%.`);
  return v;
}

function parseAddedEntry(v: unknown, i: number): RateCardEntry {
  const what = `Added rate #${i + 1}`;
  if (!isObj(v)) throw invalid(`${what} is malformed.`);
  const id = text(v.id, `${what}: id`, 60)!;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw invalid(`${what}: id may only contain letters, digits, dot, dash and underscore.`);
  if (!TRADES.includes(v.trade as string)) throw invalid(`${what}: unknown trade.`);
  if (!UNITS.includes(v.unit as string)) throw invalid(`${what}: unknown unit.`);
  if (!['GOODS', 'SERVICE', 'WORKS_CONTRACT'].includes(v.supplyNature as string)) throw invalid(`${what}: unknown supply nature.`);
  if (!isObj(v.defaultRule) || !RULE_KINDS.includes(v.defaultRule.kind as string)) throw invalid(`${what}: unknown quantity rule.`);
  if (!isObj(v.source)) throw invalid(`${what}: needs a source.`);
  rate(v.materialRate, `${what}: material rate`);
  rate(v.labourRate, `${what}: labour rate`);
  hsn(v.hsnSac, `${what}: HSN/SAC`);
  gstRate(v.gstRatePct, `${what}: GST rate`);
  text(v.description, `${what}: description`, 500);
  return v as unknown as RateCardEntry;
}

export function parseOverrides(v: unknown): RateCardOverrides {
  if (!isObj(v)) throw invalid('`overrides` must be a rate-card overrides object.');
  if (JSON.stringify(v).length > 500_000) throw invalid('These rate-card changes are too large (over 500 KB).');
  const baseCardId = text(v.baseCardId, '`baseCardId`', 100)!;
  const card = RATE_CARDS[baseCardId];
  if (!card) throw invalid(`Unknown base rate card “${baseCardId}”.`);
  const known = new Set(card.entries.map((e) => e.id));
  if (!isObj(v.overrides)) throw invalid('`overrides.overrides` must be an object keyed by rate id.');
  const overrides: RateCardOverrides['overrides'] = {};
  for (const [id, o] of Object.entries(v.overrides)) {
    if (!known.has(id)) throw invalid(`Unknown rate id “${id}” in ${card.name}.`);
    if (!isObj(o)) throw invalid(`Override for ${id} is malformed.`);
    const allowed = ['materialRate', 'labourRate', 'description', 'makeList', 'hsnSac', 'gstRatePct'];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) throw invalid(`Override for ${id}: “${k}” can’t be changed.`);
    overrides[id] = {
      ...(o.materialRate !== undefined ? { materialRate: rate(o.materialRate, `${id}: material rate`) } : {}),
      ...(o.labourRate !== undefined ? { labourRate: rate(o.labourRate, `${id}: labour rate`) } : {}),
      ...(o.description !== undefined ? { description: text(o.description, `${id}: description`, 500)! } : {}),
      ...(o.makeList !== undefined ? { makeList: stringList(o.makeList, `${id}: make list`, 30, 100) } : {}),
      ...(o.hsnSac !== undefined ? { hsnSac: hsn(o.hsnSac, `${id}: HSN/SAC`) } : {}),
      ...(o.gstRatePct !== undefined ? { gstRatePct: gstRate(o.gstRatePct, `${id}: GST rate`) } : {}),
    };
  }
  if (!Array.isArray(v.added ?? []) || ((v.added ?? []) as unknown[]).length > 500) throw invalid('`added` must be a list of at most 500 rates.');
  const added = ((v.added ?? []) as unknown[]).map(parseAddedEntry);
  const ids = new Set<string>();
  for (const e of added) {
    if (known.has(e.id) || ids.has(e.id)) throw invalid(`Added rate id “${e.id}” is already used.`);
    ids.add(e.id);
  }
  const disabled = stringList(v.disabled, '`disabled`', 1000, 60);
  for (const id of disabled) if (!known.has(id) && !ids.has(id)) throw invalid(`Can’t disable unknown rate “${id}”.`);
  return { baseCardId, overrides, added, disabled };
}

export async function loadOverrides(studioId: string): Promise<RateCardOverrides | undefined> {
  const { data, error } = await admin().from('rate_overrides').select('overrides').eq('studio_id', studioId).maybeSingle();
  if (error) throw error;
  return (data?.overrides as RateCardOverrides | undefined) ?? undefined;
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/** Subscription states that still grant the plan (until current_period_end). */
const LIVE = new Set(['ACTIVE', 'AUTHENTICATED', 'PENDING', 'CANCELLED']);
const RANK: Record<PlanId, number> = { FREE: 0, PROJECT_PASS: 0, SOLO: 1, STUDIO: 2, BUSINESS: 3 };

interface SubRow { user_id: string; plan: PlanId; status: string; current_period_end: string | null; seats: number }

function liveSub(s: SubRow, now: number): boolean {
  if (!LIVE.has(s.status)) return false;
  if (!s.current_period_end) return s.status === 'ACTIVE';
  return new Date(s.current_period_end).getTime() > now;
}

/**
 * The account's entitlements: its own best live subscription, or — for a
 * seat in someone's studio — that studio owner's STUDIO/BUSINESS plan, plus
 * unexpired Project Passes.
 */
export async function entitlementsOf(userId: string): Promise<Entitlements> {
  const db = admin();
  const now = Date.now();
  const { data: memberships, error: mErr } = await db.from('studio_members').select('studio_id, studios!inner(owner_id)').eq('user_id', userId);
  if (mErr) throw mErr;
  const studioOwners = (memberships ?? [])
    .map((m) => (m as unknown as { studios: { owner_id: string } }).studios.owner_id)
    .filter((id) => id !== userId);

  const { data: subs, error } = await db
    .from('subscriptions')
    .select('user_id, plan, status, current_period_end, seats')
    .in('user_id', [userId, ...studioOwners]);
  if (error) throw error;
  let best: SubRow | undefined;
  for (const s of (subs ?? []) as SubRow[]) {
    if (!liveSub(s, now)) continue;
    // Inherited only for team plans.
    if (s.user_id !== userId && RANK[s.plan] < RANK.STUDIO) continue;
    if (!best || RANK[s.plan] > RANK[best.plan]) best = s;
  }

  const { data: passes, error: pErr } = await db
    .from('project_passes')
    .select('project_id, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date(now).toISOString());
  if (pErr) throw pErr;
  const passProjectIds = [...new Set((passes ?? []).map((p) => p.project_id as string))];

  const plan: PlanId = best?.plan ?? (passProjectIds.length ? 'PROJECT_PASS' : 'FREE');
  return entitlementsFor(plan, {
    passProjectIds,
    periodEnd: best?.current_period_end ?? null,
    ...(best ? { seats: best.seats } : {}),
  });
}

/** Entitlements that apply to one project (Project Pass unlocks branding there only). */
export function forProject(ent: Entitlements, projectId: string): Entitlements {
  return entitlementsForProject(ent, projectId);
}

export function planName(plan: PlanId): string {
  return { FREE: 'Free', PROJECT_PASS: 'Project Pass', SOLO: 'Solo', STUDIO: 'Studio', BUSINESS: 'Business' }[plan];
}

/** Doc types this studio may issue on this plan: plan ∩ what its GST registration allows. */
export function issuableDocTypes(ent: Entitlements, studio: StudioProfile): DocType[] {
  return planIssuable(ent, studio.gstRegistration);
}

// ---------------------------------------------------------------------------
// Quote rows and draft input
// ---------------------------------------------------------------------------

export interface QuoteRow {
  id: string;
  project_id: string;
  studio_id: string;
  created_by: string | null;
  doc_type: DocType;
  number: string | null;
  financial_year: string | null;
  version: number;
  supersedes_id: string | null;
  amends_id: string | null;
  status: QuotationDocument['status'];
  data: QuotationDocument;
  input: DraftInput;
  project_data: Project | null;
  diff: unknown;
  hash: string | null;
  issued_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DraftInput = SaveQuoteDraftRequest['input'];

export async function loadQuote(id: string): Promise<QuoteRow | undefined> {
  const { data, error } = await admin().from('quotes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as QuoteRow | null) ?? undefined;
}

const DOC_TYPES: DocType[] = ['QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE', 'VARIATION_ORDER'];
const TRIGGERS = ['ON_SIGNING', 'ON_APPROVAL', 'ON_DELIVERY', 'ON_HANDOVER'];

/**
 * Shape-checks the editable draft input. Totals, amounts and tax in the input
 * are ignored — buildQuote recomputes everything. Client-sent `overrides` are
 * dropped: the studio's stored overrides apply.
 */
export function parseDraftInput(v: unknown): DraftInput {
  if (!isObj(v)) throw invalid('`input` must be the quote draft input.');
  if (JSON.stringify(v).length > 2_000_000) throw invalid('This quote is too large (over 2 MB).');
  const docType = v.docType as DocType;
  if (!DOC_TYPES.includes(docType)) throw invalid(`\`docType\` must be one of ${DOC_TYPES.join(', ')}.`);
  if (v.view !== 'ROOM_WISE' && v.view !== 'TRADE_WISE') throw invalid('`view` must be ROOM_WISE or TRADE_WISE.');
  if (!Array.isArray(v.lines) || v.lines.length > 2000) throw invalid('`lines` must be a list of at most 2000 lines.');
  for (const [i, l] of (v.lines as unknown[]).entries()) {
    if (!isObj(l) || (l.kind !== 'TRADE' && l.kind !== 'MODULAR') || typeof l.id !== 'string') throw invalid(`Line #${i + 1} is malformed.`);
  }
  if (!Array.isArray(v.milestones) || v.milestones.length > 12) throw invalid('`milestones` must be a list of at most 12.');
  for (const [i, m] of (v.milestones as unknown[]).entries()) {
    if (!isObj(m) || typeof m.pct !== 'number' || !(m.pct >= 0 && m.pct <= 100) || !TRIGGERS.includes(m.trigger as string)) {
      throw invalid(`Milestone #${i + 1} is malformed.`);
    }
    text(m.label, `Milestone #${i + 1}`, 80);
  }
  const issueDate = text(v.issueDate, '`issueDate`', 10)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || Number.isNaN(Date.parse(issueDate))) throw invalid('`issueDate` must be an ISO date (yyyy-mm-dd).');
  if (!isInt(v.validityDays) || v.validityDays < 1 || v.validityDays > 365) throw invalid('`validityDays` must be 1–365.');
  if (!Array.isArray(v.makeList ?? [])) throw invalid('`makeList` must be a list.');
  const { overrides: _ignored, ...rest } = v;
  return {
    ...(rest as unknown as DraftInput),
    recipient: parseParty(v.recipient, 'The client'),
    siteAddress: parseAddress(v.siteAddress, 'The site address'),
    inclusions: stringList(v.inclusions, 'Inclusions', 200, 1000),
    exclusions: stringList(v.exclusions, 'Exclusions', 200, 1000),
    terms: stringList(v.terms, 'Terms', 100, 2000),
    issueDate,
  };
}

export function hasModularLines(input: DraftInput): boolean {
  return input.lines.some((l) => l.kind === 'MODULAR');
}

/** Strips what a quote's public page must not show about the project. */
export function publicProject(p: Project): Project {
  const { proposals: _p, policy: _q, ...rest } = p as Project & Record<string, unknown>;
  return rest as Project;
}

/** Free-tier documents carry no studio branding. */
export function supplierSnapshot(studio: StudioProfile, branded: boolean): StudioProfile {
  if (branded) return structuredClone(studio);
  const { logoDataUrl: _l, brandColorHex: _b, ...rest } = studio;
  return structuredClone(rest);
}

export type BuildInput = QuoteDraftInput;

export { notFound, forbidden };
