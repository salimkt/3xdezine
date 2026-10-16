import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { RateCard, RateCardEntry, TradeLineItem } from './business.ts';
import { estimateCost } from './cost.ts';
import { isDoor, isWindow } from './rules.ts';
import {
  WHOLE_HOUSE, applyOverrides, autoLines, deriveQuantity, floorFinishOf, fromDisplayQuantity, lineFromEntry, openingOwnerRoom,
  priceLine, printedRate, quantifyLine, toDisplayQuantity,
} from './trades.ts';
import type { Catalog, PlanTemplateMeta, Project } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const load = <T>(p: string) => JSON.parse(readFileSync(join(here, p), 'utf8')) as T;
const sample = load<Project>('sample-project.json');
const catalog = load<Catalog>('catalog.seed.json');
const card = load<RateCard>('ratecards/metro-mid-2026.json');
const index = load<PlanTemplateMeta[]>('templates/index.json');
const templates = index.map((m) => ({ meta: m, project: load<Project>(`templates/${m.file}`) }));

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('room quantities on the sample apartment (hand-computed)', () => {
  // 10 × 8 m, walls 2.7 m high. Living 0..6 × 0..5; Kitchen 6..10 × 0..5; Bedroom 0..5.5 × 5..8;
  // Bathroom 5.5..8 × 5..8; Entry Hall 8..10 × 5..8.
  test('floor and ceiling area are the polygon area', () => {
    assert.equal(deriveQuantity({ kind: 'FLOOR_AREA' }, sample, 'room-living').base, 30, 'living floor');
    assert.equal(deriveQuantity({ kind: 'CEILING_AREA' }, sample, 'room-bathroom').base, 7.5, 'bath ceiling');
    assert.equal(deriveQuantity({ kind: 'FLOOR_AREA' }, sample).base, 80, 'whole house');
  });

  test('living room walls: 22 m of wall × 2.7 m, minus four openings', () => {
    const gross = deriveQuantity({ kind: 'WALL_AREA', deductOpenings: false }, sample, 'room-living');
    check(near(gross.base, 22 * 2.7), `gross ${gross.base}`);
    // North picture window 2.4×2.2 = 5.28; west casement 1.2×1.4 = 1.68; kitchen pass-through 1.6×2.2 = 3.52;
    // bedroom door on int-2 at x = 2: 0.9×2.1 = 1.89. Total 12.37 → 47.03 m².
    const net = deriveQuantity({ kind: 'WALL_AREA', deductOpenings: true }, sample, 'room-living');
    check(near(net.base, 59.4 - 12.37), `net ${net.base}`);
    assert.equal(net.unitBase, 'M2', 'unit base');
    check(/4 openings 12\.37 m²/.test(net.formula), `formula traces openings: ${net.formula}`);
    assert.equal(toDisplayQuantity(net.base, 'SQFT'), 506.23, '47.03 m² = 506.23 sq ft');
  });

  test('kitchen and bathroom walls', () => {
    // Kitchen: 18 m × 2.7 = 48.6; window 1.68 + pass-through 3.52 + hall door 1.89 = 7.09.
    check(near(deriveQuantity({ kind: 'WALL_AREA', deductOpenings: true }, sample, 'room-kitchen').base, 41.51), 'kitchen');
    // Bathroom: 11 m × 2.7 = 29.7; window 1.0×1.4 = 1.4 + door 1.89 = 3.29.
    check(near(deriveQuantity({ kind: 'WALL_AREA', deductOpenings: true }, sample, 'room-bathroom').base, 26.41), 'bathroom');
  });

  test('perimeter deducts floor-level openings only when asked', () => {
    assert.equal(deriveQuantity({ kind: 'PERIMETER', deductDoors: false }, sample, 'room-living').base, 22, 'living gross');
    // Living: bedroom door 0.9 + cased pass-through 1.6 (no skirting across either).
    check(near(deriveQuantity({ kind: 'PERIMETER', deductDoors: true }, sample, 'room-living').base, 19.5), 'living net');
    // Hall: entry 1.1 + hall door 0.9 + bath door 0.9.
    check(near(deriveQuantity({ kind: 'PERIMETER', deductDoors: true }, sample, 'room-hall').base, 7.1), 'hall net');
    assert.equal(toDisplayQuantity(19.5, 'RFT'), 63.98, '19.5 m = 63.98 rft');
  });

  test('each door and window is counted in exactly one room', () => {
    const count = (of: 'DOOR' | 'WINDOW', id: string) => deriveQuantity({ kind: 'COUNT_OPENINGS', of }, sample, id).base;
    // Toilet door → toilet (not the smaller hall); bedroom door → bedroom (smaller of two habitable rooms);
    // hall/kitchen door → kitchen (more private than circulation); entry door → hall.
    assert.deepEqual(
      ['room-living', 'room-kitchen', 'room-bedroom', 'room-bathroom', 'room-hall'].map((r) => count('DOOR', r)),
      [0, 1, 1, 1, 1],
      'doors per room',
    );
    assert.deepEqual(
      ['room-living', 'room-kitchen', 'room-bedroom', 'room-bathroom', 'room-hall'].map((r) => count('WINDOW', r)),
      [2, 1, 1, 1, 1],
      'windows per room',
    );
    assert.equal(deriveQuantity({ kind: 'COUNT_OPENINGS', of: 'DOOR' }, sample).base, 4, 'whole-house doors (the pass-through is not a door)');
    const floor = sample.floors[0];
    assert.equal(openingOwnerRoom(floor, floor.openings.find((o) => o.id === 'op-door-bath')!)?.id, 'room-bathroom', 'bath door owner');
  });

  test('points per room by inferred kind, with fallback', () => {
    const rule = { kind: 'POINTS_PER_ROOM' as const, byRoomKind: { HABITABLE: 4, KITCHEN: 3 }, fallback: 2 };
    assert.equal(deriveQuantity(rule, sample, 'room-living').base, 4, 'living is habitable');
    assert.equal(deriveQuantity(rule, sample, 'room-kitchen').base, 3, 'kitchen');
    assert.equal(deriveQuantity(rule, sample, 'room-hall').base, 2, 'hall falls back');
    assert.equal(deriveQuantity(rule, sample).base, 4 + 3 + 4 + 2 + 2, 'whole house sums rooms');
  });

  test('FIXED and MANUAL, and unknown rooms', () => {
    assert.equal(deriveQuantity({ kind: 'FIXED', quantity: 3 }, sample).base, 3, 'fixed');
    assert.equal(deriveQuantity({ kind: 'MANUAL' }, sample, 'room-living').base, 0, 'manual has no derived quantity');
    assert.throws(() => deriveQuantity({ kind: 'FLOOR_AREA' }, sample, 'nope'), /not in the plan/);
  });
});

