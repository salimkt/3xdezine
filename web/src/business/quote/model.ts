import type {
  DocType,
  Entitlements,
  ModularItem,
  QuotationDocument,
  QuoteDraftInput,
  QuoteLine,
  RateCard,
  RateCardEntry,
  RateCardOverrides,
  StudioProfile,
  Trade,
  TradeLineItem,
} from '@shared/business';
import type { Catalog, Project } from '@shared/types';
import { applyOverrides, autoLines, lineFromEntry, priceLine, quantifyLine } from '@shared/trades';
import { buildQuote } from '@shared/quote';
import { priceModular } from '@shared/modular';
import { entitlementsFor, entitlementsForProject, issuableDocTypes as planDocTypes } from '@shared/plans';
import defaultCardJson from '@shared/ratecards/metro-mid-2026.json';
import { polygonArea } from '../../lib/planMath';
import { getCloudOverrides } from '../api';
import { useBiz } from '../state';
import { DEFAULT_EXCLUSIONS, DEFAULT_INCLUSIONS, EMPTY_PARTY, milestonesFromStudio, normaliseStudio } from '../defaults';
import type { QuoteDraft } from '../workspace';
import { toSqft } from '../engines';

/**
 * Pure glue between the quote builder UI and the shared engines: which card
 * and entitlements apply, how a draft becomes a QuoteDraftInput, and the live
 * re-derivation of geometry quantities.
 */

export const DEFAULT_CARD = defaultCardJson as unknown as RateCard;

export const TRADE_LABEL: Record<Trade, string> = {
  CIVIL: 'Civil & demolition',
  WATERPROOFING: 'Waterproofing',
  FALSE_CEILING: 'False ceiling',
  ELECTRICAL: 'Electrical',
  PLUMBING: 'Plumbing',
  FLOORING: 'Flooring & tiling',
  PAINTING: 'Painting & wall finishes',
  CARPENTRY: 'Woodwork & carpentry',
  MODULAR_KITCHEN: 'Modular kitchen',
  WARDROBE: 'Wardrobes',
  GLASS_METAL: 'Glass & metal',
  LOOSE_FURNITURE: 'Loose furniture',
  LIGHTING: 'Lighting',
  APPLIANCES: 'Appliances',
  SANITARY: 'CP & sanitary',
  DECOR: 'Décor & furnishings',
  DESIGN_FEE: 'Design fee',
  MISC: 'Miscellaneous',
};

export function freeEntitlements(): Entitlements {
  return entitlementsFor('FREE');
}

/** The account's entitlements as they apply to this project (Project Pass unlocks one project). */
export function projectEntitlements(ents: Entitlements | null, projectId: string | undefined): Entitlements {
  const base = ents ?? freeEntitlements();
  return projectId ? entitlementsForProject(base, projectId) : base;
}

/** The card a quote prices from: the default, with the studio's overrides on paid plans. */
export function activeCard(ents: Entitlements): { card: RateCard; overrides?: RateCardOverrides } {
  const overrides = ents.rateCards ? (getCloudOverrides() ?? localOverrides() ?? undefined) : undefined;
  if (!overrides || overrides.baseCardId !== DEFAULT_CARD.id) return { card: DEFAULT_CARD };
  try {
    return { card: applyOverrides(DEFAULT_CARD, overrides), overrides };
  } catch {
    return { card: DEFAULT_CARD };
  }
}

const OVERRIDES_KEY = 'dezine.rate-overrides.v1';

export function localOverrides(): RateCardOverrides | null {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as RateCardOverrides) : null;
  } catch {
    return null;
  }
}

export function saveLocalOverrides(o: RateCardOverrides) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
  } catch {
    /* quota */
  }
}

export function studioOrDefault(): StudioProfile {
  return normaliseStudio(useBiz.getState().studio);
}

/** Documents this account may issue for this studio: plan ∩ GST registration. */
export function issuableDocTypes(ents: Entitlements, studio: StudioProfile): DocType[] {
  return planDocTypes(ents, studio.gstRegistration).filter((d) => d !== 'VARIATION_ORDER');
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export function carpetSqm(project: Project): number {
  return project.floors.reduce((s, f) => s + f.rooms.reduce((t, r) => t + polygonArea(r.polygon), 0), 0);
}

/** Carpet + the footprint of every wall (centreline length × thickness): a fair built-up estimate. */
export function builtUpSqm(project: Project): number {
  const walls = project.floors.reduce(
    (s, f) => s + f.walls.reduce((t, w) => t + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) * w.thicknessM, 0),
    0,
  );
  return carpetSqm(project) + walls;
}

