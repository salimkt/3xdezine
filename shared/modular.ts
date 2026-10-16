/**
 * 3xDezine — modular kitchens and wardrobes (v1: credible pricing, no cut-lists).
 *
 * Model per docs/research/04-workflows.md §5 / §8.2: cabinet runs sit on plan
 * walls; each run has zones (base / wall / tall / loft) filled left → right
 * with standard-width modules and a filler; each zone has a carcass board and
 * a shutter finish; hardware (hinges, channels, lift-ups) is COUNTED from the
 * modules and priced by tier; countertop, accessories and appliances are
 * separate lines, as in every Indian quote.
 *
 * "Left → right" along a run means increasing distance from wall.start.
 * Boxes for the renderer are world metres, Y up, Y = 0 at the floor's
 * finished level; local x runs along the wall, local +z faces into the room
 * (the shutter side), so `rotationY` alone orients a box.
 *
 * Every rate here is a PLANNING figure (confidence LOW) derived from the
 * ranges in §2.3 / §5; studios override them via `pricing.rateOverrides`.
 */

import type {
  BoardMaterial,
  CabinetRun,
  HardwareTier,
  ModularBreakdown,
  ModularItem,
  ModuleInstance,
  ModuleKind,
  Paise,
  QuoteLine,
  ShutterFinish,
  Zone,
  ZoneSpec,
} from './business.js';
import { wallLength } from './cost.js';
import { HSN_FURNITURE } from './gst.js';
import { FT_PER_M, SQFT_PER_SQM, divRoundBig, roundHalfAway } from './money.js';
import { roomWallRuns } from './trades.js';
import type { Floor, Project, Room, Vec2, Wall } from './types.js';

export const ZONES: Zone[] = ['BASE', 'WALL', 'TALL', 'LOFT'];
export const STANDARD_WIDTHS_MM = [150, 300, 450, 600, 750, 900, 1200] as const;
/** Base and tall units stand on a plinth (100–150 mm, §5.1). */
export const PLINTH_MM = 100;
/** Worktop thickness; the base carcass stops this far below counter height. */
export const COUNTERTOP_MM = 40;
/** Minimum clear gap from counter to the underside of wall units (§5.1). */
export const MIN_COUNTER_TO_WALL_GAP_MM = 450;
const CORNER_KINDS: ModuleKind[] = ['BASE_CORNER', 'WALL_CORNER'];

// ---------------------------------------------------------------------------
// Rate table
// ---------------------------------------------------------------------------

export interface ModularRates {
  /** ₹/rft (paise) for the reference spec — MR ply carcass, matte laminate, mid hardware tier. */
  rft: Record<Zone, Paise>;
  /** ₹/sq ft of front elevation (paise) for the reference spec. */
  sqftFront: Record<Zone, Paise>;
  carcass: Record<BoardMaterial, number>;
  finish: Record<ShutterFinish, number>;
  /** Incidental fittings (handles, shelf pins, legs) by tier; counted hardware is priced separately below. */
  tier: Record<HardwareTier, number>;
  /** Per piece: hinge; per drawer: channel pair / tandem box; per lift-up unit. Paise, ex-GST. */
  hardware: Record<HardwareTier, { hinge: Paise; channel: Paise; liftUp: Paise }>;
  /** Zone rates are rounded to this many paise (₹10). */
  roundTo: Paise;
  /** Share of the zone rate that is installation, removed when `installationIncluded` is false. */
  installationShare: number;
}

/**
 * Derivation (all LOW confidence, 04-workflows §2.3 and §5.2):
 *  - RFT: laminate kitchens market at ₹9k–14k/rft basic (base + wall run
 *    together). Reference MR/laminate: base ₹6,500 + wall ₹4,000 = ₹10,500/rft
 *    for a base+wall run, below the midpoint because hardware and countertop
 *    are separate lines here. Tall ≈ base + wall + loft band; loft ₹2,500.
 *  - SQ FT FRONT: laminate ₹1,000–1,500 (GST incl.), Truww BWP base
 *    ₹1,500–1,800, MR wall ₹1,100–1,500, loft ₹600–900. Reference MR base
 *    ₹1,450, wall ₹1,250, tall ₹1,300, loft ₹750 (ex-GST).
 *  - Carcass: BWP costs ₹400–700 more per sheet than MR → ×1.12; HDHMR, MDF,
 *    particle board progressively cheaper.
 *  - Finish: shutter-only cost ratio laminate : membrane : acrylic : PU ≈
 *    1 : 1.3 : 2 : 2.7; shutters taken as ~half the cabinet cost, so the
 *    cabinet factor is 1 + 0.5 × (ratio − 1). Acrylic ×1.5, PU matte ×1.85 —
 *    in line with the rft ranges (acrylic ₹15–22k, PU ₹18–28k vs laminate ₹9–14k).
 *  - Hardware: Hettich Sensys ≈ ₹728/pair, soft-close telescopic channels
 *    ₹790–820/set, tandem boxes ₹3,900–5,600/drawer (premium).
 */
