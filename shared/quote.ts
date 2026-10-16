/**
 * 3xDezine — quotation builder.
 *
 * One pure function turns the plan + editable lines into a complete document:
 * quantities re-derived from geometry, lines priced, grouped room-wise or
 * trade-wise, numbered stably, design fee, discount, GST by place of supply
 * and HSN/SAC bucket, round-off, amount in words and milestones. The web
 * client runs it on every edit; the server re-runs it before saving so the two
 * can never disagree about a total.
 *
 * Money is integer paise; each value is rounded once, half away from zero.
 */

import type {
  DocType,
  PaymentMilestone,
  QuotationDocument,
  QuoteDraftInput,
  QuoteLine,
  TaxLine,
  Trade,
  TradeLineItem,
  Paise,
} from './business.js';
import { allowedDocTypes, chargesGst, compositionDeclaration, financialYear, hsnDigits, placeOfSupply, SAC, splitTax } from './gst.js';
import { amountInWords, assertPaise, divRoundBig, pctOf, roundHalfAway, toSqft } from './money.js';
import { polygonArea } from './cost.js';
import { priceModular } from './modular.js';
import { applyOverrides, priceLine, quantifyLine } from './trades.js';
import type { Project } from './types.js';

/** Section order for TRADE_WISE (the template sellers' order, §2.1, with the extra trades placed by kind). */
export const TRADE_ORDER: Trade[] = [
  'CIVIL', 'WATERPROOFING', 'FALSE_CEILING', 'ELECTRICAL', 'PLUMBING', 'FLOORING', 'PAINTING',
  'CARPENTRY', 'MODULAR_KITCHEN', 'WARDROBE', 'GLASS_METAL', 'LOOSE_FURNITURE', 'LIGHTING',
  'APPLIANCES', 'SANITARY', 'DECOR', 'DESIGN_FEE', 'MISC',
];

export const TRADE_TITLES: Record<Trade, string> = {
  CIVIL: 'Civil & demolition', WATERPROOFING: 'Waterproofing', FALSE_CEILING: 'False ceiling',
  ELECTRICAL: 'Electrical', PLUMBING: 'Plumbing', FLOORING: 'Flooring & tiling', PAINTING: 'Painting & wall finishes',
  CARPENTRY: 'Carpentry & woodwork', MODULAR_KITCHEN: 'Modular kitchen', WARDROBE: 'Wardrobes & storage',
  GLASS_METAL: 'Glass & metal', LOOSE_FURNITURE: 'Loose furniture', LIGHTING: 'Lighting', APPLIANCES: 'Appliances',
  SANITARY: 'CP & sanitary', DECOR: 'Decor & furnishings', DESIGN_FEE: 'Design', MISC: 'Miscellaneous',
};

export const WHOLE_HOUSE_SECTION_ID = 'house';
export const WHOLE_HOUSE_TITLE = 'Whole house';

/** Trade of a quote line; modular kitchens → MODULAR_KITCHEN, wardrobes → WARDROBE, other joinery → CARPENTRY. */
export function lineTrade(line: QuoteLine): Trade {
  if (line.kind === 'TRADE') return line.trade;
  if (line.item.type === 'KITCHEN') return 'MODULAR_KITCHEN';
  if (line.item.type === 'WARDROBE') return 'WARDROBE';
  return 'CARPENTRY';
}

/** Wraps auto-seeded trade lines as quote lines. */
export function toQuoteLines(items: TradeLineItem[]): QuoteLine[] {
  return items.map((l) => ({ kind: 'TRADE' as const, ...l }));
}

const addDays = (iso: string, days: number): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`issueDate must be an ISO date, got '${iso}'`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

function roomOrder(project: Project): Array<{ id: string; name: string }> {
  return project.floors.flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: r.name })));
}

/**
 * Builds the document. `existing` carries identity and history across
 * versions: id, version, number, status, supersedesId, amendsId, approvals,
 * lockedAt, projectVersion — and its line numbers, so a line keeps its
 * "3.04" for as long as it stays in the same section.
 *
 * Throws for impossible states: doc type not allowed for the supplier's
 * registration, milestones not summing to 100%, a composition supplier on an
 * inter-state job, a discount larger than the subtotal, a unit that does not
 * fit its quantity rule. Missing exclusions are only a warning.
 */
