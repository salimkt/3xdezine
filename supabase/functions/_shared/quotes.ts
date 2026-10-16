/**
 * Building quotation documents on the server. The client sends only the
 * editable input; the document — quantities from the stored plan, rates from
 * the studio's card, GST split, totals, words — is always recomputed here with
 * the shared engine (shared/quote.ts buildQuote). Client totals are never read.
 */
import type { DocType, Entitlements, QuotationDocument, RateCard } from './domain/business.ts';
import { buildQuote } from './domain/quote.ts';
import { forbidden, invalid } from './http.ts';
import { rank, type Access, type ProjectRow } from './project.ts';
import {
  DEFAULT_RATE_CARD, RATE_CARDS, hasModularLines, issuableDocTypes, loadOverrides, planName, supplierSnapshot, toStudio,
  type DraftInput, type StudioRow,
} from './business.ts';

export function requireQuoteEditor(a: Access): void {
  if (rank(a.level) < rank('FINISHES')) throw forbidden('You can view this project but not prepare quotes for it. Ask the owner for edit access.');
}

const DOC_LABEL: Record<DocType, string> = {
  QUOTATION: 'quotations',
  PROFORMA: 'proforma invoices',
  TAX_INVOICE: 'tax invoices',
  BILL_OF_SUPPLY: 'bills of supply',
  PLAIN_INVOICE: 'invoices',
  VARIATION_ORDER: 'variation orders',
};

/** Feature gates that apply to drafting as well as issuing. */
export function requireFeatures(ent: Entitlements, input: DraftInput): void {
  if (hasModularLines(input) && !ent.modular) {
    throw forbidden(`The modular kitchen and wardrobe configurator is part of Solo and Studio. You’re on ${planName(ent.plan)} — upgrade to add modular lines.`);
  }
  if (input.docType === 'VARIATION_ORDER' && !ent.variationOrders) {
    throw forbidden(`Variation orders are part of Solo and Studio. You’re on ${planName(ent.plan)} — upgrade to amend approved quotes.`);
  }
}

/** Issue-time gate: plan's doc types ∩ what the studio's GST registration allows. */
export function requireIssuable(ent: Entitlements, studio: StudioRow, docType: DocType): void {
  const profile = toStudio(studio);
  if (!ent.docTypes.includes(docType)) {
    const can = ent.docTypes.map((d) => DOC_LABEL[d]).join(', ') || 'nothing';
    throw forbidden(`The ${planName(ent.plan)} plan can issue ${can}. Upgrade to Solo to issue ${DOC_LABEL[docType]}.`);
  }
  if (!issuableDocTypes(ent, profile).includes(docType)) {
    const reg = profile.gstRegistration === 'UNREGISTERED' ? 'A studio without GST registration' : `A ${profile.gstRegistration.toLowerCase()}-scheme studio`;
    throw forbidden(`${reg} can’t issue ${DOC_LABEL[docType]}. Update the studio’s GST registration if it has changed.`);
  }
}

/**
 * Runs buildQuote against the stored plan, the studio (branding stripped when
 * not entitled), the base rate card and — on plans with rate cards — the
 * studio's stored overrides.
 */
export async function buildDocument(opts: {
  project: ProjectRow;
  studio: StudioRow;
  ent: Entitlements;
  input: DraftInput;
  existing?: QuotationDocument;
}): Promise<QuotationDocument> {
  const { project, studio, ent, input, existing } = opts;
  const overrides = ent.rateCards ? await loadOverrides(studio.id) : undefined;
  const rateCard = (overrides && RATE_CARDS[overrides.baseCardId]) || DEFAULT_RATE_CARD;
  const branded = ent.brandedQuotes;
  try {
    return buildQuote(
    {
      ...input,
      lines: ent.rateCards ? input.lines : withCardRates(input.lines, rateCard),
      project: project.data,
      rateCard,
      ...(overrides ? { overrides } : {}),
      studio: supplierSnapshot(toStudio(studio), branded),
      watermark: !branded,
    },
    existing,
  );
  } catch (err) {
    // The engine throws plain Errors for impossible inputs (milestones not
    // summing to 100%, composition supplier inter-state, doc type vs GST
    // registration, discount over subtotal…). Those are the caller's to fix.
    if (err instanceof Error && !(err instanceof TypeError) && !(err instanceof RangeError)) throw invalid(err.message);
    throw err;
  }
}

/** Server-owned fields of a document, whatever the engine or client produced. */
export function finalize(doc: QuotationDocument, f: {
  id: string;
  projectId: string;
  version: number;
  supersedesId?: string | null;
  amendsId?: string | null;
  projectVersion: number;
}): QuotationDocument {
  const out: QuotationDocument = { ...doc, id: f.id, projectId: f.projectId, version: f.version, status: 'DRAFT', approvals: [], projectVersion: f.projectVersion };
  delete out.number;
  delete out.hash;
  delete out.lockedAt;
  delete out.supersedesId;
  delete out.amendsId;
  if (f.supersedesId) out.supersedesId = f.supersedesId;
  if (f.amendsId) out.amendsId = f.amendsId;
  return out;
}

/**
 * Without the `rateCards` entitlement, lines that cite a rate-card entry are
 * priced at that entry's rates (and HSN/SAC, GST rate) whatever the client
 * sent — "default rate card only" on Free.
 */
function withCardRates(lines: DraftInput['lines'], card: RateCard): DraftInput['lines'] {
  const byId = new Map(card.entries.map((e) => [e.id, e]));
  return lines.map((l) => {
    if (l.kind !== 'TRADE' || !l.rateCardEntryId) return l;
    const e = byId.get(l.rateCardEntryId);
    if (!e) return l;
    return { ...l, materialRate: e.materialRate, labourRate: e.labourRate, hsnSac: e.hsnSac, gstRatePct: e.gstRatePct, supplyNature: e.supplyNature };
  });
}