export const DEFAULT_MODULAR_RATES: ModularRates = {
  rft: { BASE: 6_500_00, WALL: 4_000_00, TALL: 12_000_00, LOFT: 2_500_00 },
  sqftFront: { BASE: 1_450_00, WALL: 1_250_00, TALL: 1_300_00, LOFT: 750_00 },
  carcass: { BWP_PLY: 1.12, BWR_MR_PLY: 1, HDHMR: 0.95, MDF: 0.88, PARTICLE_BOARD: 0.75 },
  finish: {
    LAMINATE_MATTE: 1, LAMINATE_GLOSS: 1.05, MEMBRANE: 1.15, ACRYLIC: 1.5,
    PU_MATTE: 1.85, PU_GLOSS: 2, VENEER: 1.6, GLASS_PROFILE: 1.75,
  },
  tier: { VALUE: 0.97, MID: 1, PREMIUM: 1.05 },
  hardware: {
    VALUE: { hinge: 120_00, channel: 450_00, liftUp: 1_500_00 },
    MID: { hinge: 250_00, channel: 800_00, liftUp: 3_500_00 },
    PREMIUM: { hinge: 400_00, channel: 4_500_00, liftUp: 8_000_00 },
  },
  roundTo: 10_00,
  installationShare: 0.08,
};

const DEFAULT_SPEC: Record<Zone, ZoneSpec> = {
  BASE: { carcass: 'BWP_PLY', shutter: { substrate: 'HDHMR', finish: 'LAMINATE_MATTE', colorHex: '#E8E2D6' }, handle: 'G_PROFILE' },
  WALL: { carcass: 'BWR_MR_PLY', shutter: { substrate: 'HDHMR', finish: 'LAMINATE_MATTE', colorHex: '#F4F1EA' }, handle: 'G_PROFILE' },
  TALL: { carcass: 'BWR_MR_PLY', shutter: { substrate: 'HDHMR', finish: 'LAMINATE_MATTE', colorHex: '#E8E2D6' }, handle: 'BAR' },
  LOFT: { carcass: 'BWR_MR_PLY', shutter: { substrate: 'MDF', finish: 'LAMINATE_MATTE', colorHex: '#F4F1EA' }, handle: 'PUSH_OPEN' },
};

export function specFor(item: ModularItem, zone: Zone): ZoneSpec {
  return item.zoneSpecs[zone] ?? DEFAULT_SPEC[zone];
}

/**
 * Composite zone rate (paise per rft or per sq ft of front) =
 * reference(zone, convention) × carcass × finish × tier, rounded to ₹10,
 * less the installation share when installation is excluded.
 * `pricing.rateOverrides[zone]` replaces the whole computation.
 */
export function zoneRate(item: ModularItem, zone: Zone, rates: ModularRates = DEFAULT_MODULAR_RATES): Paise {
  const override = item.pricing.rateOverrides?.[zone];
  if (override !== undefined) return override;
  const spec = specFor(item, zone);
  const ref = (item.pricing.convention === 'RFT' ? rates.rft : rates.sqftFront)[zone];
  const factor = rates.carcass[spec.carcass] * rates.finish[spec.shutter.finish] * rates.tier[item.hardwareTier]
    * (item.pricing.installationIncluded ? 1 : 1 - rates.installationShare);
  return roundHalfAway((ref * factor) / rates.roundTo) * rates.roundTo;
}

// ---------------------------------------------------------------------------
// Zone geometry
// ---------------------------------------------------------------------------

/** Front-elevation height of a zone. Base = floor to worktop (counter height), as Truww measures cabinet area. */
export function zoneFrontHeightMm(item: ModularItem, zone: Zone): number {
  const d = item.dims;
  switch (zone) {
    case 'BASE': return d.counterHeightMm;
    case 'WALL': return d.wallHeightMm;
    case 'TALL': return d.tallHeightMm;
    case 'LOFT': return d.loftHeightMm;
  }
}

/** Vertical extent [bottom, top] and depth of a zone's carcass boxes, mm. */
function zoneBox(item: ModularItem, zone: Zone): { bottom: number; top: number; depth: number } {
  const d = item.dims;
  const kitchen = item.type === 'KITCHEN';
  switch (zone) {
    case 'BASE': return { bottom: PLINTH_MM, top: d.counterHeightMm - COUNTERTOP_MM, depth: d.baseDepthMm };
    case 'WALL': return { bottom: d.wallBottomMm, top: d.wallBottomMm + d.wallHeightMm, depth: d.wallDepthMm };
    case 'TALL': return { bottom: PLINTH_MM, top: d.tallHeightMm, depth: d.baseDepthMm };
    case 'LOFT': {
      // Kitchen loft sits on the wall units (or on a taller tall unit); a wardrobe loft on the wardrobe.
      const hasTall = item.runs.some((r) => r.zones.includes('TALL'));
      const bottom = kitchen ? Math.max(d.wallBottomMm + d.wallHeightMm, hasTall ? d.tallHeightMm : 0) : d.tallHeightMm;
      return { bottom, top: bottom + d.loftHeightMm, depth: kitchen ? d.wallDepthMm : d.baseDepthMm };
    }
  }
}

