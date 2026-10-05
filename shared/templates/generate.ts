/**
 * Generates the starter plans in shared/templates/ and their index.json.
 *
 *   npx tsx shared/templates/generate.ts
 *
 * The JSON it writes is committed — it is what the clients load — so rerun
 * this after changing a layout and commit both. Every plan is validated with
 * shared/rules.ts on the way out and the script fails rather than write a
 * template with a geometric ERROR or an NBC size WARNING.
 *
 * Plans are drawn on wall centrelines (as is sample-project.json): rooms
 * share edges with the walls that bound them, and an edge with no wall on it
 * is open-plan. External walls are 230 mm brick, internal 115 mm — the usual
 * Indian practice.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { polygonArea } from '../cost.js';
import { DEFAULT_POLICY, inferRoomKind, validatePlan } from '../rules.js';
import type {
  Catalog,
  EditPolicy,
  Opening,
  PlacedComponent,
  PlanTemplateMeta,
  Project,
  Room,
  RoofSpec,
  Surface,
  Vec2,
  Wall,
} from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, '..', 'catalog.seed.json'), 'utf8')) as Catalog;

const EXT = 0.23;
const INT = 0.115;

const cm = (v: number) => Math.round(v * 100) / 100;
const pt = (x: number, z: number): Vec2 => ({ x: cm(x), z: cm(z) });

// ---------------------------------------------------------------------------
// A tiny plan DSL
// ---------------------------------------------------------------------------

/** [id, x1, z1, x2, z2] — exterior walls are declared separately. */
type WallSpec = [string, number, number, number, number];
/** [id, name, x0, z0, x1, z1] — an axis-aligned room. */
type RoomSpec = [string, string, number, number, number, number];

type OpeningKind = 'entry' | 'door' | 'cased' | 'window' | 'wide' | 'picture' | 'vent';
/** [id, kind, wallId, centre coordinate along the wall's axis (x or z), width?] */
type OpeningSpec = [string, OpeningKind, string, number, number?];

interface PlanSpec {
  id: string;
  file: string;
  name: string;
  tagline: string;
  category: PlanTemplateMeta['category'];
  styleId: string;
  /** Footprint, origin at the north-west corner. */
  width: number;
  depth: number;
  heightM: number;
  walls: WallSpec[];
  rooms: RoomSpec[];
  openings: OpeningSpec[];
  roof: Omit<RoofSpec, 'materialId'>;
  policy?: EditPolicy;
  /** Living-room furniture: room id that gets a sofa and a pendant. */
  furnish?: string[];
}

const OPENING_KINDS: Record<OpeningKind, { componentId?: string; width: number; height: number; sill: number }> = {
  entry: { componentId: 'door-entry-walnut', width: 1.1, height: 2.4, sill: 0 },
  door: { componentId: 'door-flush-oak', width: 0.9, height: 2.1, sill: 0 },
  cased: { width: 1.2, height: 2.1, sill: 0 },
  window: { componentId: 'window-casement', width: 1.2, height: 1.4, sill: 0.9 },
  wide: { componentId: 'window-casement', width: 1.5, height: 1.4, sill: 0.9 },
  picture: { componentId: 'window-picture-large', width: 2.4, height: 2.2, sill: 0.3 },
  vent: { componentId: 'window-double-hung', width: 0.6, height: 0.6, sill: 1.5 },
};