export function buildQuote(input: QuoteDraftInput, existing?: Partial<QuotationDocument>): QuotationDocument {
  const { project, studio } = input;
  const warnings: string[] = [];

  // --- Validation ---------------------------------------------------------
  const allowed = allowedDocTypes(studio.gstRegistration);
  if (!allowed.includes(input.docType)) {
    throw new Error(`A ${studio.gstRegistration.toLowerCase()} supplier cannot issue a ${input.docType}; allowed: ${allowed.join(', ')}`);
  }
  if (!input.milestones.length) throw new Error('Payment milestones are required and must sum to 100%');
  const pctSum = input.milestones.reduce((s, m) => s + m.pct, 0);
  if (Math.abs(pctSum - 100) > 1e-9) throw new Error(`Payment milestones sum to ${roundHalfAway(pctSum, 4)}%, not 100%`);
  for (const m of input.milestones) if (!(m.pct > 0)) throw new Error(`Milestone '${m.label}' must have a positive percentage`);
  if (!Number.isInteger(input.validityDays) || input.validityDays < 0) throw new Error('validityDays must be a whole number ≥ 0');
  const pos = placeOfSupply(studio, input.siteAddress);
  if (studio.gstRegistration === 'COMPOSITION' && pos.isInterState) {
    throw new Error(`A composition supplier cannot make an inter-state supply (CGST Act s.10(2)(c) / s.10(2A)); site is in ${pos.stateName}`);
  }
  if (!input.exclusions.length) warnings.push('No exclusions listed — missing exclusions are the most common root of disputes');
  if (!input.makeList.length) warnings.push('No make list — brand-less lines invite spec substitution');
  if (input.overrides) applyOverrides(input.rateCard, input.overrides); // validates the base card

  // --- Lines: quantify and price -----------------------------------------
  const rooms = roomOrder(project);
  const roomIds = new Set(rooms.map((r) => r.id));
  const ids = new Set<string>();
  const priced: QuoteLine[] = input.lines.map((line) => {
    if (ids.has(line.id)) throw new Error(`Duplicate line id '${line.id}'`);
    ids.add(line.id);
    if (line.kind === 'MODULAR') {
      if (!roomIds.has(line.roomId)) warnings.push(`'${line.description}' is in a room that is no longer in the plan`);
      const breakdown = priceModular(line.item, undefined, project);
      for (const w of breakdown.warnings) warnings.push(`${line.description}: ${w}`);
      return { ...line, breakdown, amount: breakdown.total };
    }
    let q: { quantityBase: number; quantityDisplay: number; formula: string };
    if (line.roomId !== undefined && !roomIds.has(line.roomId)) {
      warnings.push(`'${line.description}' is in a room that is no longer in the plan`);
      q = line.rule.kind === 'MANUAL' || line.rule.kind === 'FIXED'
        ? quantifyLine({ ...line, roomId: undefined }, project)
        : { quantityBase: 0, quantityDisplay: 0, formula: 'Room removed from the plan' };
    } else {
      q = quantifyLine(line, project);
    }
    const next: { kind: 'TRADE' } & TradeLineItem = { ...line, quantityBase: q.quantityBase, quantityDisplay: q.quantityDisplay, formula: q.formula };
    next.amount = priceLine(next);
    return next;
  });

  // --- Sections -----------------------------------------------------------
  type Group = { id: string; title: string; lines: QuoteLine[] };
  const groups: Group[] = [];
  if (input.view === 'ROOM_WISE') {
    for (const r of rooms) groups.push({ id: `room:${r.id}`, title: r.name, lines: [] });
    groups.push({ id: WHOLE_HOUSE_SECTION_ID, title: WHOLE_HOUSE_TITLE, lines: [] });
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const l of priced) {
      const rid = l.roomId;
      (rid !== undefined && byId.get(`room:${rid}`) || byId.get(WHOLE_HOUSE_SECTION_ID)!).lines.push(l);
    }
  } else {
    for (const t of TRADE_ORDER) groups.push({ id: `trade:${t}`, title: TRADE_TITLES[t], lines: [] });
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const l of priced) byId.get(`trade:${lineTrade(l)}`)!.lines.push(l);
  }
  const used = groups.filter((g) => g.lines.length);

  // Section numbers: kept from `existing` (same view, same section id), new sections after the highest.
  const prevSeq = new Map<string, number>();
  const prevLineNo = new Map<string, string>();
  // Numbers only carry over within the same view: a room-wise "3.04" means nothing trade-wise.
  const sameView = existing?.sections && existing.view === input.view;
  if (sameView) {
    for (const s of existing!.sections!) {
      for (const l of s.lines) if (l.lineNo) prevLineNo.set(l.id, l.lineNo);
      const n = Number(s.lines.find((l) => l.lineNo)?.lineNo.split('.')[0]);
      if (Number.isInteger(n) && n > 0) prevSeq.set(s.id, n);
    }
  }
  let nextSeq = Math.max(0, ...prevSeq.values());
  const seqOf = new Map<string, number>();
  if (prevSeq.size) {
    for (const g of used) seqOf.set(g.id, prevSeq.get(g.id) ?? ++nextSeq);
  } else {
    used.forEach((g, i) => seqOf.set(g.id, i + 1));
  }

  const sections: QuotationDocument['sections'] = used.map((g) => {
    const seq = seqOf.get(g.id)!;
    const prefix = `${seq}.`;
    const taken = new Set<number>();
    const keep = new Map<string, string>();
    for (const l of g.lines) {
      const candidate = existing ? prevLineNo.get(l.id) : l.lineNo || undefined;
      if (!candidate?.startsWith(prefix)) continue;
      const n = Number(candidate.slice(prefix.length));
      if (!Number.isInteger(n) || n <= 0 || taken.has(n)) continue;
      taken.add(n);
      keep.set(l.id, candidate);
    }
    // Numbers used in the previous version of this section are not reused for new lines.
    for (const s of sameView ? existing!.sections! : []) {
      for (const l of s.lines) if (l.lineNo?.startsWith(prefix)) taken.add(Number(l.lineNo.slice(prefix.length)));
    }
    let n = Math.max(0, ...[...taken].filter(Number.isFinite));
    const lines = g.lines.map((l) => ({ ...l, lineNo: keep.get(l.id) ?? `${prefix}${String(++n).padStart(2, '0')}` }));
    const subtotal = lines.reduce((s, l) => s + (l.optional ? 0 : l.amount), 0);
    return { id: g.id, title: g.title, lines, subtotal };
  });

  // --- Fee, discount, taxable value --------------------------------------
  const preFee = sections.reduce((s, x) => s + x.subtotal, 0);
  let designFee: QuotationDocument['designFee'];
  if (input.designFee) {
    const { basis, value } = input.designFee;
    if (!(value >= 0)) throw new Error('Design fee value must be ≥ 0');
    let amount: Paise;
    if (basis === 'PCT_OF_PROJECT') amount = pctOf(preFee, value);
    else if (basis === 'PER_SQFT') {
      const sqft = input.areaBasis?.sqft ?? roundHalfAway(toSqft(project.floors.reduce((s, f) => s + f.rooms.reduce((t, r) => t + polygonArea(r.polygon), 0), 0)), 2);
      amount = Number(divRoundBig(BigInt(roundHalfAway(sqft * 100)) * BigInt(roundHalfAway(value)), 100n));
    } else {
      amount = roundHalfAway(value);
    }
    designFee = { basis, value, amount, sac: SAC.DESIGN, gstRatePct: 18 };
  }
  const gross = preFee + (designFee?.amount ?? 0);
  let discount = input.discount;
  if (discount) {
    assertPaise(discount.amount, 'discount');
    if (discount.amount < 0) throw new Error('Discount must be ≥ 0');
    if (discount.amount > gross) throw new Error(`Discount ${discount.amount} exceeds the subtotal ${gross}`);
    if (discount.amount === 0) discount = undefined;
  }
  const taxableValue = gross - (discount?.amount ?? 0);

  // --- Tax ----------------------------------------------------------------
  const taxLines: TaxLine[] = [];
  if (chargesGst(studio.gstRegistration, input.docType)) {
    const buckets = new Map<string, { hsnSac: string; ratePct: number; value: Paise }>();
    const add = (code: string, rate: number, value: Paise) => {
      const hsn = hsnDigits(code, studio.turnoverAbove5Cr);
      const key = `${hsn}|${rate}`;
      const b = buckets.get(key) ?? { hsnSac: hsn, ratePct: rate, value: 0 };
      b.value += value;
      buckets.set(key, b);
    };
    for (const s of sections) for (const l of s.lines) if (!l.optional) add(l.hsnSac, l.gstRatePct, l.amount);
    if (designFee) add(designFee.sac, designFee.gstRatePct, designFee.amount);
    const list = [...buckets.values()].filter((b) => b.value !== 0).sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.ratePct - b.ratePct);
    const shares = allocate(discount?.amount ?? 0, list.map((b) => b.value));
    list.forEach((b, i) => {
      const taxable = b.value - shares[i];
      const t = splitTax(taxable, b.ratePct, pos.isInterState);
      taxLines.push({ hsnSac: b.hsnSac, taxableValue: taxable, ratePct: b.ratePct, cgst: t.cgst, sgst: t.sgst, igst: t.igst });
    });
  }
  const totalTax = taxLines.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0);

  // --- Round-off, grand total, milestones ---------------------------------
  const preRound = taxableValue + totalTax;
  const grandTotal = roundHalfAway(preRound / 100) * 100;
  const roundOff = grandTotal - preRound;

  const paymentSchedule: PaymentMilestone[] = [];
  let allotted = 0;
  input.milestones.forEach((m, i) => {
    const last = i === input.milestones.length - 1;
    const amount = last ? grandTotal - allotted : roundHalfAway(pctOf(grandTotal, m.pct) / 100) * 100;
    allotted += amount;
    paymentSchedule.push({ id: `m${i + 1}`, label: m.label, pct: m.pct, amount, trigger: m.trigger });
  });

  const issueDate = input.issueDate;
  const doc: QuotationDocument = {
    id: existing?.id ?? '',
    projectId: project.id ?? existing?.projectId ?? '',
    docType: input.docType,
    ...(existing?.number ? { number: existing.number } : {}),
    version: existing?.version ?? 1,
    ...(existing?.supersedesId ? { supersedesId: existing.supersedesId } : {}),
    ...(existing?.amendsId ? { amendsId: existing.amendsId } : {}),
    status: existing?.status ?? 'DRAFT',
    issueDate,
    validUntil: addDays(issueDate, input.validityDays),
    financialYear: financialYear(issueDate),
    supplier: studio,
    recipient: input.recipient,
    siteAddress: input.siteAddress,
    placeOfSupplyStateCode: pos.stateCode,
    isInterState: pos.isInterState,
    ...(input.areaBasis ? { areaBasis: input.areaBasis } : {}),
    view: input.view,
    sections,
    ...(designFee ? { designFee } : {}),
    ...(discount ? { discount } : {}),
    taxableValue,
    taxLines,
    totalTax,
    roundOff,
    grandTotal,
    amountInWords: amountInWords(grandTotal),
    paymentSchedule,
    makeList: input.makeList,
    inclusions: input.inclusions,
    exclusions: input.exclusions,
    terms: input.terms,
    ...(studio.gstRegistration === 'COMPOSITION' ? { compositionDeclaration } : {}),
    ...(existing?.projectVersion !== undefined ? { projectVersion: existing.projectVersion } : {}),
    approvals: existing?.approvals ?? [],
    ...(existing?.lockedAt ? { lockedAt: existing.lockedAt } : {}),
    watermark: input.watermark,
    ...(warnings.length ? { warnings } : {}),
  };
  return doc;
}