/** ≈2 hinges per shutter up to 900 mm tall, 3 up to 1600 mm, 4 above (§8.2 field notes). */
export function hingesPerShutter(shutterHeightMm: number): number {
  if (shutterHeightMm <= 900) return 2;
  if (shutterHeightMm <= 1600) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Filling runs
// ---------------------------------------------------------------------------

function defaultKind(item: ModularItem, zone: Zone): ModuleKind {
  if (zone === 'TALL') return item.type === 'WARDROBE' ? 'WARDROBE_HINGED' : 'TALL';
  return zone;
}

/** Standard widths filling `remaining` mm greedily; remainder below the smallest allowed width is a filler. */
function fillWidths(remaining: number, zone: Zone, wardrobe: boolean): { widths: number[]; filler: number } {
  const widths: number[] = [];
  let r = Math.round(remaining);
  // Wardrobes: 900 two-door and 450 one-door modules. Kitchens: 600s, then one
  // each of 450 / 300 / (base only) 150 for the remainder.
  const [big, ...smaller] = wardrobe && (zone === 'TALL' || zone === 'LOFT') ? [900, 450] : zone === 'BASE' ? [600, 450, 300, 150] : [600, 450, 300];
  while (r >= big) { widths.push(big); r -= big; }
  for (const w of smaller) if (r >= w) { widths.push(w); r -= w; }
  return { widths, filler: r };
}

function shuttersFor(widthMm: number): number {
  return widthMm >= 600 ? 2 : 1;
}

/**
 * Fills one zone's `remaining` length. A kitchen's first base fill gets the
 * working set — sink 900, drawer stack 600 (3 drawers), hob 900 (3 drawers) —
 * when it fits; the rest are standard modules; a filler absorbs the remainder.
 * Module ids are deterministic per run (`<run>-<zone>-<n>`).
 */
function fillZone(item: ModularItem, run: CabinetRun, zone: Zone, remaining: number, kitchenSet: boolean, startIndex: number): ModuleInstance[] {
  let n = startIndex;
  const make = (kind: ModuleKind, w: number, sh: number, dr: number): ModuleInstance => ({
    id: `${run.id}-${zone.toLowerCase()}-${++n}`, zone, kind, widthMm: w, shutters: sh, drawers: dr, accessories: [],
  });
  const out: ModuleInstance[] = [];
  let r = remaining;
  if (kitchenSet && zone === 'BASE') {
    if (r >= 2400) {
      out.push(make('BASE_SINK', 900, 2, 0), make('BASE_DRAWERS', 600, 0, 3), make('BASE_HOB', 900, 0, 3));
      r -= 2400;
    } else if (r >= 1500) {
      out.push(make('BASE_SINK', 900, 2, 0), make('BASE_HOB', 600, 0, 3));
      r -= 1500;
    }
  }
  const wardrobe = item.type === 'WARDROBE';
  const { widths, filler } = fillWidths(r, zone, wardrobe);
  widths.forEach((w, i) => {
    const kind = defaultKind(item, zone);
    const drawers = wardrobe && zone === 'TALL' && i === 0 && w >= 600 ? 2 : 0;
    out.push(make(kind, w, shuttersFor(w), drawers));
  });
  if (filler > 0) out.push(make('FILLER', filler, 0, 0));
  return out;
}

const zoneModules = (run: CabinetRun, zone: Zone) => run.modules.filter((m) => m.zone === zone);
const widthOf = (ms: ModuleInstance[]) => ms.reduce((s, m) => s + m.widthMm, 0);

/**
 * Auto-fills every zone of a run to the run length. Existing non-filler
 * modules are kept in order; old fillers are dropped; new modules go after
 * them (but before a trailing corner unit, when the zone ends in one); one
 * filler absorbs what standard widths cannot. A zone already longer than the
 * run is left alone (priceModular warns).
 */
export function fillRun(run: CabinetRun, item: ModularItem): CabinetRun {
  const modules: ModuleInstance[] = [];
  const otherHasSink = item.runs.some((r) => r.id !== run.id && r.modules.some((m) => m.kind === 'BASE_SINK'));
  for (const zone of run.zones) {
    const kept = zoneModules(run, zone).filter((m) => m.kind !== 'FILLER');
    const remaining = run.lengthMm - widthOf(kept);
    if (remaining <= 0) { modules.push(...kept); continue; }
    const kitchenSet = item.type === 'KITCHEN' && !otherHasSink && !kept.some((m) => m.kind === 'BASE_SINK');
    const fill = fillZone(item, run, zone, remaining, kitchenSet, 0);
    const trailingCorner = kept.length > 1 && CORNER_KINDS.includes(kept[kept.length - 1].kind);
    if (trailingCorner) modules.push(...kept.slice(0, -1), ...fill, kept[kept.length - 1]);
    else modules.push(...kept, ...fill);
  }
  // Modules of zones not listed on the run are kept so priceModular can warn about them.
  for (const m of run.modules) if (!run.zones.includes(m.zone)) modules.push(m);
  return { ...run, modules: withUniqueIds(run.id, modules, new Set(keptIds(run))) };
}

const keptIds = (run: CabinetRun) => run.modules.filter((m) => m.kind !== 'FILLER').map((m) => m.id);

/** Kept modules keep their ids; new ones get `<run>-<zone>-<n>` with the lowest unused n. */
function withUniqueIds(runId: string, modules: ModuleInstance[], keep: Set<string>): ModuleInstance[] {
  const used = new Set([...keep]);
  return modules.map((m) => {
    if (keep.has(m.id)) return m;
    let n = 1;
    while (used.has(`${runId}-${m.zone.toLowerCase()}-${n}`)) n++;
    const id = `${runId}-${m.zone.toLowerCase()}-${n}`;
    used.add(id);
    return { ...m, id };
  });
}

// ---------------------------------------------------------------------------
// Wall geometry
// ---------------------------------------------------------------------------

interface WallFrame {
  wall: Wall;
  lengthMm: number;
  u: Vec2;
  /** Unit normal from the centreline into the room. */
  n: Vec2;
  rotationY: number;
}

function centroid(poly: Vec2[]): Vec2 {
  const s = poly.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / poly.length, z: s.z / poly.length };
}

