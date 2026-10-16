/**
 * 3xDezine — trade quantities and line pricing.
 *
 * Quantities come from the plan geometry, in SI (m², m, count), and are only
 * converted to trade units (sq ft, rft, points, nos) for display and pricing.
 * Geometry follows shared/cost.ts exactly: room floor/ceiling = polygon area,
 * wall faces = centreline length × wall height, openings = width × height.
 * A room's walls are the wall centrelines its polygon edges run along (the
 * same edge-overlap test shared/rules.ts uses), so summing every room's wall
 * area reproduces cost.ts's wall area for a plan whose rooms tile it.
 *
 * Pure and deterministic.
 */

import type {
  Paise,
  QuantityRule,
  RateCard,
  RateCardEntry,
  RateCardOverrides,
  TradeLineItem,
  TradeUnit,
} from './business.js';
import { polygonArea, wallLength } from './cost.js';
import { isDoor, isWindow, inferRoomKind, type RoomKind } from './rules.js';
import type { Catalog, Floor, Opening, Project, Room, Vec2, Wall } from './types.js';
import { FT_PER_M, SQFT_PER_SQM, assertPaise, divRoundBig, pctToMicro, roundHalfAway } from './money.js';

const EPS = 1e-6;

/** `autoApplyTo` value for a single whole-house line (no room), e.g. the distribution board. */
export const WHOLE_HOUSE = 'WHOLE_HOUSE';

// ---------------------------------------------------------------------------
// Geometry: which wall runs bound a room
// ---------------------------------------------------------------------------

export interface WallRun {
  wall: Wall;
  /** Metres from wall.start along the centreline. */
  from: number;
  to: number;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;

/** Same test as rules.ts edgeOverlap: both edge ends within the wall's half-thickness band. */
function edgeOnWall(a: Vec2, b: Vec2, wall: Wall): { from: number; to: number } | undefined {
  const L = wallLength(wall.start, wall.end);
  if (L < EPS) return undefined;
  const u = { x: (wall.end.x - wall.start.x) / L, z: (wall.end.z - wall.start.z) / L };
  const tol = wall.thicknessM / 2 + 0.02;
  if (Math.abs(cross(u, sub(a, wall.start))) > tol || Math.abs(cross(u, sub(b, wall.start))) > tol) return undefined;
  const ta = dot(sub(a, wall.start), u);
  const tb = dot(sub(b, wall.start), u);
  const from = Math.max(Math.min(ta, tb), 0);
  const to = Math.min(Math.max(ta, tb), L);
  return to - from > EPS ? { from, to } : undefined;
}

/** The stretches of wall centreline that a room's polygon edges run along. */
export function roomWallRuns(floor: Floor, room: Room): WallRun[] {
  const runs: WallRun[] = [];
  const p = room.polygon;
  for (let i = 0; i < p.length; i++) {
    for (const wall of floor.walls) {
      const span = edgeOnWall(p[i], p[(i + 1) % p.length], wall);
      if (span) runs.push({ wall, ...span });
    }
  }
  return runs;
}

/** Openings whose centre lies on one of the runs (each opening once per room). */
function openingsOnRuns(floor: Floor, runs: WallRun[]): Opening[] {
  const out = new Map<string, Opening>();
  for (const o of floor.openings) {
    for (const r of runs) {
      if (r.wall.id !== o.wallId) continue;
      const s = o.t * wallLength(r.wall.start, r.wall.end);
      if (s >= r.from - EPS && s <= r.to + EPS) out.set(o.id, o);
    }
  }
  return [...out.values()];
}

function findRoom(project: Project, roomId: string): { floor: Floor; room: Room } {
  for (const floor of project.floors) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return { floor, room };
  }
  throw new Error(`Room '${roomId}' is not in the plan`);
}

/** Which side of a shared door "owns" it: the more private room. Lower wins. */
const OWNER_RANK: Record<RoomKind, number> = {
  BATH_WC: 0, BATH: 0, WC: 0, STORE: 1, CABIN: 2, HABITABLE: 3, KITCHEN: 4, KITCHEN_DINING: 4,
  UNKNOWN: 5, OUTDOOR: 6, CIRCULATION: 7,
};