describe('room quantities reconcile with cost.ts on every template', () => {
  test('Σ room wall areas = cost.ts wall area (net of openings), doors and windows counted once', () => {
    for (const { meta, project } of [{ meta: { id: 'sample' }, project: sample }, ...templates]) {
      const net = deriveQuantity({ kind: 'WALL_AREA', deductOpenings: true }, project).base;
      assert.equal(Math.round(net * 100) / 100, estimateCost(project, catalog).quantities.wallAreaSqm, `${meta.id} wall area`);
      const floorArea = deriveQuantity({ kind: 'FLOOR_AREA' }, project).base;
      assert.equal(Math.round(floorArea * 100) / 100, estimateCost(project, catalog).quantities.floorAreaSqm, `${meta.id} floor area`);
      for (const of of ['DOOR', 'WINDOW'] as const) {
        const test = of === 'DOOR' ? isDoor : isWindow;
        const total = project.floors.reduce((s, f) => s + f.openings.filter(test).length, 0);
        const perRoom = project.floors.flatMap((f) => f.rooms).reduce((s, r) => s + deriveQuantity({ kind: 'COUNT_OPENINGS', of }, project, r.id).base, 0);
        assert.equal(perRoom, total, `${meta.id} ${of} counted once`);
      }
    }
  });
});