function frameFor(wall: Wall, room?: Room): WallFrame {
  const L = wallLength(wall.start, wall.end);
  if (L < 1e-6) throw new Error(`Wall '${wall.id}' has no length`);
  const u = { x: (wall.end.x - wall.start.x) / L, z: (wall.end.z - wall.start.z) / L };
  let n = { x: -u.z, z: u.x }; // left normal; local +z for rotationY = atan2(-u.z, u.x)
  let rotationY = Math.atan2(-u.z, u.x);
  if (room && room.polygon.length >= 3) {
    const c = centroid(room.polygon);
    if ((c.x - wall.start.x) * n.x + (c.z - wall.start.z) * n.z < 0) {
      n = { x: -n.x, z: -n.z };
      rotationY = rotationY > 0 ? rotationY - Math.PI : rotationY + Math.PI;
    }
  }
  return { wall, lengthMm: L * 1000, u, n, rotationY: rotationY === -Math.PI ? Math.PI : rotationY + 0 };
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = { x: b.x - a.x, z: b.z - a.z };
  const L2 = ab.x * ab.x + ab.z * ab.z;
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / L2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.z - (a.z + ab.z * t));
}

/** Half-thickness of the thickest non-parallel wall meeting `wall` at point p (0 if none). */
function endClearanceM(walls: Wall[], wall: Wall, p: Vec2): number {
  const L = wallLength(wall.start, wall.end);
  const u = { x: (wall.end.x - wall.start.x) / L, z: (wall.end.z - wall.start.z) / L };
  let c = 0;
  for (const w of walls) {
    if (w.id === wall.id) continue;
    const wl = wallLength(w.start, w.end);
    if (wl < 1e-6) continue;
    const wu = { x: (w.end.x - w.start.x) / wl, z: (w.end.z - w.start.z) / wl };
    if (Math.abs(u.x * wu.z - u.z * wu.x) < 0.1) continue; // parallel
    if (distToSegment(p, w.start, w.end) <= w.thicknessM / 2 + 0.02) c = Math.max(c, w.thicknessM / 2);
  }
  return c;
}

const along = (wall: Wall, s: number): Vec2 => {
  const L = wallLength(wall.start, wall.end);
  return { x: wall.start.x + ((wall.end.x - wall.start.x) * s) / L, z: wall.start.z + ((wall.end.z - wall.start.z) * s) / L };
};

/** Usable stretch of a wall's inner face inside a room, mm from wall.start, clear of the walls at each end. */
export function usableSpanMm(floor: Floor | undefined, room: Room | undefined, wall: Wall): { startMm: number; endMm: number } {
  const L = wallLength(wall.start, wall.end);
  let from = 0;
  let to = L;
  if (floor && room) {
    const runs = roomWallRuns({ ...floor, walls: [wall] }, room);
    if (!runs.length) throw new Error(`Wall '${wall.id}' does not bound room '${room.name}'`);
    from = Math.min(...runs.map((r) => r.from));
    to = Math.max(...runs.map((r) => r.to));
  }
  const walls = floor?.walls ?? [];
  const c0 = endClearanceM(walls, wall, along(wall, from));
  const c1 = endClearanceM(walls, wall, along(wall, to));
  return { startMm: roundHalfAway((from + c0) * 1000), endMm: roundHalfAway((to - c1) * 1000) };
}