/**
 * The room an opening is counted in, for per-room door/window counts, so a
 * door between two rooms is counted once: of the rooms whose walls it sits
 * on, the most private by kind (toilet > store > cabin > bedroom/living >
 * kitchen > other > balcony > hall/passage), then the smaller, then the first
 * in plan order. A toilet door belongs to the toilet, a bedroom door to the
 * bedroom, a balcony door to the room. Undefined if on no room's boundary.
 */
export function openingOwnerRoom(floor: Floor, opening: Opening): Room | undefined {
  let best: { room: Room; rank: number; area: number } | undefined;
  for (const room of floor.rooms) {
    if (!openingsOnRuns(floor, roomWallRuns(floor, room)).some((o) => o.id === opening.id)) continue;
    const rank = OWNER_RANK[inferRoomKind(room.name)];
    const area = polygonArea(room.polygon);
    if (!best || rank < best.rank || (rank === best.rank && area < best.area - EPS)) best = { room, rank, area };
  }
  return best?.room;
}

// ---------------------------------------------------------------------------
// Quantity derivation
// ---------------------------------------------------------------------------

export type UnitBase = 'M2' | 'M' | 'COUNT';

export interface DerivedQuantity {
  base: number;
  unitBase: UnitBase;
  /** Human-readable trace back to the plan. */
  formula: string;
}

const f2 = (v: number) => roundHalfAway(v, 2).toFixed(2);
const isDoorish = (o: Opening) => o.sillM < 0.05; // doors and floor-level cased openings: no skirting

function roomQuantity(rule: QuantityRule, floor: Floor, room: Room): DerivedQuantity {
  const area = polygonArea(room.polygon);
  switch (rule.kind) {
    case 'FLOOR_AREA':
      return { base: area, unitBase: 'M2', formula: `${room.name} floor ${f2(area)} m²` };
    case 'CEILING_AREA':
      return { base: area, unitBase: 'M2', formula: `${room.name} ceiling ${f2(area)} m²` };
    case 'WALL_AREA': {
      const runs = roomWallRuns(floor, room);
      const length = runs.reduce((s, r) => s + (r.to - r.from), 0);
      const gross = runs.reduce((s, r) => s + (r.to - r.from) * r.wall.heightM, 0);
      let formula = `${room.name} walls ${f2(length)} m run × height = ${f2(gross)} m²`;
      if (!rule.deductOpenings) return { base: gross, unitBase: 'M2', formula };
      const openings = openingsOnRuns(floor, runs);
      const deduct = openings.reduce((s, o) => s + o.widthM * o.heightM, 0);
      const net = Math.max(0, gross - deduct);
      formula += ` − ${openings.length} opening${openings.length === 1 ? '' : 's'} ${f2(deduct)} m² = ${f2(net)} m²`;
      return { base: net, unitBase: 'M2', formula };
    }
    case 'PERIMETER': {
      const runs = roomWallRuns(floor, room);
      const length = runs.reduce((s, r) => s + (r.to - r.from), 0);
      let formula = `${room.name} wall perimeter ${f2(length)} m`;
      if (!rule.deductDoors) return { base: length, unitBase: 'M', formula };
      const doors = openingsOnRuns(floor, runs).filter(isDoorish);
      const deduct = doors.reduce((s, o) => s + o.widthM, 0);
      const net = Math.max(0, length - deduct);
      formula += ` − ${doors.length} door${doors.length === 1 ? '' : 's'} ${f2(deduct)} m = ${f2(net)} m`;
      return { base: net, unitBase: 'M', formula };
    }
    case 'COUNT_OPENINGS': {
      const test = rule.of === 'DOOR' ? isDoor : isWindow;
      const n = floor.openings.filter((o) => test(o) && openingOwnerRoom(floor, o)?.id === room.id).length;
      return { base: n, unitBase: 'COUNT', formula: `${room.name}: ${n} ${rule.of.toLowerCase()}${n === 1 ? '' : 's'}` };
    }
    case 'POINTS_PER_ROOM': {
      const kind = inferRoomKind(room.name);
      const n = rule.byRoomKind[kind] ?? rule.fallback;
      return { base: n, unitBase: 'COUNT', formula: `${room.name} (${kind.toLowerCase()}): ${n} point${n === 1 ? '' : 's'}` };
    }
    case 'FIXED':
      return { base: rule.quantity, unitBase: 'COUNT', formula: `Fixed quantity ${rule.quantity}` };
    case 'MANUAL':
      return { base: 0, unitBase: 'COUNT', formula: 'Manual quantity' };
  }
}