/** Splits `total` across `weights` pro rata, largest remainder first, so the parts sum exactly. */
export function allocate(total: Paise, weights: Paise[]): Paise[] {
  if (!total || !weights.length) return weights.map(() => 0);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error('Cannot allocate across non-positive weights');
  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w) => (T * BigInt(w)) / S);
  const rem = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S }));
  let left = T - parts.reduce((s, p) => s + p, 0n);
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rem) {
    if (left <= 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return parts.map(Number);
}

// ---------------------------------------------------------------------------
// Canonical JSON and hashing
// ---------------------------------------------------------------------------

/**
 * Top-level fields left out of the hash. `approvals`, `status`, `lockedAt`
 * and `hash` change AFTER the client sees the document (approving must not
 * change what was approved); `warnings` are advisory. Everything else —
 * including `number`, `issueDate`, `version` and every line — is content.
 */
export const HASH_EXCLUDED_FIELDS = ['approvals', 'status', 'lockedAt', 'hash', 'warnings'] as const;

function canon(v: unknown): unknown {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
    return Object.is(v, -0) ? 0 : v;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/** Stable JSON: keys sorted at every level, undefined dropped, HASH_EXCLUDED_FIELDS removed at the top. */
export function canonicalJson(doc: Partial<QuotationDocument>): string {
  const top: Record<string, unknown> = { ...doc };
  for (const k of HASH_EXCLUDED_FIELDS) delete top[k];
  return JSON.stringify(canon(top));
}

type Subtle = { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> };

/** SHA-256 hex of canonicalJson(doc), via Web Crypto (Node 22, browsers, Deno). */
export async function hashQuote(doc: Partial<QuotationDocument>): Promise<string> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: Subtle } }).crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) is not available');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(doc)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export const DOC_TYPE_LETTERS: Record<DocType, string> = {
  QUOTATION: 'Q', PROFORMA: 'PI', TAX_INVOICE: 'TI', BILL_OF_SUPPLY: 'BS', PLAIN_INVOICE: 'IN', VARIATION_ORDER: 'VO',
};