export function areaBasisFor(project: Project, kind: 'CARPET' | 'BUILT_UP') {
  const sqm = kind === 'CARPET' ? carpetSqm(project) : builtUpSqm(project);
  return { kind, sqft: Math.round(toSqft(sqm) * 100) / 100 } as const;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export function tradeLine(l: TradeLineItem): QuoteLine {
  return { kind: 'TRADE', ...l };
}

export function seedLines(project: Project, card: RateCard, catalog: Catalog): QuoteLine[] {
  return autoLines(project, card, { catalog }).map(tradeLine);
}

/** The make list a card implies for these lines: brands per trade, in first-seen order. */
export function makeListFor(lines: QuoteLine[], card: RateCard): QuotationDocument['makeList'] {
  const byTrade = new Map<string, Set<string>>();
  const entries = new Map(card.entries.map((e) => [e.id, e]));
  for (const l of lines) {
    if (l.kind !== 'TRADE' || !l.rateCardEntryId) continue;
    const e = entries.get(l.rateCardEntryId);
    if (!e?.makeList?.length) continue;
    const key = TRADE_LABEL[e.trade];
    const set = byTrade.get(key) ?? new Set<string>();
    e.makeList.forEach((b) => set.add(b));
    byTrade.set(key, set);
  }
  return [...byTrade.entries()].map(([category, brands]) => ({ category, brands: [...brands] }));
}

export function newDraft(project: Project, card: RateCard, catalog: Catalog, studio: StudioProfile, docType: DocType): QuoteDraft {
  const lines = seedLines(project, card, catalog);
  return {
    lines,
    modular: [],
    view: 'ROOM_WISE',
    designFee: { basis: 'PCT_OF_PROJECT', value: 8 },
    milestones: milestonesFromStudio(studio),
    makeList: makeListFor(lines, card),
    inclusions: [...DEFAULT_INCLUSIONS],
    exclusions: [...DEFAULT_EXCLUSIONS],
    terms: [...studio.defaultTerms],
    areaBasisKind: 'CARPET',
    docType,
    validityDays: 30,
    recipient: { ...EMPTY_PARTY, address: { ...studio.address, line1: '', line2: undefined, pin: '' } },
    siteAddress: { ...studio.address, line1: '', line2: undefined, pin: '' },
    seeded: true,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Live re-derivation
// ---------------------------------------------------------------------------

export interface LiveLine {
  line: QuoteLine;
  /** Trace back to the plan, for the hover. */
  formula?: string;
  error?: string;
}

/** Re-quantifies geometry lines and re-prices everything against the current plan. */
export function liveLines(lines: QuoteLine[], project: Project, modular: ModularItem[]): LiveLine[] {
  return lines.map((line) => {
    if (line.kind === 'MODULAR') {
      const item = modular.find((m) => m.id === line.item.id) ?? line.item;
      try {
        const breakdown = priceModular(item, undefined, project);
        return { line: { ...line, item, breakdown, amount: breakdown.total } };
      } catch (e) {
        return { line, error: (e as Error).message };
      }
    }
    try {
      if (line.roomId && !project.floors.some((f) => f.rooms.some((r) => r.id === line.roomId))) {
        return { line, error: 'This room is no longer in the plan.' };
      }
      const q = quantifyLine(line, project);
      const next = { ...line, quantityBase: q.quantityBase, quantityDisplay: q.quantityDisplay };
      next.amount = priceLine(next);
      return { line: next, formula: q.formula };
    } catch (e) {
      return { line, error: (e as Error).message };
    }
  });
}

export function draftInput(
  draft: QuoteDraft,
  lines: QuoteLine[],
  project: Project,
): Omit<QuoteDraftInput, 'project' | 'rateCard' | 'studio' | 'watermark'> {
  return {
    recipient: draft.recipient,
    siteAddress: draft.siteAddress,
    lines,
    view: draft.view,
    ...(draft.designFee && draft.designFee.value > 0 ? { designFee: draft.designFee } : {}),
    ...(draft.discount && draft.discount.amount > 0 ? { discount: draft.discount } : {}),
    milestones: draft.milestones,
    makeList: draft.makeList,
    inclusions: draft.inclusions,
    exclusions: draft.exclusions,
    terms: draft.terms,
    areaBasis: areaBasisFor(project, draft.areaBasisKind),
    docType: draft.docType,
    issueDate: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
    validityDays: draft.validityDays,
  };
}

export interface Preview {
  doc: QuotationDocument | null;
  error?: string;
}

export function previewDoc(
  draft: QuoteDraft,
  lines: QuoteLine[],
  project: Project,
  card: RateCard,
  overrides: RateCardOverrides | undefined,
  studio: StudioProfile,
  ents: Entitlements,
): Preview {
  const watermark = !ents.brandedQuotes;
  const supplier = watermark ? { ...studio, logoDataUrl: undefined, brandColorHex: undefined } : studio;
  try {
    const doc = buildQuote({
      ...draftInput(draft, lines, project),
      project,
      rateCard: card,
      ...(overrides ? { overrides } : {}),
      studio: supplier,
      watermark,
    });
    return { doc: { ...doc, status: 'DRAFT' } };
  } catch (e) {
    return { doc: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export function lineFromCard(entry: RateCardEntry, project: Project, roomId?: string): QuoteLine {
  const l = lineFromEntry(entry, project, roomId);
  return tradeLine({ ...l, id: uid(entry.id) });
}

export function manualLine(roomId?: string): QuoteLine {
  const l: TradeLineItem = {
    id: uid('manual'),
    lineNo: '',
    ...(roomId ? { roomId } : {}),
    trade: 'MISC',
    description: 'New item',
    unit: 'NOS',
    rule: { kind: 'MANUAL' },
    quantityBase: 1,
    quantityDisplay: 1,
    materialRate: 0,
    labourRate: 0,
    markupPct: 0,
    discountPct: 0,
    amount: 0,
    hsnSac: '9954',
    gstRatePct: 18,
    supplyNature: 'WORKS_CONTRACT',
    clientSupplied: false,
    optional: false,
  };
  return tradeLine(l);
}

// ---------------------------------------------------------------------------
// Variation orders
// ---------------------------------------------------------------------------

/**
 * The lines of a variation order against an approved quote, the way Indian
 * contracts write them: a new item is added as-is; a removed item is an
 * "Omit" line with a negative quantity; a changed item is omitted at its
 * approved quantity and rate and re-added as revised. The VO's own total is
 * then exactly the change in scope.
 */
export function variationLines(approved: QuotationDocument, revised: QuoteLine[]): QuoteLine[] {
  const before = new Map(approved.sections.flatMap((s) => s.lines).map((l) => [l.id, l]));
  const after = new Map(revised.map((l) => [l.id, l]));
  const out: QuoteLine[] = [];
  const omit = (l: QuoteLine): QuoteLine => {
    if (l.kind === 'MODULAR') {
      // The engine re-prices modular lines from their item, so an omission is a lump-sum trade line.
      return tradeLine({
        id: `${l.id}~omit`,
        lineNo: '',
        roomId: l.roomId,
        trade: l.item.type === 'KITCHEN' ? 'MODULAR_KITCHEN' : 'WARDROBE',
        description: `Omit: ${l.description} (approved line ${l.lineNo})`,
        unit: 'SET',
        rule: { kind: 'MANUAL' },
        quantityBase: -1,
        quantityDisplay: -1,
        materialRate: l.amount,
        labourRate: 0,
        markupPct: 0,
        discountPct: 0,
        amount: -l.amount,
        hsnSac: l.hsnSac,
        gstRatePct: l.gstRatePct,
        supplyNature: 'GOODS',
        clientSupplied: false,
        optional: false,
      });
    }
    return {
      ...l,
      id: `${l.id}~omit`,
      description: `Omit: ${l.description} (approved line ${l.lineNo})`,
      rule: { kind: 'MANUAL' },
      quantityDisplay: -l.quantityDisplay,
      quantityBase: -l.quantityBase,
      amount: -l.amount,
    };
  };
  const same = (a: QuoteLine, b: QuoteLine) => {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'MODULAR' && b.kind === 'MODULAR') return a.amount === b.amount && a.description === b.description && a.optional === b.optional;
    if (a.kind === 'TRADE' && b.kind === 'TRADE') {
      return a.amount === b.amount && a.description === b.description && a.quantityDisplay === b.quantityDisplay && a.optional === b.optional && a.clientSupplied === b.clientSupplied;
    }
    return false;
  };
  for (const l of revised) {
    const prev = before.get(l.id);
    if (!prev) {
      if (!l.optional) out.push(l.kind === 'TRADE' ? { ...l, rule: l.rule.kind === 'MANUAL' || l.rule.kind === 'FIXED' ? l.rule : { kind: 'MANUAL' } } : l);
      continue;
    }
    if (same(prev, l)) continue;
    if (!prev.optional) out.push(omit(prev));
    if (!l.optional) {
      out.push(
        l.kind === 'TRADE'
          ? { ...l, id: `${l.id}~rev`, description: `Revised: ${l.description}`, rule: { kind: 'MANUAL' } }
          : { ...l, id: `${l.id}~rev`, description: `Revised: ${l.description}` },
      );
    }
  }
  for (const [id, l] of before) if (!after.has(id) && !l.optional) out.push(omit(l));
  return out;
}