function build(spec: PlanSpec): Project {
  const style = catalog.styles.find((s) => s.id === spec.styleId);
  if (!style) throw new Error(`${spec.id}: unknown style ${spec.styleId}`);
  const rec = (s: Surface) => {
    const id = style.recommended[s];
    if (!id) throw new Error(`${spec.styleId} has no ${s} recommendation`);
    return id;
  };
  const { width: W, depth: D, heightM: H } = spec;

  const walls: Wall[] = [];
  const exterior: WallSpec[] = [
    ['ext-n', 0, 0, W, 0],
    ['ext-e', W, 0, W, D],
    ['ext-s', W, D, 0, D],
    ['ext-w', 0, D, 0, 0],
  ];
  for (const [id, x1, z1, x2, z2] of exterior) {
    walls.push({
      id, start: pt(x1, z1), end: pt(x2, z2), heightM: H, thicknessM: EXT, exterior: true,
      interiorMaterialId: rec('WALL'), exteriorMaterialId: rec('EXTERIOR_WALL'),
    });
  }
  for (const [id, x1, z1, x2, z2] of spec.walls) {
    walls.push({
      id, start: pt(x1, z1), end: pt(x2, z2), heightM: H, thicknessM: INT, exterior: false,
      interiorMaterialId: rec('WALL'),
    });
  }

  const wet = (name: string) => {
    const k = inferRoomKind(name);
    return k === 'BATH' || k === 'WC' || k === 'BATH_WC' || k === 'KITCHEN' || k === 'KITCHEN_DINING' || /restroom|back of house|utility|counter/i.test(name);
  };
  const rooms: Room[] = spec.rooms.map(([id, name, x0, z0, x1, z1]) => ({
    id,
    name,
    polygon: [pt(x0, z0), pt(x1, z0), pt(x1, z1), pt(x0, z1)],
    ceilingHeightM: H,
    floorMaterialId: wet(name) ? (spec.styleId === 'classic-elegant' ? 'marble-carrara' : 'ceramic-tile-grey') : rec('FLOOR'),
    ceilingMaterialId: rec('CEILING'),
  }));

  const openings: Opening[] = spec.openings.map(([id, kind, wallId, at, width]) => {
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) throw new Error(`${spec.id}: opening ${id} on unknown wall ${wallId}`);
    const horizontal = Math.abs(wall.end.x - wall.start.x) > Math.abs(wall.end.z - wall.start.z);
    const L = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    const from = horizontal ? wall.start.x : wall.start.z;
    const t = Math.round((Math.abs(at - from) / L) * 10000) / 10000;
    const k = OPENING_KINDS[kind];
    return {
      id, wallId,
      ...(k.componentId ? { componentId: k.componentId } : {}),
      t, widthM: width ?? k.width, heightM: k.height, sillM: k.sill,
    };
  });

  const components: PlacedComponent[] = [];
  for (const roomId of spec.furnish ?? []) {
    const r = rooms.find((x) => x.id === roomId);
    if (!r) throw new Error(`${spec.id}: furnish unknown room ${roomId}`);
    const xs = r.polygon.map((p) => p.x);
    const zs = r.polygon.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    components.push(
      { id: `pc-sofa-${roomId}`, componentId: 'sofa-3seat', position: pt(cx, cz + 0.8), rotationDeg: 180 },
      { id: `pc-pendant-${roomId}`, componentId: 'pendant-light', position: pt(cx, cz), rotationDeg: 0 },
    );
  }

  return {
    name: spec.name,
    currency: 'INR',
    unitSystem: 'metric',
    contingencyBuffer: 0.08,
    templateId: spec.id,
    policy: spec.policy ?? { ...DEFAULT_POLICY, lockedWallIds: [] },
    roof: { ...spec.roof, materialId: rec('ROOF') },
    floors: [{ id: 'floor-0', name: 'Ground Floor', level: 0, walls, rooms, openings, components }],
  };
}

// ---------------------------------------------------------------------------
// The plans. Coordinates are metres on wall centrelines; x east, z south.
// ---------------------------------------------------------------------------

const FLAT = { kind: 'FLAT', pitchDeg: 0, overhangM: 0.3 } as const;