describe('display quantities', () => {
  test('areas and lengths to 2 dp after conversion; counts up; LS = 1', () => {
    assert.equal(toDisplayQuantity(1, 'SQFT'), 10.76, '1 m²');
    assert.equal(toDisplayQuantity(1, 'SQM'), 1, 'sqm');
    assert.equal(toDisplayQuantity(3.048, 'RFT'), 10, '10 ft');
    assert.equal(toDisplayQuantity(2.345, 'RMT'), 2.35, 'rmt half away');
    assert.equal(toDisplayQuantity(2.2, 'POINT'), 3, 'points round up');
    assert.equal(toDisplayQuantity(3, 'NOS'), 3, 'exact count stays');
    assert.equal(toDisplayQuantity(3.0000000001, 'NOS'), 3, 'float noise does not add a unit');
    assert.equal(toDisplayQuantity(0.1, 'SET'), 1, 'sets round up');
    assert.equal(toDisplayQuantity(57.3, 'LS'), 1, 'lump sum');
    assert.equal(toDisplayQuantity(0, 'SQFT'), 0, 'zero');
    check(near(fromDisplayQuantity(10.76, 'SQFT'), 10.76 / 10.7639), 'back to m²');
  });

  test('quantifyLine refuses a unit that does not fit the rule', () => {
    assert.throws(
      () => quantifyLine({ rule: { kind: 'WALL_AREA', deductOpenings: true }, unit: 'RFT', roomId: 'room-living', quantityDisplay: 0, description: 'Paint' }, sample),
      /gives M2 but the unit is RFT/,
    );
    const ls = quantifyLine({ rule: { kind: 'FLOOR_AREA' }, unit: 'LS', roomId: 'room-living', quantityDisplay: 0, description: 'Clean' }, sample);
    assert.equal(ls.quantityDisplay, 1, 'LS takes any rule and is 1');
    const manual = quantifyLine({ rule: { kind: 'MANUAL' }, unit: 'NOS', quantityDisplay: 2.4, description: 'x' }, sample);
    assert.equal(manual.quantityDisplay, 3, 'manual count rounds up');
    const fixed = quantifyLine({ rule: { kind: 'FIXED', quantity: 12.345 }, unit: 'SQFT', quantityDisplay: 0, description: 'x' }, sample);
    assert.equal(fixed.quantityDisplay, 12.35, 'fixed is in the line unit');
  });
});

describe('pricing', () => {
  const base = { quantityDisplay: 100, materialRate: 70_00, labourRate: 40_00, markupPct: 0, discountPct: 0, clientSupplied: false };

  test('qty × (material + labour)', () => {
    assert.equal(priceLine(base), 11_000_00, '100 sq ft × ₹110');
    assert.equal(priceLine({ ...base, quantityDisplay: 322.92 }), 35_521_20, '322.92 × ₹110');
  });

  test('markup lives inside the printed rate only; amount reconciles with Qty × Rate', () => {
    const line = { ...base, quantityDisplay: 33.33, markupPct: 25 };
    const rate = printedRate(line);
    assert.equal(rate, 137_50, '₹110 × 1.25');
    const amount = priceLine(line);
    assert.equal(amount, 4_582_88, '33.33 × ₹137.50 = ₹4,582.875 → ₹4,582.88');
  });

  test('discount, client-supplied material, rounding', () => {
    assert.equal(priceLine({ ...base, discountPct: 10 }), 9_900_00, '10% off');
    assert.equal(priceLine({ ...base, clientSupplied: true }), 4_000_00, 'labour only');
    // 1.5 × 33 paise = 49.5 → 50 (half away from zero, once).
    assert.equal(priceLine({ ...base, quantityDisplay: 1.5, materialRate: 33, labourRate: 0 }), 50, 'one rounding');
    assert.equal(priceLine({ ...base, quantityDisplay: -1.5, materialRate: 33, labourRate: 0 }), -50, 'negative rounds away from zero');
    assert.equal(priceLine({ ...base, quantityDisplay: -2 }), -220_00, 'credits are negative');
    assert.throws(() => priceLine({ ...base, discountPct: 120 }), /Discount/);
    assert.throws(() => priceLine({ ...base, materialRate: 70.5 }), /integer/);
  });
});

