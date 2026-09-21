/**
 * 3xDezine — material cost engine.
 *
 * Pure and deterministic: the same project always produces the same breakdown.
 * Imported by the backend (to serve `POST /api/cost/estimate`) and by the web
 * client (to price an unsaved design on every edit without a round trip), so
 * the two can never disagree about a number.
 *
 * Scope is MATERIAL SUPPLY ONLY — no labour, delivery or tax. See
 * ARCHITECTURE.md > Cost engine.
 */

import type {
  Catalog,
  ComponentProduct,
  CostBreakdown,
  CostLineItem,
  Material,
  Project,
  Surface,
  Unit,
  Vec2,
} from './types.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Shoelace formula. Returns absolute area, so winding order doesn't matter. */
export function polygonArea(polygon: Vec2[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

export function wallLength(start: Vec2, end: Vec2): number {
  return Math.hypot(end.x - start.x, end.z - start.z);
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/**
 * You cannot buy 3.7194 litres of paint. Always rounds UP — rounding a material
 * order down is how a job stops halfway through.
 *
 * When the material has a `packSize`, this rounds to a whole number of packs,
 * which is what you actually pay for. Tile quoted at 23.4 m² in 1.44 m² boxes
 * means 17 boxes = 24.48 m², not 23.4. Getting this wrong understates real
 * projects by a few percent on every tiled or planked surface.
 */
function roundUpQuantity(value: number, unit: Unit, packSize?: number): number {
  if (packSize && packSize > 0) {
    const packs = Math.ceil(value / packSize - 1e-9);
    return Math.round(packs * packSize * 100) / 100;
  }
  if (unit === 'EACH') return Math.ceil(value - 1e-9);
  return Math.ceil(value * 100 - 1e-9) / 100;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Quantity -> purchasable amount
// ---------------------------------------------------------------------------

/**
 * Converts a measured surface area into the material's pricing unit.
 * Paint is priced per litre, so area becomes litres via coverage and coats.
 */
function areaToQuantity(areaSqm: number, material: Material): number {
  if (material.unit === 'LITER') {
    const coverage = material.coveragePerUnit ?? 10;
    const coats = material.coatsRecommended ?? 2;
    return (areaSqm * coats) / coverage;
  }
  return areaSqm;
}

interface Accumulator {
  material: Material;
  surface: Surface | 'COMPONENT';
  location: string;
  rawQuantity: number;
}

function makeLineItem(acc: Accumulator): CostLineItem {
  const { material } = acc;
  // Order matters: apply wastage first, then round up to whole packs. Rounding
  // to packs before adding wastage would under-order.
  const buffered = roundUpQuantity(
    acc.rawQuantity * (1 + material.wastageFactor),
    material.unit,
    material.packSize,
  );
  return {
    surface: acc.surface,
    materialId: material.id,
    materialName: material.name,
    location: acc.location,
    rawQuantity: money(acc.rawQuantity),
    unit: material.unit,
    wastageFactor: material.wastageFactor,
    bufferedQuantity: buffered,
    unitPrice: material.pricePerUnit,
    subtotal: money(buffered * material.pricePerUnit),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function estimateCost(project: Project, catalog: Catalog): CostBreakdown {
  const materials = new Map<string, Material>(catalog.materials.map((m) => [m.id, m]));
  const components = new Map<string, ComponentProduct>(
    catalog.components.map((c) => [c.id, c]),
  );

  /** Keyed by materialId + location so repeated surfaces merge into one line. */
  const accumulators = new Map<string, Accumulator>();

  const add = (
    materialId: string | undefined,
    surface: Surface | 'COMPONENT',
    location: string,
    areaSqm: number,
  ) => {
    if (!materialId || areaSqm <= 0) return;
    const material = materials.get(materialId);
    if (!material) return; // unknown id: skip rather than guess at a price
    const key = `${materialId}::${location}`;
    const quantity = areaToQuantity(areaSqm, material);
    const existing = accumulators.get(key);
    if (existing) {
      existing.rawQuantity += quantity;
    } else {
      accumulators.set(key, { material, surface, location, rawQuantity: quantity });
    }
  };

  const quantities = {
    floorAreaSqm: 0,
    wallAreaSqm: 0,
    ceilingAreaSqm: 0,
    exteriorWallAreaSqm: 0,
    roofAreaSqm: 0,
    openingAreaSqm: 0,
  };

  let footprintSqm = 0;

  for (const floor of project.floors) {
    // --- Rooms: floors and ceilings -------------------------------------
    for (const room of floor.rooms) {
      const area = polygonArea(room.polygon);
      footprintSqm += area;
      quantities.floorAreaSqm += area;
      quantities.ceilingAreaSqm += area;
      add(room.floorMaterialId, 'FLOOR', `${room.name} — floor`, area);
      add(room.ceilingMaterialId, 'CEILING', `${room.name} — ceiling`, area);
    }

    // --- Walls -----------------------------------------------------------
    // Openings are subtracted once per wall, then the remaining net face area
    // is applied to each finished face: interior walls have two inward faces,
    // exterior walls have one inward and one outward.
    const openingAreaByWall = new Map<string, number>();
    for (const opening of floor.openings) {
      const area = opening.widthM * opening.heightM;
      openingAreaByWall.set(
        opening.wallId,
        (openingAreaByWall.get(opening.wallId) ?? 0) + area,
      );
      quantities.openingAreaSqm += area;
    }

    for (const wall of floor.walls) {
      const gross = wallLength(wall.start, wall.end) * wall.heightM;
      const net = Math.max(0, gross - (openingAreaByWall.get(wall.id) ?? 0));
      if (net <= 0) continue;

      if (wall.exterior) {
        quantities.wallAreaSqm += net;
        quantities.exteriorWallAreaSqm += net;
        add(wall.interiorMaterialId, 'WALL', 'Interior wall faces', net);
        add(wall.exteriorMaterialId, 'EXTERIOR_WALL', 'Facade', net);
      } else {
        const bothFaces = net * 2;
        quantities.wallAreaSqm += bothFaces;
        add(wall.interiorMaterialId, 'WALL', 'Interior wall faces', bothFaces);
      }
    }

    // --- Components: openings that carry a product, plus placed items -----
    const componentCounts = new Map<string, number>();
    for (const opening of floor.openings) {
      if (!opening.componentId) continue; // a cased opening is a void, not a product
      componentCounts.set(
        opening.componentId,
        (componentCounts.get(opening.componentId) ?? 0) + 1,
      );
    }
    for (const placed of floor.components) {
      componentCounts.set(
        placed.componentId,
        (componentCounts.get(placed.componentId) ?? 0) + 1,
      );
    }

    for (const [componentId, count] of componentCounts) {
      const component = components.get(componentId);
      if (!component) continue;
      const key = `${componentId}::component`;
      const existing = accumulators.get(key);
      if (existing) {
        existing.rawQuantity += count;
      } else {
        // Components are priced per item, so they're modelled as a pseudo-material
        // with zero wastage — you don't buy 1.1 doors.
        accumulators.set(key, {
          material: {
            id: component.id,
            name: component.name,
            pricePerUnit: component.price,
            unit: 'EACH',
            wastageFactor: 0,
          } as Material,
          surface: 'COMPONENT',
          location: `${component.type.toLowerCase()}s`,
          rawQuantity: count,
        });
      }
    }
  }

  // --- Roof ---------------------------------------------------------------
  if (project.roof && footprintSqm > 0) {
    const { kind, pitchDeg, overhangM, materialId } = project.roof;
    let roofArea: number;
    if (kind === 'FLAT') {
      roofArea = footprintSqm;
    } else {
      // Pitched area is the footprint divided by the cosine of the pitch.
      // The overhang allowance approximates the eaves as a border strip around
      // a square-ish footprint, which is close enough for an estimate.
      const slopeFactor = 1 / Math.cos((pitchDeg * Math.PI) / 180);
      const perimeterApprox = 4 * Math.sqrt(footprintSqm);
      roofArea = (footprintSqm + perimeterApprox * overhangM) * slopeFactor;
    }
    quantities.roofAreaSqm = roofArea;
    add(materialId, 'ROOF', 'Roof', roofArea);
  }

  // --- Totals -------------------------------------------------------------
  const lineItems = [...accumulators.values()]
    .map(makeLineItem)
    .sort((a, b) => b.subtotal - a.subtotal);

  const materialsSubtotal = money(
    lineItems.reduce((sum, item) => sum + item.subtotal, 0),
  );
  const contingencyBuffer = project.contingencyBuffer ?? 0;
  const contingencyAmount = money(materialsSubtotal * contingencyBuffer);

  const perSurface: Record<string, number> = {};
  for (const item of lineItems) {
    perSurface[item.surface] = money((perSurface[item.surface] ?? 0) + item.subtotal);
  }

  for (const key of Object.keys(quantities) as (keyof typeof quantities)[]) {
    quantities[key] = money(quantities[key]);
  }

  return {
    currency: project.currency || catalog.meta.baseCurrency,
    lineItems,
    materialsSubtotal,
    contingencyBuffer,
    contingencyAmount,
    total: money(materialsSubtotal + contingencyAmount),
    perSurface,
    quantities,
  };
}
