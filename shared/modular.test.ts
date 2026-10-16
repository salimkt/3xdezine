import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ModularItem } from './business.ts';
import {
  DEFAULT_MODULAR_RATES, defaultModularItem, fillRun, hingesPerShutter, modularQuoteLine, priceModular, usableSpanMm, zoneRate,
} from './modular.ts';
import type { Floor, Project, Wall } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(here, 'sample-project.json'), 'utf8')) as Project;

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);
const mm = (a: number, b: number, what: string) => check(Math.abs(a - b) <= 0.001, `${what}: ${a} vs ${b} (±1 mm)`);

/**
 * A 3.248 × 3 m kitchen with 200 mm walls on the room's edges, so the north
 * wall's usable inner face is 3.248 − 0.1 − 0.1 = 3.048 m = exactly 10 ft.
 */
const W = 3.248;
const wall = (id: string, sx: number, sz: number, ex: number, ez: number): Wall => ({
  id, start: { x: sx, z: sz }, end: { x: ex, z: ez }, heightM: 2.7, thicknessM: 0.2, exterior: true,
});
const floor: Floor = {
  id: 'f0', name: 'Ground', level: 0,
  walls: [wall('n', 0, 0, W, 0), wall('e', W, 0, W, 3), wall('s', W, 3, 0, 3), wall('w', 0, 3, 0, 0)],
  rooms: [{ id: 'k', name: 'Kitchen', polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 3 }, { x: 0, z: 3 }], ceilingHeightM: 2.7 }],
  openings: [],
  components: [],
};
const project: Project = { name: 'Test kitchen', currency: 'INR', unitSystem: 'metric', contingencyBuffer: 0, floors: [floor] };
const room = floor.rooms[0];
const wallById = (id: string) => floor.walls.find((w) => w.id === id)!;

const kitchen = (convention: ModularItem['pricing']['convention'] = 'RFT') =>
  defaultModularItem(room, wallById('n'), 'KITCHEN', { floor, loft: false, convention });