/**
 * Quantity for a rule, in its SI base. With `roomId`, for that room; without,
 * for the whole plan (rooms summed; door/window counts are every door/window
 * on every floor). FIXED quantities are in the LINE's unit (e.g. LS = 1,
 * 3 NOS) and are returned as-is; MANUAL returns 0 (the typed quantity lives
 * on the line). Throws if `roomId` is not in the plan.
 */
export function deriveQuantity(rule: QuantityRule, project: Project, roomId?: string): DerivedQuantity {
  if (roomId !== undefined) {
    const { floor, room } = findRoom(project, roomId);
    return roomQuantity(rule, floor, room);
  }
  if (rule.kind === 'FIXED') return { base: rule.quantity, unitBase: 'COUNT', formula: `Fixed quantity ${rule.quantity}` };
  if (rule.kind === 'MANUAL') return { base: 0, unitBase: 'COUNT', formula: 'Manual quantity' };
  if (rule.kind === 'COUNT_OPENINGS') {
    const test = rule.of === 'DOOR' ? isDoor : isWindow;
    const n = project.floors.reduce((s, f) => s + f.openings.filter(test).length, 0);
    return { base: n, unitBase: 'COUNT', formula: `Whole house: ${n} ${rule.of.toLowerCase()}${n === 1 ? '' : 's'}` };
  }
  let base = 0;
  let unitBase: UnitBase = 'COUNT';
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const q = roomQuantity(rule, floor, room);
      base += q.base;
      unitBase = q.unitBase;
    }
  }
  if (rule.kind === 'FLOOR_AREA' || rule.kind === 'CEILING_AREA' || rule.kind === 'WALL_AREA') unitBase = 'M2';
  if (rule.kind === 'PERIMETER') unitBase = 'M';
  const label = { FLOOR_AREA: 'floor area', CEILING_AREA: 'ceiling area', WALL_AREA: 'wall area', PERIMETER: 'wall perimeter', POINTS_PER_ROOM: 'points' }[rule.kind];
  const unit = unitBase === 'M2' ? ' m²' : unitBase === 'M' ? ' m' : '';
  return { base, unitBase, formula: `Whole house ${label}, all rooms: ${unitBase === 'COUNT' ? base : f2(base)}${unit}` };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const COUNT_UNITS: TradeUnit[] = ['POINT', 'NOS', 'SET'];

/** The SI base a trade unit is stored in. LS is a lump sum and accepts any base. */
export function unitBaseOf(unit: TradeUnit): UnitBase | 'ANY' {
  if (unit === 'SQFT' || unit === 'SQM') return 'M2';
  if (unit === 'RFT' || unit === 'RMT') return 'M';
  if (unit === 'LS') return 'ANY';
  return 'COUNT';
}

/**
 * SI base → display quantity in the trade unit. Rounded AFTER conversion:
 * sq ft / sq m / rft / rmt to 2 dp (half away from zero); points, nos and sets
 * UP to a whole number (you cannot fit 2.2 light points); LS is always 1.
 */
export function toDisplayQuantity(base: number, unit: TradeUnit): number {
  switch (unit) {
    case 'SQFT': return roundHalfAway(base * SQFT_PER_SQM, 2);
    case 'SQM': return roundHalfAway(base, 2);
    case 'RFT': return roundHalfAway(base * FT_PER_M, 2);
    case 'RMT': return roundHalfAway(base, 2);
    case 'LS': return 1;
    default:
      if (!COUNT_UNITS.includes(unit)) throw new Error(`Unknown trade unit '${unit}'`);
      return base >= 0 ? Math.ceil(base - 1e-9) : -Math.ceil(-base - 1e-9);
  }
}

/** Display quantity → SI base (for MANUAL and FIXED lines typed in trade units). */
export function fromDisplayQuantity(display: number, unit: TradeUnit): number {
  if (unit === 'SQFT') return display / SQFT_PER_SQM;
  if (unit === 'RFT') return display / FT_PER_M;
  if (unit === 'LS') return 1;
  return display;
}

/** Re-rounds a quantity already in display units (what a user typed). */
export function roundDisplay(display: number, unit: TradeUnit): number {
  if (unit === 'LS') return 1;
  if (COUNT_UNITS.includes(unit)) return toDisplayQuantity(display, unit);
  return roundHalfAway(display, 2);
}