describe('rate card', () => {
  test('default card is honest, compact and complete', () => {
    const raw = readFileSync(join(here, 'ratecards/metro-mid-2026.json'));
    check(raw.length <= 30 * 1024, `≤ 30 KB (is ${raw.length})`);
    check(card.entries.length >= 40 && card.entries.length <= 60, `40–60 entries (${card.entries.length})`);
    check(/planning ranges/i.test(card.description ?? '') && /edit/i.test(card.description ?? ''), 'description says planning ranges, to be edited');
    assert.equal(new Set(card.entries.map((e) => e.id)).size, card.entries.length, 'unique ids');
    const trades = new Set(card.entries.map((e) => e.trade));
    for (const t of ['CIVIL', 'WATERPROOFING', 'FALSE_CEILING', 'ELECTRICAL', 'PLUMBING', 'FLOORING', 'PAINTING', 'CARPENTRY', 'WARDROBE', 'SANITARY', 'LIGHTING', 'LOOSE_FURNITURE']) {
      check(trades.has(t as RateCardEntry['trade']), `covers ${t}`);
    }
    for (const e of card.entries) {
      check(Number.isInteger(e.materialRate) && Number.isInteger(e.labourRate), `${e.id} rates in paise`);
      check(e.materialRate + e.labourRate > 0, `${e.id} has a rate`);
      check(['LOW', 'MEDIUM', 'HIGH'].includes(e.source.confidence) && e.source.name && e.source.asOf, `${e.id} source`);
      check(e.source.confidence !== 'HIGH', `${e.id}: nothing in the research is HIGH confidence`);
      check(/^\d{4,8}$/.test(e.hsnSac), `${e.id} HSN/SAC`);
      assert.equal(e.gstRatePct, 18, `${e.id} at 18%`);
      if (e.supplyNature === 'WORKS_CONTRACT') check(e.hsnSac.startsWith('9954'), `${e.id}: works contracts under SAC 9954`);
      if (e.supplyNature === 'GOODS') check(!e.hsnSac.startsWith('99'), `${e.id}: goods carry an HSN, not a SAC`);
      check(e.trade !== 'DESIGN_FEE', 'design fee is not a rate-card line');
      if (e.autoApplyTo) check(e.defaultRule.kind !== 'MANUAL', `${e.id}: auto entries need a derivable rule`);
    }
  });

  test('labour share is 30–45% for the trades the research splits', () => {
    for (const id of ['FC-GYP-PLAIN', 'PT-WALL', 'PT-CEILING', 'CP-WARDROBE', 'CP-SHUTTER', 'FL-VIT', 'EL-LIGHT-PT']) {
      const e = card.entries.find((x) => x.id === id)!;
      const share = e.labourRate / (e.labourRate + e.materialRate);
      check(share >= 0.3 && share <= 0.45, `${id} labour share ${share.toFixed(2)}`);
    }
  });

  test('gypsum ceiling and painting sit at the research midpoints', () => {
    const rate = (id: string) => { const e = card.entries.find((x) => x.id === id)!; return (e.materialRate + e.labourRate) / 100; };
    check(rate('FC-GYP-PLAIN') >= 75 && rate('FC-GYP-PLAIN') <= 160, 'gypsum within ₹75–160');
    check(rate('PT-WALL') >= 19 && rate('PT-WALL') <= 32, 'paint within ₹19–32');
    check(rate('EL-16A-PT') >= 1656 && rate('EL-16A-PT') <= 2555, '16A within ₹1,656–2,555');
  });

  test('applyOverrides: override, disable, add, replace', () => {
    const studio = applyOverrides(card, {
      baseCardId: card.id,
      overrides: { 'PT-WALL': { labourRate: 13_00, makeList: ['Asian Paints Royale'] }, 'NOT-THERE': { labourRate: 1 } },
      disabled: ['FC-POP'],
      added: [
        { ...card.entries[0], id: 'MY-ITEM', description: 'My item' },
        { ...card.entries.find((e) => e.id === 'CP-DOOR')!, materialRate: 20_000_00 },
      ],
    });
    const pt = studio.entries.find((e) => e.id === 'PT-WALL')!;
    assert.equal(pt.labourRate, 13_00, 'override applied');
    assert.equal(pt.materialRate, 15_00, 'other fields kept');
    check(!studio.entries.some((e) => e.id === 'FC-POP'), 'disabled removed');
    assert.equal(studio.entries.at(-1)!.id, 'MY-ITEM', 'added appended');
    assert.equal(studio.entries.find((e) => e.id === 'CP-DOOR')!.materialRate, 20_000_00, 'added replaces in place');
    assert.equal(studio.entries.length, card.entries.length, 'one removed, one added');
    assert.equal(card.entries.find((e) => e.id === 'PT-WALL')!.labourRate, 11_00, 'base card untouched');
    assert.throws(() => applyOverrides(card, { baseCardId: 'other', overrides: {}, added: [], disabled: [] }), /not 'metro-mid-2026'/);
  });
});