/**
 * Next document number: '<PREFIX>/<letters>/<yy-yy>/<seq 4+ digits>', e.g.
 * 'SS/Q/26-27/0042'. A separate series per doc type and FY (Rule 46(b):
 * consecutive, unique per FY, ≤ 16 characters of letters, digits, '-' and '/').
 * The prefix is upper-cased and stripped to A–Z0–9, then shortened if needed
 * to keep the number within 16 characters; only a sequence above 9999 with
 * long letters can still exceed it.
 */
export function nextQuoteNumber(prefix: string, docType: DocType, fy: string, lastSeq: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Financial year must look like '2026-27', got '${fy}'`);
  if (!Number.isInteger(lastSeq) || lastSeq < 0) throw new Error('lastSeq must be a whole number ≥ 0');
  const fyShort = `${m[1].slice(2)}-${m[2]}`;
  const tail = `${DOC_TYPE_LETTERS[docType]}/${fyShort}/${String(lastSeq + 1).padStart(4, '0')}`;
  let p = (prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = 16 - tail.length - 1;
  if (p.length > room) p = p.slice(0, Math.max(0, room));
  return p ? `${p}/${tail}` : tail;
}

// ---------------------------------------------------------------------------
// Diff (for variation orders)
// ---------------------------------------------------------------------------

export interface LineChange {
  id: string;
  lineNo: string;
  description: string;
  fields: string[];
  before: Paise;
  after: Paise;
  delta: Paise;
}

export interface QuoteDiff {
  added: Array<{ id: string; lineNo: string; description: string; amount: Paise }>;
  removed: Array<{ id: string; lineNo: string; description: string; amount: Paise }>;
  changed: LineChange[];
  /** Change in Σ non-optional line amounts. */
  linesDelta: Paise;
  taxableDelta: Paise;
  taxDelta: Paise;
  totalDelta: Paise;
}

const COMPARED: Array<keyof TradeLineItem> = [
  'description', 'unit', 'quantityDisplay', 'materialRate', 'labourRate', 'markupPct', 'discountPct',
  'hsnSac', 'gstRatePct', 'clientSupplied', 'optional', 'roomId', 'trade', 'spec',
];

const effective = (l: QuoteLine) => (l.optional ? 0 : l.amount);

/** What changed from `a` (e.g. the approved quote) to `b` (the proposed revision), matched by line id. */
export function diffQuotes(a: QuotationDocument, b: QuotationDocument): QuoteDiff {
  const linesOf = (d: QuotationDocument) => new Map(d.sections.flatMap((s) => s.lines).map((l) => [l.id, l]));
  const A = linesOf(a);
  const B = linesOf(b);
  const out: QuoteDiff = { added: [], removed: [], changed: [], linesDelta: 0, taxableDelta: b.taxableValue - a.taxableValue, taxDelta: b.totalTax - a.totalTax, totalDelta: b.grandTotal - a.grandTotal };
  for (const [id, l] of B) {
    const prev = A.get(id);
    if (!prev) { out.added.push({ id, lineNo: l.lineNo, description: l.description, amount: effective(l) }); continue; }
    const fields: string[] = [];
    if (l.kind !== prev.kind) fields.push('kind');
    else if (l.kind === 'TRADE' && prev.kind === 'TRADE') {
      for (const f of COMPARED) if (JSON.stringify(canon(l[f])) !== JSON.stringify(canon(prev[f]))) fields.push(f);
    } else if (l.kind === 'MODULAR' && prev.kind === 'MODULAR') {
      if (l.description !== prev.description) fields.push('description');
      if (JSON.stringify(canon(l.item)) !== JSON.stringify(canon(prev.item))) fields.push('item');
      if (l.optional !== prev.optional) fields.push('optional');
    }
    if (l.amount !== prev.amount && !fields.includes('amount')) fields.push('amount');
    if (fields.length) out.changed.push({ id, lineNo: l.lineNo, description: l.description, fields, before: effective(prev), after: effective(l), delta: effective(l) - effective(prev) });
  }
  for (const [id, l] of A) if (!B.has(id)) out.removed.push({ id, lineNo: l.lineNo, description: l.description, amount: effective(l) });
  out.linesDelta = out.added.reduce((s, x) => s + x.amount, 0) - out.removed.reduce((s, x) => s + x.amount, 0) + out.changed.reduce((s, x) => s + x.delta, 0);
  return out;
}