/**
 * Quantities for a line from its rule: GEOMETRY rules re-derive from the
 * plan; FIXED takes rule.quantity in the line's unit; MANUAL keeps the typed
 * `quantityDisplay`. Throws if the rule's base does not fit the unit
 * (wall area cannot be quoted in rft).
 */
export function quantifyLine(
  line: Pick<TradeLineItem, 'rule' | 'unit' | 'roomId' | 'quantityDisplay' | 'description'>,
  project: Project,
): { quantityBase: number; quantityDisplay: number; formula: string } {
  const { rule, unit } = line;
  if (rule.kind === 'MANUAL') {
    const d = roundDisplay(line.quantityDisplay ?? 0, unit);
    return { quantityBase: fromDisplayQuantity(d, unit), quantityDisplay: d, formula: 'Manual quantity' };
  }
  if (rule.kind === 'FIXED') {
    const d = roundDisplay(rule.quantity, unit);
    return { quantityBase: fromDisplayQuantity(d, unit), quantityDisplay: d, formula: `Fixed quantity ${d} ${unit}` };
  }
  const q = deriveQuantity(rule, project, line.roomId);
  const want = unitBaseOf(unit);
  if (want !== 'ANY' && want !== q.unitBase) {
    throw new Error(`'${line.description}': rule ${rule.kind} gives ${q.unitBase} but the unit is ${unit}`);
  }
  return { quantityBase: q.base, quantityDisplay: toDisplayQuantity(q.base, unit), formula: q.formula };
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

/**
 * A studio's card: base entries minus `disabled`, with `overrides` merged in,
 * then `added` appended (an added entry with an existing id replaces it in
 * place). Overrides for ids not on the card are ignored. Throws if the
 * overrides were made for a different base card.
 */
export function applyOverrides(card: RateCard, overrides?: RateCardOverrides): RateCard {
  if (!overrides) return card;
  if (overrides.baseCardId !== card.id) {
    throw new Error(`Rate overrides are for card '${overrides.baseCardId}', not '${card.id}'`);
  }
  const disabled = new Set(overrides.disabled ?? []);
  const added = new Map((overrides.added ?? []).map((e) => [e.id, e]));
  const entries: RateCardEntry[] = [];
  for (const e of card.entries) {
    if (disabled.has(e.id)) continue;
    const replacement = added.get(e.id);
    if (replacement) {
      entries.push(replacement);
      added.delete(e.id);
      continue;
    }
    const o = overrides.overrides?.[e.id];
    entries.push(o ? { ...e, ...stripUndefined(o) } : e);
  }
  for (const e of added.values()) if (!disabled.has(e.id)) entries.push(e);
  return { ...card, entries };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Floor finish classes (for flooring auto-lines)
// ---------------------------------------------------------------------------

export type FloorFinish = 'TILE' | 'STONE' | 'WOOD' | 'LAMINATE' | 'CONCRETE' | 'CARPET';

/**
 * Classifies a room's floor material for `RateCardEntry.floorFinishes`. Uses
 * the catalog's category/subtype when given, else keywords in the id.
 */
export function floorFinishOf(materialId: string | undefined, catalog?: Catalog): FloorFinish | undefined {
  if (!materialId) return undefined;
  const m = catalog?.materials.find((x) => x.id === materialId);
  const s = `${materialId} ${m?.subtype ?? ''} ${m?.category ?? ''}`.toLowerCase();
  if (/laminate/.test(s)) return 'LAMINATE';
  if (/marble|granite|stone|kota|travertine/.test(s)) return 'STONE';
  if (/carpet/.test(s)) return 'CARPET';
  if (/concrete|epoxy|terrazzo|ips/.test(s)) return 'CONCRETE';
  if (/tile|vitrified|ceramic|porcelain/.test(s)) return 'TILE';
  if (/wood|oak|teak|walnut|bamboo|hardwood|parquet|flooring/.test(s)) return 'WOOD';
  return undefined;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

type Priceable = Pick<TradeLineItem, 'quantityDisplay' | 'materialRate' | 'labourRate' | 'markupPct' | 'discountPct' | 'clientSupplied'>;

/**
 * The rate printed on the quote: (material + labour) × (1 + markup), rounded
 * to the paisa. Markup is internal and never printed separately — it lives
 * only inside this composite. Client-supplied material → labour only.
 */
export function printedRate(line: Omit<Priceable, 'quantityDisplay' | 'discountPct'>): Paise {
  assertPaise(line.materialRate, 'materialRate');
  assertPaise(line.labourRate, 'labourRate');
  const base = BigInt((line.clientSupplied ? 0 : line.materialRate) + line.labourRate);
  return Number(divRoundBig(base * (1_000_000n + pctToMicro(line.markupPct ?? 0)), 1_000_000n));
}

/**
 * Line amount = qtyDisplay × printedRate × (1 − discount), rounded once, half
 * away from zero. Using the printed (marked-up) rate rather than the raw
 * product keeps every printed row reconcilable — Qty × Rate − discount =
 * Amount — on paper. `optional` lines are priced too; totals exclude them.
 */
export function priceLine(line: Priceable): Paise {
  const qtyHundredths = BigInt(roundHalfAway(line.quantityDisplay * 100));
  const rate = BigInt(printedRate(line));
  const disc = pctToMicro(line.discountPct ?? 0);
  if (disc > 1_000_000n || disc < 0n) throw new Error(`Discount must be 0–100%, got ${line.discountPct}`);
  return Number(divRoundBig(qtyHundredths * rate * (1_000_000n - disc), 100n * 1_000_000n));
}

// ---------------------------------------------------------------------------
// Auto-seeded BOQ
// ---------------------------------------------------------------------------

/** A trade line from a rate-card entry, quantified and priced. lineNo is left empty for buildQuote to assign. */
export function lineFromEntry(entry: RateCardEntry, project: Project, roomId?: string, rule: QuantityRule = entry.defaultRule): TradeLineItem {
  const draft = {
    rule,
    unit: entry.unit,
    roomId,
    quantityDisplay: rule.kind === 'MANUAL' ? 1 : 0,
    description: entry.description,
  };
  const q = quantifyLine(draft, project);
  const line: TradeLineItem = {
    id: `${entry.id}@${roomId ?? 'house'}`,
    lineNo: '',
    ...(roomId !== undefined ? { roomId } : {}),
    trade: entry.trade,
    rateCardEntryId: entry.id,
    description: entry.description,
    ...(entry.makeList?.length ? { spec: { brand: entry.makeList.join(' / ') } } : {}),
    unit: entry.unit,
    rule,
    quantityBase: q.quantityBase,
    quantityDisplay: q.quantityDisplay,
    formula: q.formula,
    materialRate: entry.materialRate,
    labourRate: entry.labourRate,
    markupPct: 0,
    discountPct: 0,
    amount: 0,
    hsnSac: entry.hsnSac,
    gstRatePct: entry.gstRatePct,
    supplyNature: entry.supplyNature,
    clientSupplied: false,
    optional: false,
  };
  line.amount = priceLine(line);
  return line;
}

/**
 * Seeds a room-wise BOQ: for every room (floors, then rooms, in plan order)
 * and every card entry whose `autoApplyTo` includes the room's kind
 * (rules.ts inferRoomKind) — and, for entries with `floorFinishes`, whose
 * floor material is of one of those classes — one line using the entry's
 * `defaultRule`. Entries with `autoApplyTo: ['WHOLE_HOUSE']` give one line
 * without a room. MANUAL-rule entries and zero quantities are skipped.
 * The design fee is never a line (it is QuoteDraftInput.designFee).
 */
export function autoLines(project: Project, card: RateCard, opts: { catalog?: Catalog } = {}): TradeLineItem[] {
  const out: TradeLineItem[] = [];
  const auto = card.entries.filter((e) => e.autoApplyTo?.length && e.defaultRule.kind !== 'MANUAL' && e.trade !== 'DESIGN_FEE');
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const kind = inferRoomKind(room.name);
      const finish = floorFinishOf(room.floorMaterialId, opts.catalog);
      for (const e of auto) {
        if (!e.autoApplyTo!.includes(kind)) continue;
        if (e.floorFinishes?.length && !(finish && e.floorFinishes.includes(finish))) continue;
        const line = lineFromEntry(e, project, room.id);
        if (line.quantityDisplay > 0) out.push(line);
      }
    }
  }
  for (const e of auto) {
    if (!e.autoApplyTo!.includes(WHOLE_HOUSE)) continue;
    const line = lineFromEntry(e, project);
    if (line.quantityDisplay > 0) out.push(line);
  }
  return out;
}