describe('defaultModularItem: 10 ft straight kitchen', () => {
  const item = kitchen();
  const run = item.runs[0];

  test('run sits on the usable inner face of the wall', () => {
    assert.deepEqual(usableSpanMm(floor, room, wallById('n')), { startMm: 100, endMm: 3148 }, 'clear of the side walls');
    assert.equal(item.layout, 'STRAIGHT', 'layout');
    assert.equal(run.offsetStartMm, 100, 'offset');
    assert.equal(run.lengthMm, 3048, '10 ft');
    assert.deepEqual(run.zones, ['BASE', 'WALL'], 'zones');
    check(item.dims.wallBottomMm >= item.dims.counterHeightMm + 450, 'wall units ≥ counter + 450');
  });

  test('modules: working set, standard widths, filler', () => {
    const z = (zone: string) => run.modules.filter((m) => m.zone === zone).map((m) => `${m.kind}:${m.widthMm}:${m.shutters}/${m.drawers}`);
    assert.deepEqual(z('BASE'), ['BASE_SINK:900:2/0', 'BASE_DRAWERS:600:0/3', 'BASE_HOB:900:0/3', 'BASE:600:2/0', 'FILLER:48:0/0'], 'base');
    assert.deepEqual(z('WALL'), ['WALL:600:2/0', 'WALL:600:2/0', 'WALL:600:2/0', 'WALL:600:2/0', 'WALL:600:2/0', 'FILLER:48:0/0'], 'wall');
    assert.equal(new Set(run.modules.map((m) => m.id)).size, run.modules.length, 'unique module ids');
  });

  test('RFT pricing, hand-checked', () => {
    const b = priceModular(item, undefined, project);
    // Base: BWP ₹6,500 × 1.12 = ₹7,280/rft × 10.00 rft = ₹72,800. Wall: MR ₹4,000 × 10 = ₹40,000.
    assert.deepEqual(b.byZone.map((z) => [z.zone, z.rft, z.rate, z.amount]), [['BASE', 10, 7_280_00, 72_800_00], ['WALL', 10, 4_000_00, 40_000_00]], 'zones');
    // Hinges: 4 base shutters (710 mm) × 2 + 10 wall shutters (720 mm) × 2 = 28; channels = 3 + 3 drawers.
    assert.deepEqual(b.hardware, { hinges: 28, channels: 6, liftUps: 0, amount: 28 * 250_00 + 6 * 800_00 }, 'hardware ₹11,800');
    // Countertop: 3.048 × 0.6 m = 1.8288 m² = 19.685 → 19.69 sq ft × ₹350 = ₹6,891.50.
    assert.deepEqual(b.countertop, { sqft: 19.69, amount: 6_891_50 }, 'countertop');
    assert.equal(b.total, 72_800_00 + 40_000_00 + 11_800_00 + 6_891_50, 'total ₹1,31,491.50');
    assert.deepEqual(b.warnings, [], 'no warnings');
  });

  test('SQFT_FRONT pricing, hand-checked', () => {
    const b = priceModular(kitchen('SQFT_FRONT'), undefined, project);
    // Base front 3.048 × 0.85 m = 2.5908 m² = 27.887 → 27.89 sq ft; rate ₹1,450 × 1.12 = ₹1,624 → ₹1,620 (₹10 steps).
    // Wall front 3.048 × 0.72 m = 2.19456 m² = 23.622 → 23.62 sq ft × ₹1,250.
    assert.deepEqual(b.byZone.map((z) => [z.zone, z.frontSqft, z.rate, z.amount]), [['BASE', 27.89, 1_620_00, 45_181_80], ['WALL', 23.62, 1_250_00, 29_525_00]], 'zones');
    assert.equal(b.total, 45_181_80 + 29_525_00 + 11_800_00 + 6_891_50, 'total ₹93,398.30');
  });

  test('accessories, appliances (client-supplied excluded), overrides, installation', () => {
    const it = kitchen();
    it.runs[0].modules[1].accessories.push({ sku: 'CT-1', name: 'Cutlery tray', qty: 1, rate: 2_500_00, hsn: '9403' });
    it.appliances.push(
      { kind: 'CHIMNEY', name: 'Chimney 90 cm', qty: 1, rate: 18_000_00, hsn: '8414', clientSupplied: false },
      { kind: 'HOB', name: 'Hob 3 burner', qty: 1, rate: 12_000_00, hsn: '7321', clientSupplied: true },
    );
    const b = priceModular(it, undefined, project);
    assert.equal(b.accessories, 2_500_00, 'accessories');
    assert.equal(b.appliances, 18_000_00, 'client-supplied hob excluded');
    assert.equal(b.total, 1_31_491_50 + 2_500_00 + 18_000_00, 'total');
    it.pricing.rateOverrides = { BASE: 5_000_00 };
    assert.equal(zoneRate(it, 'BASE'), 5_000_00, 'override wins');
    const noInstall = { ...kitchen(), pricing: { convention: 'RFT' as const, installationIncluded: false } };
    assert.equal(zoneRate(noInstall, 'BASE'), 6_700_00, '₹7,280 × 0.92 = ₹6,697.60 → ₹6,700');
    const premium = { ...kitchen(), hardwareTier: 'PREMIUM' as const };
    assert.equal(zoneRate(premium, 'BASE'), 7_640_00, '₹7,280 × 1.05 = ₹7,644 → ₹7,640');
    assert.equal(priceModular(premium).hardware.amount, 28 * 400_00 + 6 * 4_500_00, 'premium hardware');
    const acrylic: ModularItem = { ...kitchen(), zoneSpecs: { ...kitchen().zoneSpecs, BASE: { ...kitchen().zoneSpecs.BASE!, shutter: { substrate: 'MDF', finish: 'ACRYLIC', colorHex: '#FFFFFF' } } } };
    assert.equal(zoneRate(acrylic, 'BASE'), 10_920_00, '₹6,500 × 1.12 × 1.5');
  });

  test('lift-up wall units use a lift mechanism instead of hinges', () => {
    const it = kitchen();
    const w = it.runs[0].modules.find((m) => m.zone === 'WALL')!;
    w.kind = 'WALL_LIFT_UP';
    const b = priceModular(it);
    assert.equal(b.hardware.liftUps, 1, 'one lift-up');
    assert.equal(b.hardware.hinges, 28 - 4, 'its two shutters need no hinges');
    assert.deepEqual(b.boxes, [], 'no boxes without the plan');
  });

  test('boxes sit against the wall inner face (±1 mm)', () => {
    const b = priceModular(item, undefined, project);
    const box = (id: string) => b.boxes.find((x) => x.moduleId === id)!;
    const sink = box(`${run.id}-base-1`);
    // Sink 900 wide starts at 100 mm: centre along the wall 0.55 m; inner face z = 0.1, depth 0.6 → z = 0.4;
    // plinth 100 to counter − top 810 → y = 0.455, height 0.71.
    mm(sink.center.x, 0.55, 'sink x'); mm(sink.center.z, 0.4, 'sink z'); mm(sink.center.y, 0.455, 'sink y');
    mm(sink.size.x, 0.9, 'sink w'); mm(sink.size.y, 0.71, 'sink h'); mm(sink.size.z, 0.6, 'sink d');
    assert.equal(sink.rotationY, 0, 'aligned with +x');
    const wall1 = box(`${run.id}-wall-1`);
    // Wall unit 600: centre 0.4; depth 0.35 → z = 0.275; 1450–2170 mm → y = 1.81.
    mm(wall1.center.x, 0.4, 'wall x'); mm(wall1.center.z, 0.275, 'wall z'); mm(wall1.center.y, 1.81, 'wall y');
    mm(wall1.size.y, 0.72, 'wall h'); mm(wall1.size.z, 0.35, 'wall d');
    const last = b.boxes.filter((x) => x.zone === 'BASE' && !x.moduleId.endsWith('countertop')).at(-1)!;
    mm(last.center.x + last.size.x / 2, 3.148, 'base run ends at the far wall face');
    const top = box(`${run.id}-countertop`);
    mm(top.center.y, 0.83, 'countertop top at 850'); mm(top.size.x, 3.048, 'countertop length');
  });

  test('boxes on walls running in other directions face into the room', () => {
    for (const [id, rotation, firstCentre] of [
      ['s', Math.PI, { x: W - 0.55, z: 2.6 }],      // drawn east → west, room to the north
      ['e', -Math.PI / 2, { x: W - 0.4, z: 0.55 }], // drawn south, room to the west
      ['w', Math.PI / 2, { x: 0.4, z: 3 - 0.55 }],  // drawn north, room to the east
      ['n-rev', 0, { x: W - 0.55, z: 0.4 }],        // drawn east → west with the room on its right: normal flipped
    ] as const) {
      const rev = { ...wallById('n'), id: 'n-rev', start: { x: W, z: 0 }, end: { x: 0, z: 0 } };
      const fl = id === 'n-rev' ? { ...floor, walls: [rev, ...floor.walls.filter((x) => x.id !== 'n')] } : floor;
      const it = defaultModularItem(room, id === 'n-rev' ? rev : wallById(id), 'KITCHEN', { floor: fl, loft: false });
      const b = priceModular(it, undefined, { ...project, floors: [fl] });
      const first = b.boxes[0];
      mm(first.rotationY, rotation, `${id} rotation`);
      mm(first.center.x, firstCentre.x, `${id} x`);
      mm(first.center.z, firstCentre.z, `${id} z`);
      // local +z (sin θ, cos θ) must point from the wall into the room centre (1.624, 1.5)
      const nz = { x: Math.sin(first.rotationY), z: Math.cos(first.rotationY) };
      const toRoom = { x: 1.624 - first.center.x, z: 1.5 - first.center.z };
      check(nz.x * toRoom.x + nz.z * toRoom.z > 0, `${id} faces the room`);
    }
  });

  test('warnings: run longer than the wall, wall units too low, unfilled, openings', () => {
    const it = kitchen();
    it.runs[0] = { ...it.runs[0], lengthMm: 3200 };
    it.dims.wallBottomMm = 1200;
    const w = priceModular(it, undefined, project).warnings;
    check(w.some((x) => /is 152 mm longer than the wall/.test(x)), `too long: ${w.join(' | ')}`);
    check(w.some((x) => /350 mm above the counter/.test(x)), 'wall units too low');
    check(w.some((x) => /leave 152 mm unfilled/.test(x)), 'unfilled');
    const withWindow: Project = { ...project, floors: [{ ...floor, openings: [{ id: 'win', wallId: 'n', componentId: 'window-casement', t: 0.5, widthM: 1.2, heightM: 1.2, sillM: 1.0 }] }] };
    const ww = priceModular(kitchen(), undefined, withWindow).warnings;
    check(ww.some((x) => /wall units cross opening win/.test(x)), 'wall units over a window');
    check(!ww.some((x) => /base units cross/.test(x)), 'base units clear a 1 m sill');
  });
});