export const PLANS: PlanSpec[] = [
  {
    id: 'studio', file: 'studio.json', name: 'Studio Apartment',
    tagline: 'One open room, kitchenette and toilet — a 30 m² city starter.',
    category: 'STUDIO', styleId: 'scandi-minimal', width: 6, depth: 5, heightM: 2.85,
    walls: [['i1', 0, 3, 6, 3], ['i2', 1.7, 3, 1.7, 5], ['i3', 4.3, 3, 4.3, 5]],
    rooms: [
      ['r-living', 'Living / Sleeping', 0, 0, 6, 3],
      ['r-toilet', 'Toilet', 0, 3, 1.7, 5],
      ['r-kitchen', 'Kitchenette', 1.7, 3, 4.3, 5],
      ['r-entry', 'Entry', 4.3, 3, 6, 5],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-s', 5.15],
      ['o-entry-arch', 'cased', 'i1', 5.15],
      ['o-kitchen-arch', 'cased', 'i1', 3.0, 1.6],
      ['o-toilet-door', 'door', 'i1', 0.85],
      ['o-toilet-vent', 'vent', 'ext-w', 4.0],
      ['o-kitchen-win', 'window', 'ext-s', 3.0],
      ['o-living-win', 'picture', 'ext-n', 3.0],
    ],
    roof: FLAT, furnish: ['r-living'],
  },
  {
    id: '1bhk', file: '1bhk.json', name: '1 BHK Apartment',
    tagline: 'Bedroom, living, dining and kitchen with a common toilet off a small lobby.',
    category: 'APARTMENT', styleId: 'coastal-mediterranean', width: 7.6, depth: 6, heightM: 2.85,
    walls: [
      ['i1', 3.4, 0, 3.4, 3.4], ['i2', 0, 3.4, 3.4, 3.4], ['i3', 3.4, 2, 5, 2],
      ['i4', 5, 0, 5, 6], ['i5', 5, 3, 7.6, 3],
    ],
    rooms: [
      ['r-bed', 'Bedroom', 0, 0, 3.4, 3.4],
      ['r-toilet', 'Toilet', 3.4, 0, 5, 2],
      ['r-lobby', 'Lobby', 3.4, 2, 5, 3.4],
      ['r-living', 'Living', 0, 3.4, 5, 6],
      ['r-kitchen', 'Kitchen', 5, 0, 7.6, 3],
      ['r-dining', 'Dining', 5, 3, 7.6, 6],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-s', 2.5],
      ['o-living-win-s', 'window', 'ext-s', 0.9],
      ['o-living-win-w', 'window', 'ext-w', 4.7],
      ['o-bed-win', 'wide', 'ext-n', 1.7],
      ['o-bed-door', 'door', 'i1', 2.7],
      ['o-toilet-door', 'door', 'i3', 4.2],
      ['o-toilet-vent', 'vent', 'ext-n', 4.2],
      ['o-kitchen-win', 'window', 'ext-n', 6.3],
      ['o-kitchen-arch', 'cased', 'i5', 6.3],
      ['o-dining-arch', 'cased', 'i4', 4.6, 1.4],
      ['o-dining-win', 'window', 'ext-e', 4.5],
    ],
    roof: FLAT, furnish: ['r-living'],
  },
  {
    id: '2bhk-compact', file: '2bhk-compact.json', name: '2 BHK Compact',
    tagline: 'Two bedrooms around a shared toilet, open living-dining, 63 m².',
    category: 'APARTMENT', styleId: 'modern-warm', width: 9, depth: 7, heightM: 2.85,
    walls: [
      ['i1', 3.4, 0, 3.4, 3.4], ['i2', 5, 0, 5, 3.4], ['i3', 3.4, 2, 5, 2],
      ['i4', 0, 3.4, 3.4, 3.4], ['i5', 5, 3.4, 9, 3.4], ['i6', 6.4, 3.4, 6.4, 7],
    ],
    rooms: [
      ['r-bed1', 'Bedroom 1', 0, 0, 3.4, 3.4],
      ['r-toilet', 'Toilet', 3.4, 0, 5, 2],
      ['r-lobby', 'Lobby', 3.4, 2, 5, 3.4],
      ['r-bed2', 'Bedroom 2', 5, 0, 9, 3.4],
      ['r-living', 'Living / Dining', 0, 3.4, 6.4, 7],
      ['r-kitchen', 'Kitchen', 6.4, 3.4, 9, 7],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-s', 2.0],
      ['o-living-pic', 'picture', 'ext-s', 4.5],
      ['o-living-win', 'wide', 'ext-w', 5.2],
      ['o-bed1-win', 'wide', 'ext-n', 1.7],
      ['o-bed1-door', 'door', 'i1', 2.7],
      ['o-toilet-door', 'door', 'i3', 4.2],
      ['o-toilet-vent', 'vent', 'ext-n', 4.2],
      ['o-bed2-door', 'door', 'i2', 2.7],
      ['o-bed2-win-n', 'wide', 'ext-n', 7.0],
      ['o-bed2-win-e', 'window', 'ext-e', 1.7],
      ['o-kitchen-win', 'wide', 'ext-e', 5.2],
      ['o-kitchen-door', 'door', 'i6', 4.4],
    ],
    roof: FLAT, furnish: ['r-living'],
  },
  {
    id: '2bhk', file: '2bhk.json', name: '2 BHK Apartment',
    tagline: 'Both bedrooms with their own toilet, separate dining — review-gated demo.',
    category: 'APARTMENT', styleId: 'scandi-minimal', width: 10, depth: 8, heightM: 2.85,
    walls: [
      ['i1', 3.6, 0, 3.6, 3.6], ['i2', 5.4, 0, 5.4, 3.6], ['i3', 3.6, 2.2, 5.4, 2.2],
      ['spine-w', 0, 3.6, 3.6, 3.6], ['spine-e', 5.4, 3.6, 10, 3.6],
      ['i4', 8.4, 0, 8.4, 3.6], ['i5', 8.4, 2.2, 10, 2.2], ['i6', 7.6, 3.6, 7.6, 8],
    ],
    rooms: [
      ['r-bed1', 'Bedroom 1', 0, 0, 3.6, 3.6],
      ['r-toilet', 'Toilet', 3.6, 0, 5.4, 2.2],
      ['r-lobby', 'Lobby', 3.6, 2.2, 5.4, 3.6],
      ['r-bed2', 'Bedroom 2', 5.4, 0, 8.4, 3.6],
      ['r-bed2-toilet', 'Bedroom 2 Toilet', 8.4, 0, 10, 2.2],
      ['r-dress', 'Dressing', 8.4, 2.2, 10, 3.6],
      ['r-living', 'Living', 0, 3.6, 5.4, 8],
      ['r-dining', 'Dining', 5.4, 3.6, 7.6, 8],
      ['r-kitchen', 'Kitchen', 7.6, 3.6, 10, 8],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-s', 2.4],
      ['o-living-pic', 'picture', 'ext-s', 4.6],
      ['o-living-win', 'wide', 'ext-w', 5.8],
      ['o-dining-win', 'window', 'ext-s', 6.5],
      ['o-kitchen-win-e', 'wide', 'ext-e', 5.8],
      ['o-kitchen-win-s', 'window', 'ext-s', 8.8],
      ['o-kitchen-door', 'door', 'i6', 5.0],
      ['o-bed1-win-n', 'wide', 'ext-n', 1.8],
      ['o-bed1-win-w', 'window', 'ext-w', 1.8],
      ['o-bed1-door', 'door', 'i1', 2.9],
      ['o-toilet-door', 'door', 'i3', 4.5],
      ['o-toilet-vent', 'vent', 'ext-n', 4.5],
      ['o-bed2-door', 'door', 'i2', 2.9],
      ['o-bed2-win', 'wide', 'ext-n', 6.9],
      ['o-bed2-toilet-door', 'door', 'i4', 1.1],
      ['o-bed2-toilet-vent', 'vent', 'ext-n', 9.2],
      ['o-dress-arch', 'cased', 'i4', 2.9, 0.8],
    ],
    roof: FLAT, furnish: ['r-living'],
    // Demo of restricted editing: the spine wall carries the slab, and every
    // geometry change goes to review.
    policy: { level: 'LAYOUT', lockedWallIds: ['spine-w', 'spine-e'], requireReview: true },
  },
  {
    id: '3bhk', file: '3bhk.json', name: '3 BHK Apartment',
    tagline: 'Master suite with dressing, two more bedrooms, utility off the kitchen.',
    category: 'APARTMENT', styleId: 'modern-warm', width: 11.6, depth: 9.6, heightM: 2.9,
    walls: [
      ['i-master-s', 0, 3.8, 4.2, 3.8], ['i-pass-n', 4.2, 3.8, 11.6, 3.8],
      ['i1', 4.2, 0, 4.2, 3.8], ['i2', 4.2, 2.2, 6, 2.2], ['i3', 6, 0, 6, 3.8],
      ['i4', 9.6, 0, 9.6, 3.8], ['i5', 9.6, 1.6, 11.6, 1.6],
      ['i-pass-s', 4.2, 5, 11.6, 5], ['i-kitchen-w', 4.2, 5, 4.2, 9.6], ['i6', 4.2, 6.6, 6.8, 6.6],
      ['i7', 6.8, 5, 6.8, 9.6], ['i8', 10, 5, 10, 9.6], ['i9', 10, 7.4, 11.6, 7.4],
    ],
    rooms: [
      ['r-master', 'Master Bedroom', 0, 0, 4.2, 3.8],
      ['r-master-toilet', 'Master Toilet', 4.2, 0, 6, 2.2],
      ['r-master-dress', 'Master Dressing', 4.2, 2.2, 6, 3.8],
      ['r-bed2', 'Bedroom 2', 6, 0, 9.6, 3.8],
      ['r-dress2', 'Dressing 2', 9.6, 0, 11.6, 1.6],
      ['r-common-toilet', 'Common Toilet', 9.6, 1.6, 11.6, 3.8],
      ['r-living', 'Living / Dining', 0, 3.8, 4.2, 9.6],
      ['r-passage', 'Passage', 4.2, 3.8, 11.6, 5],
      ['r-utility', 'Utility', 4.2, 5, 6.8, 6.6],
      ['r-kitchen', 'Kitchen', 4.2, 6.6, 6.8, 9.6],
      ['r-bed3', 'Bedroom 3', 6.8, 5, 10, 9.6],
      ['r-bed3-toilet', 'Bedroom 3 Toilet', 10, 5, 11.6, 7.4],
      ['r-dress3', 'Dressing 3', 10, 7.4, 11.6, 9.6],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-s', 2.1],
      ['o-living-pic', 'picture', 'ext-w', 6.7],
      ['o-master-win-n', 'wide', 'ext-n', 2.1],
      ['o-master-win-w', 'wide', 'ext-w', 1.9],
      ['o-master-door', 'door', 'i-master-s', 3.4],
      ['o-master-dress-arch', 'cased', 'i1', 3.0, 0.8],
      ['o-master-toilet-door', 'door', 'i2', 5.1],
      ['o-master-toilet-vent', 'vent', 'ext-n', 5.1],
      ['o-bed2-door', 'door', 'i-pass-n', 6.8],
      ['o-bed2-win', 'wide', 'ext-n', 7.8, 1.8],
      ['o-dress2-arch', 'cased', 'i4', 0.8, 0.8],
      ['o-common-toilet-door', 'door', 'i-pass-n', 10.6],
      ['o-common-toilet-vent', 'vent', 'ext-e', 2.7],
      ['o-kitchen-door', 'door', 'i-kitchen-w', 8.1],
      ['o-kitchen-win', 'wide', 'ext-s', 5.5],
      ['o-utility-door', 'door', 'i6', 5.5],
      ['o-bed3-door', 'door', 'i-pass-s', 7.6],
      ['o-bed3-win', 'wide', 'ext-s', 8.4, 1.8],
      ['o-bed3-toilet-door', 'door', 'i8', 6.2],
      ['o-bed3-toilet-vent', 'vent', 'ext-e', 6.2],
      ['o-dress3-arch', 'cased', 'i8', 8.5, 0.8],
    ],
    roof: FLAT, furnish: ['r-living'],
  },
  {
    id: '4bhk-villa', file: '4bhk-villa.json', name: '4 BHK Villa',
    tagline: 'Detached single-storey villa: four en-suite bedrooms off a central passage, master with dressing.',
    category: 'VILLA', styleId: 'classic-elegant', width: 16, depth: 11.6, heightM: 3.0,
    walls: [
      ['i-living-e', 5.6, 0, 5.6, 4.6], ['i-dining-e', 5.6, 6, 5.6, 11.6],
      ['i-kitchen-n', 0, 9, 5.6, 9], ['i-kitchen-e', 3.6, 9, 3.6, 11.6],
      ['i-pass-n', 5.6, 4.6, 16, 4.6], ['i-pass-s', 5.6, 6, 16, 6],
      ['i1', 9.6, 0, 9.6, 4.6], ['i3', 11.4, 0, 11.4, 4.6], ['i4', 14.4, 0, 14.4, 4.6],
      ['i6', 9.6, 6, 9.6, 11.6], ['i7', 9.6, 9.2, 11.4, 9.2], ['i8', 11.4, 6, 11.4, 11.6],
      ['i9', 14.4, 6, 14.4, 11.6],
    ],
    rooms: [
      ['r-living', 'Living', 0, 0, 5.6, 6.4],
      ['r-dining', 'Dining', 0, 6.4, 5.6, 9],
      ['r-kitchen', 'Kitchen', 0, 9, 3.6, 11.6],
      ['r-utility', 'Utility', 3.6, 9, 5.6, 11.6],
      ['r-passage', 'Passage', 5.6, 4.6, 16, 6],
      ['r-bed2', 'Bedroom 2', 5.6, 0, 9.6, 4.6],
      ['r-bed2-toilet', 'Bedroom 2 Toilet', 9.6, 0, 11.4, 4.6],
      ['r-bed3', 'Bedroom 3', 11.4, 0, 14.4, 4.6],
      ['r-bed3-toilet', 'Bedroom 3 Toilet', 14.4, 0, 16, 4.6],
      ['r-master', 'Master Bedroom', 5.6, 6, 9.6, 11.6],
      ['r-master-dress', 'Master Dressing', 9.6, 6, 11.4, 9.2],
      ['r-master-toilet', 'Master Toilet', 9.6, 9.2, 11.4, 11.6],
      ['r-bed4', 'Bedroom 4', 11.4, 6, 14.4, 11.6],
      ['r-bed4-toilet', 'Bedroom 4 Toilet', 14.4, 6, 16, 11.6],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-n', 2.8],
      ['o-living-pic', 'picture', 'ext-w', 3.2],
      ['o-living-win-ne', 'wide', 'ext-n', 4.6],
      ['o-living-win-nw', 'window', 'ext-n', 1.0],
      ['o-dining-win', 'wide', 'ext-w', 7.7, 1.8],
      ['o-kitchen-door', 'door', 'i-kitchen-n', 1.8],
      ['o-kitchen-win-w', 'wide', 'ext-w', 10.3],
      ['o-kitchen-win-s', 'window', 'ext-s', 1.8],
      ['o-utility-door', 'door', 'i-kitchen-e', 10.3],
      ['o-bed2-door', 'door', 'i-pass-n', 8.6],
      ['o-bed2-pic', 'picture', 'ext-n', 7.6],
      ['o-bed2-toilet-door', 'door', 'i1', 3.5],
      ['o-bed2-toilet-vent', 'vent', 'ext-n', 10.5],
      ['o-bed3-door', 'door', 'i-pass-n', 12.4],
      ['o-bed3-win', 'wide', 'ext-n', 12.9, 1.8],
      ['o-bed3-toilet-door', 'door', 'i4', 3.6],
      ['o-bed3-toilet-vent', 'vent', 'ext-e', 1.3],
      ['o-master-door', 'door', 'i-pass-s', 7.6],
      ['o-master-pic', 'picture', 'ext-s', 7.6],
      ['o-master-dress-arch', 'cased', 'i6', 7.0, 0.8],
      ['o-master-toilet-door', 'door', 'i7', 10.5],
      ['o-master-toilet-vent', 'vent', 'ext-s', 10.5],
      ['o-bed4-door', 'door', 'i-pass-s', 12.4],
      ['o-bed4-pic', 'picture', 'ext-s', 12.9],
      ['o-bed4-toilet-door', 'door', 'i9', 7.0],
      ['o-bed4-toilet-vent', 'vent', 'ext-e', 10.3],
    ],
    roof: { kind: 'HIP', pitchDeg: 25, overhangM: 0.75 }, furnish: ['r-living'],
  },
  {
    id: 'row-house', file: 'row-house.json', name: '3 BHK Row House',
    tagline: 'Narrow 8.6 m frontage, 14 m deep: rooms either side of a central passage.',
    category: 'VILLA', styleId: 'coastal-mediterranean', width: 8.6, depth: 14, heightM: 3.0,
    walls: [
      ['i-living-s', 0, 4.6, 3.8, 4.6], ['i-pass-w', 3.8, 4.6, 3.8, 14], ['i-pass-e', 5, 8, 5, 14],
      ['i1', 0, 8.4, 3.8, 8.4], ['i2', 0, 9.9, 3.8, 9.9], ['i3', 5, 8, 8.6, 8], ['i4', 5, 11, 8.6, 11],
    ],
    rooms: [
      ['r-living', 'Living', 0, 0, 8.6, 4.6],
      ['r-bed1', 'Bedroom 1', 0, 4.6, 3.8, 8.4],
      ['r-toilet', 'Toilet', 0, 8.4, 3.8, 9.9],
      ['r-bed2', 'Bedroom 2', 0, 9.9, 3.8, 14],
      ['r-passage', 'Passage', 3.8, 4.6, 5, 14],
      ['r-dining', 'Dining', 5, 4.6, 8.6, 8],
      ['r-kitchen', 'Kitchen', 5, 8, 8.6, 11],
      ['r-bed3', 'Bedroom 3', 5, 11, 8.6, 14],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-n', 2.0],
      ['o-living-pic', 'picture', 'ext-n', 5.6],
      ['o-living-win-w', 'wide', 'ext-w', 2.3],
      ['o-living-win-e', 'wide', 'ext-e', 2.3],
      ['o-bed1-door', 'door', 'i-pass-w', 6.5],
      ['o-bed1-win', 'wide', 'ext-w', 6.5, 1.8],
      ['o-toilet-door', 'door', 'i-pass-w', 9.15],
      ['o-toilet-vent', 'vent', 'ext-w', 9.15],
      ['o-bed2-door', 'door', 'i-pass-w', 10.8],
      ['o-bed2-win-w', 'wide', 'ext-w', 12.0],
      ['o-bed2-win-s', 'wide', 'ext-s', 1.9],
      ['o-dining-win', 'wide', 'ext-e', 6.3, 1.8],
      ['o-kitchen-door', 'door', 'i-pass-e', 9.0],
      ['o-kitchen-win', 'wide', 'ext-e', 9.5, 1.8],
      ['o-bed3-door', 'door', 'i-pass-e', 12.0],
      ['o-bed3-win-e', 'wide', 'ext-e', 12.5],
      ['o-bed3-win-s', 'window', 'ext-s', 6.8],
    ],
    roof: { kind: 'GABLE', pitchDeg: 30, overhangM: 0.6 }, furnish: ['r-living'],
  },
  {
    id: 'cafe', file: 'cafe.json', name: 'Neighbourhood Café',
    tagline: 'Commercial: 45 m² seating, service counter, back of house, restroom and store.',
    category: 'COMMERCIAL', styleId: 'industrial-loft', width: 10, depth: 7, heightM: 3.2,
    walls: [['c1', 6.4, 2.4, 6.4, 7], ['c2', 6.4, 2.4, 10, 2.4], ['c3', 6.4, 5, 10, 5], ['c4', 8.2, 5, 8.2, 7]],
    rooms: [
      ['r-seating', 'Seating', 0, 0, 6.4, 7],
      ['r-counter', 'Counter', 6.4, 0, 10, 2.4],
      ['r-boh', 'Back of House', 6.4, 2.4, 10, 5],
      ['r-restroom', 'Restroom', 6.4, 5, 8.2, 7],
      ['r-store', 'Store', 8.2, 5, 10, 7],
    ],
    openings: [
      ['o-entry', 'entry', 'ext-n', 3.2, 1.2],
      ['o-seating-pic-1', 'picture', 'ext-w', 1.8],
      ['o-seating-pic-2', 'picture', 'ext-w', 5.0],
      ['o-seating-pic-s', 'picture', 'ext-s', 3.2],
      ['o-counter-win-n', 'wide', 'ext-n', 8.2],
      ['o-counter-win-e', 'window', 'ext-e', 1.2],
      ['o-boh-door', 'door', 'c2', 8.2],
      ['o-boh-win', 'window', 'ext-e', 3.7],
      ['o-restroom-door', 'door', 'c1', 6.0],
      ['o-restroom-vent', 'vent', 'ext-s', 7.3],
      ['o-store-door', 'door', 'c3', 9.1],
    ],
    roof: FLAT,
  },
];