describe('autoLines', () => {
  const lines = autoLines(sample, card);
  const ids = (room: string) => lines.filter((l) => l.roomId === room).map((l) => l.rateCardEntryId);

  test('seeds a sensible room-wise BOQ', () => {
    check(ids('room-living').includes('FC-GYP-PLAIN'), 'false ceiling in living');
    check(ids('room-bedroom').includes('FC-GYP-PLAIN'), 'false ceiling in bedroom');
    check(!ids('room-kitchen').includes('FC-GYP-PLAIN'), 'no gypsum ceiling in the kitchen');
    check(ids('room-bathroom').includes('FC-PVC-BATH'), 'PVC ceiling in the toilet');
    check(ids('room-living').includes('PT-WALL') && ids('room-living').includes('PT-CEILING'), 'painting walls and ceilings');
    check(!ids('room-bathroom').includes('PT-WALL'), 'toilet walls are tiled, not painted');
    check(ids('room-bathroom').includes('FL-BATH-DADO') && ids('room-bathroom').includes('WP-BATH'), 'toilet dado and waterproofing');
    check(ids('room-living').includes('FL-SKIRT') && !ids('room-bathroom').includes('FL-SKIRT'), 'skirting in dry rooms');
    check(ids('room-kitchen').includes('EL-16A-PT') && ids('room-kitchen').includes('PL-POINT'), 'kitchen power and plumbing');
    check(ids('room-bathroom').includes('SN-EWC') && ids('room-bathroom').includes('SN-CP-SET'), 'sanitaryware in the toilet');
    check(ids('room-bedroom').includes('CP-DOOR') && !ids('room-living').includes('CP-DOOR'), 'doors where they are owned');
    check(ids('room-living').includes('DC-CURTAIN'), 'curtain track per window');
    check(lines.some((l) => l.rateCardEntryId === 'EL-DB' && l.roomId === undefined), 'one whole-house DB');
    check(!lines.some((l) => l.trade === 'DESIGN_FEE'), 'design fee is not a line');
    check(lines.every((l) => l.quantityDisplay > 0 && l.amount > 0), 'no zero lines');
    assert.equal(new Set(lines.map((l) => l.id)).size, lines.length, 'unique line ids');
  });

  test('flooring follows the room floor material', () => {
    // Living, bedroom and hall are oak (WOOD); the kitchen is ceramic (TILE); the toilet gets anti-skid.
    check(ids('room-living').includes('FL-WOOD') && !ids('room-living').includes('FL-VIT'), 'living wood');
    check(ids('room-kitchen').includes('FL-VIT') && !ids('room-kitchen').includes('FL-WOOD'), 'kitchen tile');
    check(ids('room-bathroom').includes('FL-BATH-AS') && !ids('room-bathroom').includes('FL-VIT'), 'toilet anti-skid');
    assert.equal(floorFinishOf('laminate-oak'), 'LAMINATE', 'laminate before wood');
    assert.equal(floorFinishOf('marble-carrara'), 'STONE', 'marble');
    assert.equal(floorFinishOf('polished-concrete', catalog), 'CONCRETE', 'concrete');
    assert.equal(floorFinishOf('bamboo-floor', catalog), 'WOOD', 'bamboo');
    assert.equal(floorFinishOf(undefined), undefined, 'none');
  });

  test('lines carry the derived quantities and prices', () => {
    const paint = lines.find((l) => l.id === 'PT-WALL@room-living')!;
    assert.equal(paint.quantityDisplay, 506.23, 'from the wall area');
    assert.equal(paint.amount, 13_161_98, '506.23 × ₹26 = ₹13,161.98');
    assert.equal(paint.unit, 'SQFT', 'unit');
    assert.equal(paint.hsnSac, '995473', 'painting SAC');
    const db = lines.find((l) => l.rateCardEntryId === 'EL-DB')!;
    assert.equal(db.id, 'EL-DB@house', 'whole-house id');
    assert.equal(db.quantityDisplay, 1, 'one DB');
  });

  test('every template seeds lines in every room that has any', () => {
    for (const { meta, project } of templates) {
      const ls: TradeLineItem[] = autoLines(project, card, { catalog });
      check(ls.length > 20, `${meta.id}: ${ls.length} lines`);
      for (const r of project.floors.flatMap((f) => f.rooms)) {
        check(ls.some((l) => l.roomId === r.id), `${meta.id}: ${r.name} has lines`);
      }
    }
  });

  test('lineFromEntry and WHOLE_HOUSE', () => {
    const e = card.entries.find((x) => x.id === 'MS-CLEAN')!;
    check(e.autoApplyTo?.includes(WHOLE_HOUSE), 'cleaning is whole-house');
    const l = lineFromEntry(e, sample);
    assert.equal(l.quantityDisplay, 861.11, '80 m² = 861.11 sq ft');
    assert.equal(l.amount, 6_888_88, '861.11 × ₹8 = ₹6,888.88');
  });
});