describe('fillRun', () => {
  test('keeps placed modules, replaces fillers, fills to length; idempotent', () => {
    const item = kitchen();
    const run = { ...item.runs[0], lengthMm: 3600, modules: item.runs[0].modules.filter((m) => m.zone === 'BASE' && m.kind !== 'FILLER') };
    const filled = fillRun({ ...run, zones: ['BASE'] }, { ...item, runs: [] });
    const widths = filled.modules.map((m) => m.widthMm);
    assert.equal(widths.reduce((a, b) => a + b, 0), 3600, 'fills to the run');
    assert.deepEqual(widths, [900, 600, 900, 600, 600], 'kept 900/600/900/600, added a 600');
    assert.equal(filled.modules.filter((m) => m.kind === 'BASE_SINK').length, 1, 'no second sink');
    assert.deepEqual(fillRun(filled, item).modules, filled.modules, 'refilling a full run changes nothing');
    const wardrobe = defaultModularItem(room, wallById('n'), 'WARDROBE', { floor });
    const r = fillRun({ ...wardrobe.runs[0], lengthMm: 2000, modules: [] }, wardrobe);
    assert.deepEqual(r.modules.filter((m) => m.zone === 'TALL').map((m) => `${m.kind}:${m.widthMm}`), ['WARDROBE_HINGED:900', 'WARDROBE_HINGED:900', 'FILLER:200'], 'wardrobe widths');
  });
});