// ---------------------------------------------------------------------------
// Output: one entity per line, 2-space indent elsewhere — readable diffs, small files.
// ---------------------------------------------------------------------------

export function formatJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (value === null || typeof value !== 'object' || flat.length <= 320) return flat;
  const next = indent + '  ';
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => next + formatJson(v, next)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${formatJson(v, next)}`).join(',\n')}\n${indent}}`;
}

export function metaFor(spec: PlanSpec, project: Project): PlanTemplateMeta {
  const rooms = project.floors.flatMap((f) => f.rooms);
  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    category: spec.category,
    bhk: rooms.filter((r) => inferRoomKind(r.name) === 'HABITABLE' && /\b(bed|bedroom|master)\b/i.test(r.name)).length,
    builtUpSqm: Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) * 100) / 100,
    rooms: rooms.length,
    styleId: spec.styleId,
    file: spec.file,
  };
}

export function buildAll(): { spec: PlanSpec; project: Project }[] {
  return PLANS.map((spec) => ({ spec, project: build(spec) }));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const index: PlanTemplateMeta[] = [];
  let failed = false;
  let total = 0;
  for (const { spec, project } of buildAll()) {
    const issues = validatePlan(project).filter((v) => v.severity !== 'INFO');
    for (const v of issues) console.log(`  ${spec.id}: ${v.severity} ${v.ruleId} — ${v.message}`);
    if (issues.some((v) => v.severity === 'ERROR' || v.ruleId === 'room.min-area' || v.ruleId === 'room.min-width')) failed = true;
    const text = formatJson(project) + '\n';
    total += Buffer.byteLength(text);
    writeFileSync(join(here, spec.file), text);
    const meta = metaFor(spec, project);
    index.push(meta);
    console.log(`${spec.file.padEnd(20)} ${String(meta.builtUpSqm).padStart(7)} m²  ${String(meta.rooms).padStart(2)} rooms  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
  }
  writeFileSync(join(here, 'index.json'), formatJson(index) + '\n');
  console.log(`total ${(total / 1024).toFixed(1)} KB`);
  if (failed) {
    console.error('Some templates break a rule; fix the layout above.');
    process.exit(1);
  }
}