function findWall(project: Project, wallId: string): { floor: Floor; wall: Wall } | undefined {
  for (const floor of project.floors) {
    const wall = floor.walls.find((w) => w.id === wallId);
    if (wall) return { floor, wall };
  }
  return undefined;
}

function findRoom(project: Project, roomId: string): Room | undefined {
  for (const floor of project.floors) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return room;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Default items
// ---------------------------------------------------------------------------

export interface DefaultModularOptions {
  /** The floor the room is on — needed for wall-end clearances and room spans. */
  floor?: Floor;
  id?: string;
  layout?: ModularItem['layout'];
  hardwareTier?: HardwareTier;
  finish?: ShutterFinish;
  colorHex?: string;
  convention?: ModularItem['pricing']['convention'];
  /** Add a loft when the room is tall enough (≥ 300 mm above the top units). Default true. */
  loft?: boolean;
  /** Kitchens: add a tall (appliance) zone on the first run. Default false. */
  tall?: boolean;
  /** Cap the run length, mm (e.g. a 1800 mm wardrobe on a long wall). */
  maxLengthMm?: number;
  countertop?: ModularItem['countertop'] | null;
}

/**
 * A credible starting kitchen or wardrobe on the chosen wall(s) of a room.
 *  - Kitchen: STRAIGHT (1 wall), L (2 adjacent), PARALLEL (2 opposite) or U
 *    (3); base + wall units, loft if the ceiling allows, granite top. Where
 *    two runs meet, the earlier wall in the list owns the corner (blind corner
 *    unit) and the later run starts one base depth clear of it.
 *  - Wardrobe: one run of hinged 900/450 modules + loft on the first wall.
 * Dims follow §5.1: counter 850, base depth 600, wall units 720 high × 350 deep
 * with a 600 mm gap above the counter, wardrobe 2100 high × 600 deep.
 */
export function defaultModularItem(room: Room, wall: Wall | Wall[], type: ModularItem['type'], opts: DefaultModularOptions = {}): ModularItem {
  const walls = Array.isArray(wall) ? wall : [wall];
  if (!walls.length) throw new Error('defaultModularItem needs at least one wall');
  const kitchen = type === 'KITCHEN';
  const ceilingMm = roundHalfAway(room.ceilingHeightM * 1000);
  const counter = 850;
  const wallBottom = counter + 600;
  const wallHeight = 720;
  const tallTop = kitchen ? wallBottom + wallHeight : 2100;
  const loftHeight = Math.max(0, ceilingMm - tallTop);
  const withLoft = (opts.loft ?? true) && loftHeight >= 300;
  const id = opts.id ?? `${type.toLowerCase()}-${room.id}`;
  const finish = opts.finish ?? 'LAMINATE_MATTE';
  const zoneSpecs: ModularItem['zoneSpecs'] = {};
  const zonesUsed: Zone[] = kitchen ? ['BASE', 'WALL', ...(opts.tall ? ['TALL' as Zone] : []), ...(withLoft ? ['LOFT' as Zone] : [])] : ['TALL', ...(withLoft ? ['LOFT' as Zone] : [])];
  for (const z of zonesUsed) {
    const d = DEFAULT_SPEC[z];
    zoneSpecs[z] = { ...d, shutter: { ...d.shutter, finish, colorHex: opts.colorHex ?? d.shutter.colorHex } };
  }
  if (!kitchen) zoneSpecs.TALL = { ...zoneSpecs.TALL!, carcass: 'BWR_MR_PLY', handle: 'BAR' };

  const item: ModularItem = {
    id,
    roomId: room.id,
    type,
    ...(kitchen ? { layout: opts.layout ?? inferLayout(walls) } : {}),
    runs: [],
    zoneSpecs,
    dims: {
      counterHeightMm: counter,
      baseDepthMm: 600,
      wallHeightMm: wallHeight,
      wallDepthMm: 350,
      wallBottomMm: wallBottom,
      tallHeightMm: tallTop,
      loftHeightMm: withLoft ? loftHeight : 0,
    },
    hardwareTier: opts.hardwareTier ?? 'MID',
    ...(kitchen && opts.countertop !== null ? { countertop: opts.countertop ?? { material: 'GRANITE', ratePerSqft: 350_00 } } : {}),
    appliances: [],
    pricing: { convention: opts.convention ?? (kitchen ? 'RFT' : 'SQFT_FRONT'), installationIncluded: true },
  };

  const usedWalls = kitchen ? walls : walls.slice(0, 1);
  usedWalls.forEach((w, i) => {
    const span = usableSpanMm(opts.floor, room, w);
    let start = span.startMm;
    let end = span.endMm;
    let cornerStart = false;
    let cornerEnd = false;
    if (kitchen) {
      usedWalls.forEach((other, j) => {
        if (j === i) return;
        const atStart = distToSegment(along(w, start / 1000), other.start, other.end) <= other.thicknessM / 2 + 0.05;
        const atEnd = distToSegment(along(w, end / 1000), other.start, other.end) <= other.thicknessM / 2 + 0.05;
        if (atStart) { if (j < i) start += item.dims.baseDepthMm; else cornerStart = true; }
        if (atEnd) { if (j < i) end -= item.dims.baseDepthMm; else cornerEnd = true; }
      });
    }
    let length = end - start;
    if (opts.maxLengthMm !== undefined) length = Math.min(length, opts.maxLengthMm);
    if (length < 300) throw new Error(`Wall '${w.id}' leaves only ${length} mm for a run`);
    const runZones: Zone[] = kitchen ? ['BASE', 'WALL', ...(opts.tall && i === 0 ? ['TALL' as Zone] : []), ...(withLoft ? ['LOFT' as Zone] : [])] : ['TALL', ...(withLoft ? ['LOFT' as Zone] : [])];
    const run: CabinetRun = { id: `${id}-r${i + 1}`, wallId: w.id, offsetStartMm: start, lengthMm: length, zones: runZones, modules: [] };
    item.runs.push(buildRun(item, run, cornerStart, cornerEnd));
  });
  return item;
}

function buildRun(item: ModularItem, run: CabinetRun, cornerStart: boolean, cornerEnd: boolean): CabinetRun {
  const modules: ModuleInstance[] = [];
  const hasSink = item.runs.some((r) => r.modules.some((m) => m.kind === 'BASE_SINK'));
  for (const zone of run.zones) {
    // A tall zone shares the run with base/wall in a kitchen only as an end block: keep v1 simple, one 600 tall unit.
    if (zone === 'TALL' && item.type === 'KITCHEN') {
      modules.push({ id: '', zone, kind: 'TALL_APPLIANCE', widthMm: 600, shutters: 2, drawers: 0, accessories: [] });
      continue;
    }
    const cornerW = zone === 'BASE' ? 900 : zone === 'WALL' ? 600 : 0;
    const head: ModuleInstance[] = [];
    const tail: ModuleInstance[] = [];
    if (cornerW && cornerStart) head.push({ id: '', zone, kind: zone === 'BASE' ? 'BASE_CORNER' : 'WALL_CORNER', widthMm: cornerW, shutters: 1, drawers: 0, accessories: [] });
    if (cornerW && cornerEnd) tail.push({ id: '', zone, kind: zone === 'BASE' ? 'BASE_CORNER' : 'WALL_CORNER', widthMm: cornerW, shutters: 1, drawers: 0, accessories: [] });
    const remaining = run.lengthMm - widthOf(head) - widthOf(tail);
    const fill = remaining > 0 ? fillZone(item, run, zone, remaining, item.type === 'KITCHEN' && !hasSink, 0) : [];
    modules.push(...head, ...fill, ...tail);
  }
  const ids = new Map<Zone, number>();
  return {
    ...run,
    modules: modules.map((m) => {
      const n = (ids.get(m.zone) ?? 0) + 1;
      ids.set(m.zone, n);
      return { ...m, id: `${run.id}-${m.zone.toLowerCase()}-${n}` };
    }),
  };
}

function inferLayout(walls: Wall[]): ModularItem['layout'] {
  if (walls.length === 1) return 'STRAIGHT';
  if (walls.length >= 3) return 'U';
  const [a, b] = walls;
  const touch = [a.start, a.end].some((p) => distToSegment(p, b.start, b.end) <= b.thicknessM / 2 + 0.05);
  return touch ? 'L' : 'PARALLEL';
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

const r2 = (v: number) => roundHalfAway(v, 2);
/** qty (2 dp) × rate, rounded once to the paisa. */
const qtyTimes = (qty: number, rate: Paise): Paise => Number(divRoundBig(BigInt(roundHalfAway(qty * 100)) * BigInt(rate), 100n));

/**
 * Prices one modular item and lays out its boxes.
 *  - byZone: rft = Σ module widths in the zone (fillers included) in ft;
 *    front sq ft = Σ width × zone front height. Amount = (rft or front sq ft,
 *    per `pricing.convention`, 2 dp) × zone rate.
 *  - hardware: hinges = Σ shutters × hingesPerShutter(zone height) (lift-up
 *    wall units use a lift-up mechanism instead); channels = Σ drawers.
 *  - countertop: Σ base-run length × base depth, sq ft (2 dp) × rate.
 *  - appliances: Σ qty × rate, client-supplied ones excluded.
 * `project` supplies wall geometry for the boxes and the geometry warnings;
 * without it `boxes` is empty. (Deviation from the brief's `(item, rates?)`:
 * geometry cannot be placed without the plan.)
 */
export function priceModular(item: ModularItem, rates: ModularRates = DEFAULT_MODULAR_RATES, project?: Project): ModularBreakdown {
  const warnings: string[] = [];
  const d = item.dims;
  const zonesPresent = ZONES.filter((z) => item.runs.some((r) => r.zones.includes(z)));

  if (zonesPresent.includes('WALL') && item.type === 'KITCHEN' && d.wallBottomMm < d.counterHeightMm + MIN_COUNTER_TO_WALL_GAP_MM) {
    warnings.push(`Wall units start ${d.wallBottomMm - d.counterHeightMm} mm above the counter; keep at least ${MIN_COUNTER_TO_WALL_GAP_MM} mm`);
  }

  const byZone: ModularBreakdown['byZone'] = zonesPresent.map((zone) => {
    const mods = item.runs.flatMap((r) => (r.zones.includes(zone) ? zoneModules(r, zone) : []));
    const widthMm = widthOf(mods);
    const rft = r2((widthMm / 1000) * FT_PER_M);
    const frontSqft = r2((widthMm / 1000) * (zoneFrontHeightMm(item, zone) / 1000) * SQFT_PER_SQM);
    const rate = zoneRate(item, zone, rates);
    const amount = qtyTimes(item.pricing.convention === 'RFT' ? rft : frontSqft, rate);
    return { zone, rft, frontSqft, rate, amount };
  });

  // Hardware
  const hw = rates.hardware[item.hardwareTier];
  let hinges = 0;
  let channels = 0;
  let liftUps = 0;
  for (const run of item.runs) {
    for (const m of run.modules) {
      channels += m.drawers;
      if (m.kind === 'WALL_LIFT_UP') { liftUps += 1; continue; }
      const shutterH = m.zone === 'BASE' ? d.counterHeightMm - PLINTH_MM - COUNTERTOP_MM : zoneFrontHeightMm(item, m.zone);
      hinges += m.shutters * hingesPerShutter(shutterH);
    }
  }
  const hardwareAmount = hinges * hw.hinge + channels * hw.channel + liftUps * hw.liftUp;

  const accessories = item.runs.reduce((s, r) => s + r.modules.reduce((t, m) => t + m.accessories.reduce((u, a) => u + a.qty * a.rate, 0), 0), 0);

  const baseMm2 = item.runs.filter((r) => r.zones.includes('BASE')).reduce((s, r) => s + r.lengthMm * d.baseDepthMm, 0);
  const counterSqft = item.countertop ? r2((baseMm2 / 1e6) * SQFT_PER_SQM) : 0;
  const countertop = { sqft: counterSqft, amount: item.countertop ? qtyTimes(counterSqft, item.countertop.ratePerSqft) : 0 };

  const appliances = item.appliances.filter((a) => !a.clientSupplied).reduce((s, a) => s + a.qty * a.rate, 0);

  // Run consistency
  for (const run of item.runs) {
    for (const m of run.modules) {
      if (!run.zones.includes(m.zone)) warnings.push(`Run ${run.id}: module ${m.id} is in zone ${m.zone}, which the run does not have`);
    }
    for (const zone of run.zones) {
      const w = widthOf(zoneModules(run, zone));
      if (w > run.lengthMm) warnings.push(`Run ${run.id}: ${zone.toLowerCase()} modules are ${w - run.lengthMm} mm longer than the run`);
      else if (w < run.lengthMm) warnings.push(`Run ${run.id}: ${zone.toLowerCase()} modules leave ${run.lengthMm - w} mm unfilled`);
    }
  }

  // Geometry
  const boxes: ModularBreakdown['boxes'] = [];
  if (project) {
    const room = findRoom(project, item.roomId);
    if (!room) warnings.push(`Room '${item.roomId}' is not in the plan`);
    const ceilingMm = room ? room.ceilingHeightM * 1000 : Infinity;
    for (const run of item.runs) {
      const found = findWall(project, run.wallId);
      if (!found) { warnings.push(`Run ${run.id}: wall '${run.wallId}' is not in the plan`); continue; }
      const { floor, wall } = found;
      const frame = frameFor(wall, room);
      const span = usableSpanMm(floor, undefined, wall);
      if (run.offsetStartMm < span.startMm - 1) warnings.push(`Run ${run.id} starts ${roundHalfAway(span.startMm - run.offsetStartMm)} mm before the wall's inner corner`);
      const over = run.offsetStartMm + run.lengthMm - span.endMm;
      if (over > 1) warnings.push(`Run ${run.id} is ${roundHalfAway(over)} mm longer than the wall`);
      const wallTopMm = Math.min(wall.heightM * 1000, ceilingMm);

      for (const zone of run.zones) {
        const z = zoneBox(item, zone);
        if (z.top > wallTopMm + 1) warnings.push(`Run ${run.id}: ${zone.toLowerCase()} units reach ${roundHalfAway(z.top)} mm, above the ${roundHalfAway(wallTopMm)} mm ceiling`);
        const spec = specFor(item, zone);
        let cursor = run.offsetStartMm;
        for (const m of zoneModules(run, zone)) {
          const mid = (cursor + m.widthMm / 2) / 1000;
          const out = wall.thicknessM / 2 + z.depth / 2000;
          boxes.push({
            moduleId: m.id,
            zone,
            center: {
              x: wall.start.x + frame.u.x * mid + frame.n.x * out,
              y: (z.bottom + z.top) / 2000,
              z: wall.start.z + frame.u.z * mid + frame.n.z * out,
            },
            size: { x: m.widthMm / 1000, y: (z.top - z.bottom) / 1000, z: z.depth / 1000 },
            rotationY: frame.rotationY,
            colorHex: m.kind === 'FILLER' ? '#BDB6A8' : spec.shutter.colorHex,
          });
          cursor += m.widthMm;
        }
        // Openings the zone runs into
        for (const o of floor.openings) {
          if (o.wallId !== wall.id) continue;
          const c = o.t * frame.lengthMm;
          const lo = c - (o.widthM * 1000) / 2;
          const hi = c + (o.widthM * 1000) / 2;
          if (hi <= run.offsetStartMm || lo >= run.offsetStartMm + run.lengthMm) continue;
          const oBottom = o.sillM * 1000;
          const oTop = oBottom + o.heightM * 1000;
          if (oTop > z.bottom && oBottom < z.top) warnings.push(`Run ${run.id}: ${zone.toLowerCase()} units cross opening ${o.id}`);
        }
      }
      if (run.zones.includes('BASE') && item.countertop) {
        const mid = (run.offsetStartMm + run.lengthMm / 2) / 1000;
        const out = wall.thicknessM / 2 + d.baseDepthMm / 2000;
        boxes.push({
          moduleId: `${run.id}-countertop`,
          zone: 'BASE',
          center: { x: wall.start.x + frame.u.x * mid + frame.n.x * out, y: (d.counterHeightMm - COUNTERTOP_MM / 2) / 1000, z: wall.start.z + frame.u.z * mid + frame.n.z * out },
          size: { x: run.lengthMm / 1000, y: COUNTERTOP_MM / 1000, z: d.baseDepthMm / 1000 },
          rotationY: frame.rotationY,
          colorHex: COUNTERTOP_COLOR[item.countertop.material],
        });
      }
    }
  }

  const zonesTotal = byZone.reduce((s, z) => s + z.amount, 0);
  return {
    itemId: item.id,
    byZone,
    hardware: { hinges, channels, liftUps, amount: hardwareAmount },
    accessories,
    countertop,
    appliances,
    total: zonesTotal + hardwareAmount + accessories + countertop.amount + appliances,
    boxes,
    warnings,
  };
}

const COUNTERTOP_COLOR: Record<NonNullable<ModularItem['countertop']>['material'], string> = {
  GRANITE: '#2E2B29', QUARTZ: '#E6E3DE', SOLID_SURFACE: '#F2F0EC', SS: '#B8BCC0',
};

/** Floor area the item covers, m² (base/tall footprint) — handy for clearance checks in the UI. */
export function footprintM2(item: ModularItem): number {
  return item.runs
    .filter((r) => r.zones.includes('BASE') || r.zones.includes('TALL'))
    .reduce((s, r) => s + (r.lengthMm / 1000) * (item.dims.baseDepthMm / 1000), 0);
}

/**
 * A MODULAR quote line for an item, priced. HSN 9403 (furniture supplied as
 * goods, 18%); `id` defaults to the item id.
 */
export function modularQuoteLine(item: ModularItem, project: Project, opts: { id?: string; lineNo?: string; description?: string; optional?: boolean; rates?: ModularRates } = {}): QuoteLine {
  const breakdown = priceModular(item, opts.rates, project);
  const label = item.type === 'KITCHEN' ? `Modular kitchen${item.layout ? `, ${item.layout.toLowerCase()}` : ''}` : item.type === 'WARDROBE' ? 'Wardrobe' : item.type.replace('_', ' ').toLowerCase();
  return {
    kind: 'MODULAR',
    id: opts.id ?? item.id,
    lineNo: opts.lineNo ?? '',
    roomId: item.roomId,
    description: opts.description ?? `${label} — ${item.pricing.convention === 'RFT' ? 'priced per rft' : 'priced per sq ft of front'}`,
    item,
    breakdown,
    amount: breakdown.total,
    hsnSac: HSN_FURNITURE,
    gstRatePct: 18,
    optional: opts.optional ?? false,
  };
}