describe('wardrobe', () => {
  test('1.8 m hinged wardrobe with loft, hand-checked', () => {
    const it = defaultModularItem(room, wallById('n'), 'WARDROBE', { floor, maxLengthMm: 1800 });
    const run = it.runs[0];
    assert.deepEqual(run.zones, ['TALL', 'LOFT'], 'zones');
    assert.equal(it.dims.loftHeightMm, 600, '2700 ceiling − 2100 wardrobe');
    assert.equal(it.pricing.convention, 'SQFT_FRONT', 'wardrobes priced by front');
    const b = priceModular(it, undefined, project);
    // Tall: 1.8 × 2.1 m = 3.78 m² = 40.69 sq ft × ₹1,300; loft 1.8 × 0.6 = 1.08 m² = 11.63 sq ft × ₹750.
    assert.deepEqual(b.byZone.map((z) => [z.zone, z.frontSqft, z.amount]), [['TALL', 40.69, 52_897_00], ['LOFT', 11.63, 8_722_50]], 'zones');
    // 4 tall shutters × 4 hinges (2100 mm) + 4 loft shutters × 2; 2 internal drawers.
    assert.deepEqual(b.hardware, { hinges: 24, channels: 2, liftUps: 0, amount: 24 * 250_00 + 2 * 800_00 }, 'hardware');
    assert.equal(b.countertop.amount, 0, 'no countertop');
    assert.equal(b.total, 52_897_00 + 8_722_50 + 7_600_00, 'total ₹69,219.50');
    const loft = b.boxes.find((x) => x.zone === 'LOFT')!;
    mm(loft.center.y, 2.4, 'loft from 2.1 to 2.7 m');
    assert.deepEqual(b.warnings, [], 'fits under the ceiling');
  });

  test('hinge counts by shutter height', () => {
    assert.deepEqual([600, 900, 901, 1600, 2100].map(hingesPerShutter), [2, 2, 3, 3, 4], 'hinges');
  });
});

