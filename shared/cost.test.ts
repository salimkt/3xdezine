import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { estimateCost, polygonArea, wallLength } from './cost.ts';
import type { Catalog, Project } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(here, 'catalog.seed.json'), 'utf8'),
) as Catalog;
const sample = JSON.parse(
  readFileSync(join(here, 'sample-project.json'), 'utf8'),
) as Project;

/** The sample apartment is a 10 x 8 m rectangle split into five rooms. */
const FOOTPRINT_SQM = 80;

describe('geometry', () => {
  test('polygonArea uses the shoelace formula', () => {
    assert.equal(polygonArea([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }]), 12);
  });

  test('polygonArea ignores winding order', () => {
    const cw = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    assert.equal(polygonArea(cw), polygonArea([...cw].reverse()));
  });

  test('polygonArea handles an L-shaped room', () => {
    // 4x4 square with a 2x2 bite taken out of one corner => 12
    const lShape = [
      { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 },
      { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 },
    ];
    assert.equal(polygonArea(lShape), 12);
  });

  test('degenerate polygons have no area', () => {
    assert.equal(polygonArea([]), 0);
    assert.equal(polygonArea([{ x: 0, z: 0 }, { x: 1, z: 1 }]), 0);
  });

  test('wallLength is euclidean', () => {
    assert.equal(wallLength({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
  });

  test('the five sample rooms tile the footprint exactly', () => {
    const total = sample.floors[0].rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
    assert.equal(total, FOOTPRINT_SQM);
  });
});

describe('cost engine', () => {
  const result = estimateCost(sample, catalog);

  test('measures floor and ceiling area as the footprint', () => {
    assert.equal(result.quantities.floorAreaSqm, FOOTPRINT_SQM);
    assert.equal(result.quantities.ceilingAreaSqm, FOOTPRINT_SQM);
  });

  test('subtracts openings from wall area', () => {
    assert.ok(result.quantities.openingAreaSqm > 0, 'sample has 11 openings');
    // Gross wall area, computed independently of the engine.
    const gross = sample.floors[0].walls.reduce(
      (s, w) => s + wallLength(w.start, w.end) * w.heightM * (w.exterior ? 1 : 2),
      0,
    );
    assert.ok(
      result.quantities.wallAreaSqm < gross,
      'net wall area must be less than gross once openings are cut',
    );
  });

  test('a pitched roof has more area than the footprint it covers', () => {
    assert.ok(
      result.quantities.roofAreaSqm > FOOTPRINT_SQM,
      `30 degree gable over ${FOOTPRINT_SQM}m2 plus overhang should exceed it, got ${result.quantities.roofAreaSqm}`,
    );
  });

  test('prices paint in litres, not square metres', () => {
    const paint = result.lineItems.find((i) => i.materialId.startsWith('paint-'));
    assert.ok(paint, 'sample uses paint-warm-grey on interior walls');
    assert.equal(paint.unit, 'LITER');
    // 2 coats at 11 m2/L means litres must be well under the area covered.
    assert.ok(paint.rawQuantity < result.quantities.wallAreaSqm);
  });

  test('every line item is buffered upward by its wastage factor', () => {
    for (const item of result.lineItems) {
      assert.ok(
        item.bufferedQuantity >= item.rawQuantity,
        `${item.materialId}: buffered ${item.bufferedQuantity} < raw ${item.rawQuantity}`,
      );
      if (item.wastageFactor > 0 && item.rawQuantity > 0) {
        assert.ok(
          item.bufferedQuantity >= item.rawQuantity * (1 + item.wastageFactor) - 0.01,
          `${item.materialId}: wastage not applied`,
        );
      }
    }
  });

  test('discrete components are whole numbers', () => {
    const components = result.lineItems.filter((i) => i.surface === 'COMPONENT');
    assert.ok(components.length > 0, 'sample has doors, windows and furniture');
    for (const item of components) {
      assert.equal(item.unit, 'EACH');
      assert.equal(item.bufferedQuantity, Math.round(item.bufferedQuantity));
    }
  });

  test('counts a component once per opening that uses it', () => {
    // op-door-bedroom and op-door-hall both use door-flush-oak.
    const door = result.lineItems.find((i) => i.materialId === 'door-flush-oak');
    assert.ok(door);
    assert.equal(door.bufferedQuantity, 2);
  });

  test('ignores cased openings, which are voids not products', () => {
    const pass = sample.floors[0].openings.find((o) => o.id === 'op-kitchen-pass');
    assert.ok(pass && !pass.componentId, 'the kitchen pass-through has no component');
    assert.ok(result.quantities.openingAreaSqm >= pass.widthM * pass.heightM);
  });

  test('applies the contingency buffer on top of the subtotal', () => {
    const expected = Math.round(result.materialsSubtotal * 0.08 * 100) / 100;
    assert.equal(result.contingencyBuffer, 0.08);
    assert.equal(result.contingencyAmount, expected);
    assert.equal(
      result.total,
      Math.round((result.materialsSubtotal + result.contingencyAmount) * 100) / 100,
    );
  });

  test('line items sum to the subtotal', () => {
    const sum = result.lineItems.reduce((s, i) => s + i.subtotal, 0);
    assert.ok(Math.abs(sum - result.materialsSubtotal) < 0.05);
  });

  test('per-surface totals sum to the subtotal', () => {
    const sum = Object.values(result.perSurface).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - result.materialsSubtotal) < 0.05);
  });

  test('rounds up to whole packs when a material ships in boxes', () => {
    const boxed: Catalog = structuredClone(catalog);
    const tile = boxed.materials.find((m) => m.id === 'ceramic-tile-grey')!;
    tile.packSize = 1.44; // a typical tile box
    tile.packLabel = 'box';
    tile.wastageFactor = 0;

    const out = estimateCost(sample, boxed);
    const line = out.lineItems.find((i) => i.materialId === 'ceramic-tile-grey')!;

    const packs = line.bufferedQuantity / 1.44;
    assert.ok(
      Math.abs(packs - Math.round(packs)) < 1e-6,
      `expected a whole number of boxes, got ${packs}`,
    );
    assert.ok(line.bufferedQuantity >= line.rawQuantity);
  });

  test('applies wastage before pack rounding, never after', () => {
    // Rounding to packs first and then adding wastage would under-order.
    const boxed: Catalog = structuredClone(catalog);
    const tile = boxed.materials.find((m) => m.id === 'ceramic-tile-grey')!;
    tile.packSize = 1.44;
    tile.wastageFactor = 0.1;

    const out = estimateCost(sample, boxed);
    const line = out.lineItems.find((i) => i.materialId === 'ceramic-tile-grey')!;
    assert.ok(
      line.bufferedQuantity >= line.rawQuantity * 1.1 - 1e-6,
      'buffered quantity must cover raw + wastage before pack rounding',
    );
  });

  test('is deterministic', () => {
    assert.deepEqual(estimateCost(sample, catalog), estimateCost(sample, catalog));
  });

  test('skips unknown material ids rather than guessing a price', () => {
    const broken: Project = structuredClone(sample);
    broken.floors[0].rooms[0].floorMaterialId = 'no-such-material';
    const out = estimateCost(broken, catalog);
    assert.ok(out.total < result.total, 'removing a priced surface must reduce the total');
    assert.ok(out.lineItems.every((i) => i.materialId !== 'no-such-material'));
  });

  test('an empty project costs nothing', () => {
    const empty: Project = {
      name: 'Empty', currency: 'USD', unitSystem: 'metric',
      contingencyBuffer: 0.08, floors: [],
    };
    const out = estimateCost(empty, catalog);
    assert.equal(out.total, 0);
    assert.equal(out.lineItems.length, 0);
  });

  test('produces a plausible total for an 80 m2 apartment', () => {
    // Guards against an order-of-magnitude error in unit conversion, which is
    // the failure mode a user would never catch by eye.
    // Catalog is priced in INR (material supply only, ex-GST). The sample
    // scheme covers interior finishes plus the exterior envelope, and lands
    // around INR 1.3 million -- roughly INR 1,500/sqft of material for all
    // surfaces, of which the interior-only share is about INR 840/sqft. Both
    // sit well below the INR 1,200-2,500/sqft all-in (material + labour)
    // benchmark for an Indian mid-market fit-out. The band below is deliberately
    // wide: it only has to catch a 10x slip, not a pricing disagreement.
    assert.ok(
      result.total > 300_000 && result.total < 5_000_000,
      `expected a low-seven-figure INR total, got ${result.total}`,
    );
  });
});