describe('layouts on the sample plan', () => {
  const f = sample.floors[0];
  const k = f.rooms.find((r) => r.id === 'room-kitchen')!;
  const w = (id: string) => f.walls.find((x) => x.id === id)!;

  test('L kitchen: first wall owns the corner, second run starts one base depth clear', () => {
    const it = defaultModularItem(k, [w('ext-n'), w('ext-e')], 'KITCHEN', { floor: f });
    assert.equal(it.layout, 'L', 'layout');
    const [a, b] = it.runs;
    // ext-n: kitchen spans x 6..10; clear of int-1 (60 mm) and ext-e (150 mm).
    assert.deepEqual([a.offsetStartMm, a.lengthMm], [6060, 3790], 'run 1');
    // ext-e: z 0..5; 150 clear of ext-n + 600 base depth; 60 clear of int-2 at z = 5.
    assert.deepEqual([b.offsetStartMm, b.lengthMm], [750, 4190], 'run 2');
    assert.equal(a.modules.filter((m) => m.zone === 'BASE').at(-1)!.kind, 'BASE_CORNER', 'corner at the shared end');
    assert.equal(b.modules.filter((m) => m.kind === 'BASE_SINK').length, 0, 'one sink per kitchen');
    for (const r of it.runs) for (const z of r.zones) {
      assert.equal(r.modules.filter((m) => m.zone === z).reduce((s, m) => s + m.widthMm, 0), r.lengthMm, `${r.id} ${z} filled`);
    }
    const bd = priceModular(it, undefined, sample);
    // Countertop counts the corner square once: (3.79 + 4.19) × 0.6 m.
    assert.equal(bd.countertop.sqft, Math.round((3.79 + 4.19) * 0.6 * 10.7639 * 100) / 100, 'countertop');
    check(bd.warnings.some((x) => /cross opening op-win-kitchen/.test(x)), 'flags the window over the counter');
  });

  test('parallel and U layouts are inferred', () => {
    assert.equal(defaultModularItem(k, [w('int-1'), w('ext-e')], 'KITCHEN', { floor: f }).layout, 'PARALLEL', 'parallel');
    assert.equal(defaultModularItem(k, [w('int-1'), w('ext-n'), w('ext-e')], 'KITCHEN', { floor: f }).layout, 'U', 'U');
    assert.throws(() => defaultModularItem(k, w('ext-w'), 'KITCHEN', { floor: f }), /does not bound/);
  });

  test('modularQuoteLine prices the item as one HSN 9403 line', () => {
    const it = defaultModularItem(k, w('ext-n'), 'KITCHEN', { floor: f });
    const line = modularQuoteLine(it, sample);
    assert.equal(line.kind, 'MODULAR', 'kind');
    if (line.kind !== 'MODULAR') return;
    assert.equal(line.amount, line.breakdown.total, 'amount is the breakdown total');
    assert.equal(line.hsnSac, '9403', 'HSN');
    assert.equal(line.roomId, 'room-kitchen', 'room');
    check(line.breakdown.boxes.length > 0, 'boxes for the 3D view');
    assert.equal(DEFAULT_MODULAR_RATES.roundTo, 10_00, '₹10 steps');
  });
});
