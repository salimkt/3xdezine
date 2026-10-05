import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { polygonArea } from './cost.ts';
import {
  DEFAULT_POLICY,
  acceptProposal,
  applyEdits,
  canEditFinishes,
  canEditWall,
  checkEdit,
  createProposal,
  effectivePolicy,
  inferRoomKind,
  minRoomWidth,
  rejectProposal,
  validatePlan,
} from './rules.ts';
import type {
  Catalog,
  EditPolicy,
  EditSuggestion,
  Opening,
  PlanEdit,
  Project,
  Room,
  RuleViolation,
  Vec2,
  Wall,
} from './types.ts';

/**
 * assert.ok with a default message: without one, node:assert re-parses the
 * call site's source to build a message, which under tsx (TypeScript source)
 * can spin for minutes.
 */
const check: (value: unknown, message?: string) => asserts value = (value, message = 'expected a truthy value') =>
  assert.ok(value, message);

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, 'catalog.seed.json'), 'utf8')) as Catalog;
const sample = JSON.parse(readFileSync(join(here, 'sample-project.json'), 'utf8')) as Project;

const LAYOUT: EditPolicy = { level: 'LAYOUT', lockedWallIds: [], requireReview: false };
const FULL: EditPolicy = { level: 'FULL', lockedWallIds: [], requireReview: false };
const VIEW: EditPolicy = { level: 'VIEW', lockedWallIds: [], requireReview: false };
const FINISHES: EditPolicy = { level: 'FINISHES', lockedWallIds: [], requireReview: false };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];

interface PlanOpts {
  w: number;
  d: number;
  height?: number;
  rooms?: { id: string; name: string; polygon: Vec2[]; ceiling?: number }[];
  walls?: [string, number, number, number, number][];
  openings?: Opening[];
  /** Skip the generous default windows (for daylight tests). */
  bare?: boolean;
}

/**
 * A w x d box of 230 mm exterior walls (ext-n/e/s/w, clockwise from the
 * north-west corner) with optional interior walls, rooms and openings.
 * Unless `bare`, it gets a big north window and an entrance door so the
 * daylight/ventilation/access rules stay quiet.
 */
function plan(o: PlanOpts): Project {
  const H = o.height ?? 3;
  const ext = (id: string, x1: number, z1: number, x2: number, z2: number): Wall => ({
    id, start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, heightM: H, thicknessM: 0.23, exterior: true,
  });
  const walls: Wall[] = [
    ext('ext-n', 0, 0, o.w, 0), ext('ext-e', o.w, 0, o.w, o.d), ext('ext-s', o.w, o.d, 0, o.d), ext('ext-w', 0, o.d, 0, 0),
    ...(o.walls ?? []).map(([id, x1, z1, x2, z2]): Wall => ({
      id, start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, heightM: H, thicknessM: 0.115, exterior: false,
    })),
  ];
  const rooms: Room[] = (o.rooms ?? [{ id: 'r', name: 'Bedroom', polygon: rect(0, 0, o.w, o.d) }]).map((r) => ({
    id: r.id, name: r.name, polygon: r.polygon, ceilingHeightM: r.ceiling ?? H,
  }));
  return {
    name: 'test', currency: 'INR', unitSystem: 'metric', contingencyBuffer: 0.08,
    floors: [{ id: 'f', name: 'Ground', level: 0, walls, rooms, openings: o.openings ?? [], components: [] }],
  };
}

const win = (id: string, wallId: string, t: number, widthM = 1.2, heightM = 1.4, sillM = 0.9): Opening => ({
  id, wallId, componentId: 'window-casement', t, widthM, heightM, sillM,
});
const door = (id: string, wallId: string, t: number, widthM = 0.9): Opening => ({
  id, wallId, componentId: 'door-flush-oak', t, widthM, heightM: 2.1, sillM: 0,
});

const ids = (vs: RuleViolation[]) => vs.map((v) => v.ruleId);
const has = (vs: RuleViolation[], ruleId: string, roomId?: string) =>
  vs.some((v) => v.ruleId === ruleId && (roomId === undefined || v.roomId === roomId));

/** A single named room of w x d with plenty of window, so only the size rules can fire. */
function oneRoom(name: string, w: number, d: number, ceiling?: number): Project {
  return plan({
    w, d,
    rooms: [{ id: 'r', name, polygon: rect(0, 0, w, d), ceiling }],
    openings: [win('o-w', 'ext-n', 0.5, Math.max(0.3, w - 0.4), 2.0, 0.3)],
  });
}

function assertSuggestionsSound(project: Project, suggestions: EditSuggestion[], policy: EditPolicy) {
  for (const s of suggestions) {
    check(s.title.length > 0 && s.rationale.length > 0, 'suggestions explain themselves');
    check(s.edits.length > 0, 'a suggestion carries edits');
    const c = checkEdit(project, s.edits, policy);
    assert.equal(c.allowed, true, `suggestion "${s.title}" is refused: ${c.reason}`);
    const errors = c.violations.filter((v) => v.severity === 'ERROR');
    assert.deepEqual(errors, [], `suggestion "${s.title}" adds errors`);
  }
}

// ---------------------------------------------------------------------------
// Policy plumbing
// ---------------------------------------------------------------------------

describe('policy', () => {
  test('DEFAULT_POLICY is Layout, nothing locked, no review', () => {
    assert.deepEqual(DEFAULT_POLICY, { level: 'LAYOUT', lockedWallIds: [], requireReview: false });
  });

  test('effectivePolicy fills gaps and returns a copy', () => {
    assert.deepEqual(effectivePolicy(sample), DEFAULT_POLICY);
    const p = { ...sample, policy: { level: 'FULL', lockedWallIds: ['int-1'], requireReview: true } as EditPolicy };
    const eff = effectivePolicy(p);
    assert.deepEqual(eff, p.policy);
    eff.lockedWallIds.push('x');
    assert.deepEqual(p.policy.lockedWallIds, ['int-1']);
  });
});

// ---------------------------------------------------------------------------
// applyEdits
// ---------------------------------------------------------------------------

describe('applyEdits', () => {
  test('never mutates its input', () => {
    const before = structuredClone(sample);
    const edits: PlanEdit[] = [
      { kind: 'MOVE_CORNER', from: { x: 6, z: 5 }, to: { x: 6.5, z: 5 } },
      { kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.3 },
      { kind: 'RESIZE_OPENING', openingId: 'op-door-hall', widthM: 1 },
      { kind: 'ADD_OPENING', opening: door('op-new', 'int-3', 0.5) },
      { kind: 'REMOVE_OPENING', openingId: 'op-kitchen-pass' },
    ];
    const editsBefore = structuredClone(edits);
    const next = applyEdits(sample, edits);
    assert.deepEqual(sample, before);
    assert.deepEqual(edits, editsBefore);
    assert.notEqual(next, sample);
    assert.notEqual(next.floors[0], sample.floors[0]);
  });

  test('MOVE_CORNER carries every wall end and room vertex within 1 cm', () => {
    // (6, 5) is int-1's end and a vertex of both Living and Kitchen; int-2 passes through it.
    const next = applyEdits(sample, [{ kind: 'MOVE_CORNER', from: { x: 6.005, z: 4.995 }, to: { x: 6.5, z: 5 } }]);
    const f = next.floors[0];
    assert.deepEqual(f.walls.find((w) => w.id === 'int-1')!.end, { x: 6.5, z: 5 });
    assert.deepEqual(f.walls.find((w) => w.id === 'int-2')!.start, { x: 0, z: 5 }, 'mid-span walls do not move');
    for (const id of ['room-living', 'room-kitchen']) {
      check(f.rooms.find((r) => r.id === id)!.polygon.some((p) => p.x === 6.5 && p.z === 5), id);
    }
    assert.equal(polygonArea(f.rooms.find((r) => r.id === 'room-living')!.polygon), 31.25);
    assert.equal(polygonArea(f.rooms.find((r) => r.id === 'room-kitchen')!.polygon), 18.75);
  });

  test('MOVE_CORNER ignores points more than 1 cm away', () => {
    const next = applyEdits(sample, [{ kind: 'MOVE_CORNER', from: { x: 6.02, z: 5 }, to: { x: 7, z: 5 } }]);
    assert.deepEqual(next.floors, sample.floors);
  });

  test('opening edits', () => {
    const next = applyEdits(sample, [
      { kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.3 },
      { kind: 'RESIZE_OPENING', openingId: 'op-door-hall', widthM: 1 },
      { kind: 'ADD_OPENING', opening: door('op-new', 'int-3', 0.5) },
      { kind: 'REMOVE_OPENING', openingId: 'op-kitchen-pass' },
    ]);
    const ops = next.floors[0].openings;
    assert.equal(ops.find((o) => o.id === 'op-door-bedroom')!.t, 0.3);
    assert.equal(ops.find((o) => o.id === 'op-door-hall')!.widthM, 1);
    check(ops.some((o) => o.id === 'op-new'));
    check(!ops.some((o) => o.id === 'op-kitchen-pass'));
  });
});

// ---------------------------------------------------------------------------
// Room type inference
// ---------------------------------------------------------------------------

describe('inferRoomKind', () => {
  const cases: [string, string][] = [
    ['Master Bedroom', 'HABITABLE'], ['bedroom 2', 'HABITABLE'], ['Living Room', 'HABITABLE'],
    ['Living Hall', 'HABITABLE'], ['Dining', 'HABITABLE'], ['Study', 'HABITABLE'], ['Guest Room', 'HABITABLE'],
    ['Kitchen', 'KITCHEN'], ['KITCHENETTE', 'KITCHEN'], ['Kitchen / Dining', 'KITCHEN_DINING'],
    ['Bath', 'BATH'], ['WC', 'WC'], ['Powder Room', 'WC'], ['Toilet', 'BATH_WC'], ['Master Toilet', 'BATH_WC'],
    ['Bathroom', 'BATH_WC'], ['Bath + WC', 'BATH_WC'],
    ['Entry Hall', 'CIRCULATION'], ['Hall', 'CIRCULATION'], ['Corridor', 'CIRCULATION'], ['Passage', 'CIRCULATION'],
    ['Store', 'STORE'], ['Utility', 'STORE'], ['Pooja', 'STORE'], ['Master Dressing', 'STORE'],
    ['Balcony', 'OUTDOOR'], ['Cabin 1', 'CABIN'], ['Seating', 'UNKNOWN'], ['Back of House', 'UNKNOWN'],
  ];
  for (const [name, kind] of cases) test(`${name} → ${kind}`, () => assert.equal(inferRoomKind(name), kind));
});

// ---------------------------------------------------------------------------
// NBC size rules, each at its boundary
// ---------------------------------------------------------------------------

describe('NBC room minimums (WARNING, cited)', () => {
  const boundary = (label: string, name: string, okW: number, okD: number, badW: number, badD: number, rule: string) => {
    test(`${label}: ${okW}×${okD} passes, ${badW}×${badD} warns (${rule})`, () => {
      const ok = validatePlan(oneRoom(name, okW, okD));
      check(!has(ok, rule), JSON.stringify(ok));
      const bad = validatePlan(oneRoom(name, badW, badD)).filter((v) => v.ruleId === rule);
      assert.equal(bad.length, 1);
      assert.equal(bad[0].severity, 'WARNING');
      assert.match(bad[0].reference!, /^NBC 2016 Part 3, cl\. 12\./);
      assert.match(bad[0].message, new RegExp(name));
      assert.match(bad[0].message, /bye-laws/);
    });
  };

  boundary('only habitable room, area 9.5', 'Bedroom', 2.5, 3.8, 2.5, 3.79, 'room.min-area');
  boundary('only habitable room, width 2.4', 'Bedroom', 2.4, 5, 2.39, 5, 'room.min-width');
  boundary('kitchen, area 5.0', 'Kitchen', 2, 2.5, 2, 2.49, 'room.min-area');
  boundary('kitchen, width 1.8', 'Kitchen', 1.8, 4, 1.79, 4, 'room.min-width');
  boundary('kitchen-dining, area 7.5', 'Kitchen / Dining', 2.5, 3, 2.5, 2.99, 'room.min-area');
  boundary('kitchen-dining, width 2.1', 'Kitchen / Dining', 2.1, 4, 2.09, 4, 'room.min-width');
  boundary('bathroom, area 1.8', 'Bath', 1.2, 1.5, 1.2, 1.49, 'room.min-area');
  boundary('bathroom, width 1.2', 'Bath', 1.2, 2, 1.19, 2, 'room.min-width');
  boundary('WC, area 1.1', 'WC', 1, 1.1, 1, 1.09, 'room.min-area');
  boundary('WC, width 0.9', 'WC', 0.9, 1.5, 0.89, 1.5, 'room.min-width');
  boundary('bath + WC, area 2.8', 'Toilet', 1.4, 2, 1.4, 1.99, 'room.min-area');
  boundary('bath + WC, width 1.2', 'Toilet', 1.2, 2.5, 1.19, 2.5, 'room.min-width');
  boundary('office cabin, area 3.0', 'Cabin', 1.5, 2, 1.5, 1.99, 'room.min-area');

  test('a second habitable room needs 7.5 m² and 2.1 m, the main one 9.5 m²', () => {
    const two = (bedW: number, bedD: number) =>
      plan({
        w: 4 + bedW, d: Math.max(4, bedD),
        walls: [['i', 4, 0, 4, Math.max(4, bedD)]],
        rooms: [
          { id: 'living', name: 'Living', polygon: rect(0, 0, 4, Math.max(4, bedD)) },
          { id: 'bed', name: 'Bedroom 2', polygon: rect(4, 0, 4 + bedW, bedD) },
        ],
      });
    check(!has(validatePlan(two(2.5, 3)), 'room.min-area', 'bed'), '7.5 m² is enough for the second room');
    check(has(validatePlan(two(2.5, 2.99)), 'room.min-area', 'bed'));
    check(!has(validatePlan(two(2.1, 4)), 'room.min-width', 'bed'));
    check(has(validatePlan(two(2.09, 4)), 'room.min-width', 'bed'));
  });

  test('a separate store lets the kitchen drop to 4.5 m²', () => {
    const withStore = plan({
      w: 4, d: 2.4,
      walls: [['i', 2, 0, 2, 2.4]],
      rooms: [
        { id: 'k', name: 'Kitchen', polygon: rect(0, 0, 1.9, 2.4) },
        { id: 's', name: 'Store', polygon: rect(1.9, 0, 4, 2.4) },
      ],
    });
    // 1.9 x 2.4 = 4.56 m²
    check(!has(validatePlan(withStore), 'room.min-area', 'k'));
    check(has(validatePlan(oneRoom('Kitchen', 1.9, 2.4)), 'room.min-area'));
  });

  test('unknown room types get only geometric rules', () => {
    const tiny = validatePlan(oneRoom('Seating', 1, 1, 2.2));
    assert.deepEqual(tiny.filter((v) => v.severity !== 'ERROR'), []);
  });

  test('min width measures the narrow arm of an L', () => {
    const l = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }];
    assert.equal(minRoomWidth(l), 2);
    assert.equal(minRoomWidth(rect(0, 0, 3, 5)), 3);
  });
});

describe('NBC ceiling heights', () => {
  test('habitable rooms and kitchens need 2.75 m', () => {
    for (const name of ['Bedroom', 'Kitchen']) {
      check(!has(validatePlan(oneRoom(name, 3, 4, 2.75)), 'room.ceiling-height'), name);
      const v = validatePlan(oneRoom(name, 3, 4, 2.74)).find((x) => x.ruleId === 'room.ceiling-height');
      check(v, name);
      assert.equal(v.severity, 'WARNING');
      assert.match(v.reference!, /12\.(2|3)\.1/);
    }
  });

  test('bathrooms need 2.1 m', () => {
    check(!has(validatePlan(oneRoom('Toilet', 1.5, 2, 2.1)), 'room.ceiling-height'));
    check(has(validatePlan(oneRoom('Toilet', 1.5, 2, 2.09)), 'room.ceiling-height'));
  });

  test('the sample project honestly warns about its 2.7 m ceilings', () => {
    const v = validatePlan(sample).filter((x) => x.ruleId === 'room.ceiling-height');
    assert.deepEqual(v.map((x) => x.roomId).sort(), ['room-bedroom', 'room-kitchen', 'room-living']);
    check(v.every((x) => x.severity === 'WARNING' && /2\.70 m/.test(x.message)));
  });
});

describe('NBC daylight and ventilation', () => {
  const lit = (name: string, w: number, d: number, winW: number, winH: number, wallId = 'ext-n') =>
    validatePlan(plan({ w, d, rooms: [{ id: 'r', name, polygon: rect(0, 0, w, d) }], openings: [win('o', wallId, 0.5, winW, winH, 0.5)] }));

  test('habitable rooms need window area of one-tenth the floor', () => {
    // 3 x 4 = 12 m² -> 1.2 m²
    check(!has(lit('Bedroom', 3, 4, 1, 1.2), 'room.daylight'));
    const v = lit('Bedroom', 3, 4, 1, 1.19).find((x) => x.ruleId === 'room.daylight')!;
    assert.equal(v.severity, 'WARNING');
    assert.equal(v.reference, 'NBC 2016 Part 3, cl. 20.1.2');
  });

  test('kitchens need 25% more', () => {
    // 2.5 x 4 = 10 m² -> 1.25 m²
    check(!has(lit('Kitchen', 2.5, 4, 1, 1.25), 'room.daylight'));
    check(has(lit('Kitchen', 2.5, 4, 1, 1.24), 'room.daylight'));
  });

  test('advice (INFO) between the hot-dry and warm-humid minimums', () => {
    const v = lit('Bedroom', 3, 4, 1, 1.5);
    check(!has(v, 'room.daylight'));
    assert.equal(v.find((x) => x.ruleId === 'room.daylight-climate')?.severity, 'INFO');
    check(!has(lit('Bedroom', 3, 4, 1, 2), 'room.daylight-climate'), '2.0 m² = one-sixth of 12');
  });

  test('a window on an interior wall does not count', () => {
    const p = plan({
      w: 6, d: 4, walls: [['i', 3, 0, 3, 4]],
      rooms: [{ id: 'a', name: 'Bedroom', polygon: rect(0, 0, 3, 4) }, { id: 'b', name: 'Store', polygon: rect(3, 0, 6, 4) }],
      openings: [win('o', 'i', 0.5, 2, 2, 0.5), door('d', 'ext-s', 0.25)],
    });
    check(has(validatePlan(p), 'room.daylight', 'a'));
  });

  test('bathrooms need a 0.3 m² ventilator, each side at least 0.3 m', () => {
    const vent = (w: number, h: number) => lit('Toilet', 1.5, 2, w, h, 'ext-w');
    check(!has(vent(0.6, 0.5), 'room.ventilation'));
    check(has(vent(0.6, 0.49), 'room.ventilation'));
    check(has(vent(0.29, 2), 'room.ventilation'));
    assert.equal(vent(0.6, 0.49).find((x) => x.ruleId === 'room.ventilation')!.reference, 'NBC 2016 Part 3, cl. 12.4.3(f)');
  });

  test('a WC must not open straight into a kitchen', () => {
    const p = (doorWall: string) =>
      plan({
        w: 5, d: 3, walls: [['i', 2, 0, 2, 3]],
        rooms: [
          { id: 't', name: 'Toilet', polygon: rect(0, 0, 2, 3) },
          { id: 'k', name: 'Kitchen', polygon: rect(2, 0, 5, 3) },
        ],
        openings: [win('tw', 'ext-n', 0.2, 0.6, 0.6, 1.5), win('kw', 'ext-n', 0.7, 2, 1.4), door('d', doorWall, doorWall === 'i' ? 0.5 : 0.8)],
      });
    check(has(validatePlan(p('i')), 'room.wc-opens-into-kitchen', 't'));
    check(!has(validatePlan(p('ext-s')), 'room.wc-opens-into-kitchen'));
  });

  test('a room with no door, opening or open side is flagged (INFO)', () => {
    const p = plan({
      w: 6, d: 4, walls: [['i', 3, 0, 3, 4]],
      rooms: [{ id: 'a', name: 'Store', polygon: rect(0, 0, 3, 4) }, { id: 'b', name: 'Store 2', polygon: rect(3, 0, 6, 4) }],
      // ext-s runs east to west, so t = 0.75 is x = 1.5, into room a.
      openings: [door('d', 'ext-s', 0.75)],
    });
    const v = validatePlan(p).filter((x) => x.ruleId === 'room.no-access');
    assert.deepEqual(v.map((x) => x.roomId), ['b']);
    assert.equal(v[0].severity, 'INFO');
  });
});

// ---------------------------------------------------------------------------
// Geometric rules
// ---------------------------------------------------------------------------

describe('geometric rules (ERROR)', () => {
  test('a room with no area', () => {
    const p = plan({ w: 4, d: 4, rooms: [{ id: 'r', name: 'Bedroom', polygon: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }] }] });
    const v = validatePlan(p).find((x) => x.ruleId === 'room.degenerate');
    assert.equal(v?.severity, 'ERROR');
  });

  test('a self-intersecting (bow-tie) room', () => {
    const p = plan({ w: 4, d: 4, rooms: [{ id: 'r', name: 'Bedroom', polygon: [{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 3 }] }] });
    check(has(validatePlan(p), 'room.self-intersecting', 'r'));
    check(!has(validatePlan(oneRoom('Bedroom', 4, 4)), 'room.self-intersecting'));
  });

  test('walls must be at least 0.3 m', () => {
    const p = (len: number) => plan({ w: 4, d: 4, walls: [['stub', 2, 0, 2, len]] });
    check(!has(validatePlan(p(0.3)), 'wall.min-length'));
    const v = validatePlan(p(0.29)).find((x) => x.ruleId === 'wall.min-length')!;
    assert.equal(v.severity, 'ERROR');
    assert.equal(v.wallId, 'stub');
  });

  test('an opening must clear the corners: half the meeting wall + 5 cm', () => {
    // ext-n is 4 m; ext-w meets its start, 0.23 thick -> 0.165 m clear needed.
    const at = (start: number) => validatePlan(plan({ w: 4, d: 4, openings: [win('o', 'ext-n', (start + 0.6) / 4)] }));
    check(!has(at(0.165), 'opening.outside-wall'));
    check(has(at(0.16), 'opening.outside-wall'));
  });

  test('an opening wider than its wall', () => {
    const v = validatePlan(plan({ w: 2, d: 4, openings: [win('o', 'ext-n', 0.5, 2)] }));
    assert.match(v.find((x) => x.ruleId === 'opening.outside-wall')!.message, /clear length/);
  });

  test('openings on one wall must not overlap', () => {
    const p = (gap: number) => plan({ w: 6, d: 4, openings: [win('a', 'ext-n', 1.6 / 6), win('b', 'ext-n', (1.6 + 1.2 + gap) / 6)] });
    check(!has(validatePlan(p(0)), 'opening.overlap'));
    const v = validatePlan(p(-0.01)).find((x) => x.ruleId === 'opening.overlap')!;
    assert.equal(v.severity, 'ERROR');
    assert.equal(v.openingId, 'b');
  });

  test('an opening must not run into a wall that meets it part-way', () => {
    // i meets ext-n at x = 3, 0.115 thick.
    const p = (centre: number) => plan({
      w: 6, d: 4, walls: [['i', 3, 0, 3, 4]],
      rooms: [{ id: 'a', name: 'Bedroom', polygon: rect(0, 0, 3, 4) }, { id: 'b', name: 'Living', polygon: rect(3, 0, 6, 4) }],
      openings: [win('o', 'ext-n', centre / 6)],
    });
    check(!has(validatePlan(p(3 - 0.0575 - 0.6)), 'opening.at-junction'));
    check(has(validatePlan(p(3 - 0.0575 - 0.59)), 'opening.at-junction'));
  });

  test('the shipped sample plan has no geometric errors', () => {
    // The sample once centred its 1.1 m entrance door at t=0.15, which ran it
    // 5 cm into the bathroom wall's junction with the south wall. It now sits
    // centred in the entry hall; this keeps the default project error-free.
    const v = validatePlan(sample).filter((x) => x.severity === 'ERROR');
    assert.deepEqual(v.map((x) => [x.ruleId, x.openingId]), [], 'sample should validate without ERRORs');
  });

  test('a door pushed into a wall junction is caught (the old sample defect)', () => {
    const broken = structuredClone(sample);
    broken.floors[0].openings.find((o) => o.id === 'op-entry')!.t = 0.15;
    const v = validatePlan(broken).filter((x) => x.severity === 'ERROR');
    assert.deepEqual(v.map((x) => [x.ruleId, x.openingId]), [['opening.at-junction', 'op-entry']], 'junction overlap must be an ERROR');
  });

  test('doors must be at least 0.75 m', () => {
    const p = (w: number) => plan({ w: 6, d: 4, walls: [['i', 3, 0, 3, 4]], openings: [door('d', 'i', 0.5, w)] });
    check(!has(validatePlan(p(0.75)), 'door.min-width'));
    assert.equal(validatePlan(p(0.74)).find((x) => x.ruleId === 'door.min-width')?.severity, 'ERROR');
  });

  test('an entrance door under 0.9 m is a WARNING, not an error', () => {
    const p = (w: number) => plan({ w: 4, d: 4, openings: [door('d', 'ext-s', 0.5, w)] });
    check(!has(validatePlan(p(0.9)), 'door.entry-width'));
    const v = validatePlan(p(0.8));
    assert.equal(v.find((x) => x.ruleId === 'door.entry-width')?.severity, 'WARNING');
    check(!has(v, 'door.min-width'));
  });

  test('sill + height must fit under the wall', () => {
    const p = (sill: number) => plan({ w: 4, d: 4, height: 3, openings: [win('o', 'ext-n', 0.5, 1.2, 1.4, sill)] });
    check(!has(validatePlan(p(1.6)), 'opening.too-tall'));
    check(has(validatePlan(p(1.61)), 'opening.too-tall'));
  });

  test('an opening on a missing wall', () => {
    check(has(validatePlan(plan({ w: 4, d: 4, openings: [win('o', 'nope', 0.5)] })), 'opening.wall-missing'));
  });

  test('errors sort before warnings before info', () => {
    const v = validatePlan(sample);
    const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
    for (let i = 1; i < v.length; i++) check(rank[v[i - 1].severity] <= rank[v[i].severity]);
  });
});

// ---------------------------------------------------------------------------
// checkEdit: permissions
// ---------------------------------------------------------------------------

describe('checkEdit permissions', () => {
  const interiorMove: PlanEdit = { kind: 'MOVE_CORNER', from: { x: 6, z: 5 }, to: { x: 6.5, z: 5 } };
  const exteriorMove: PlanEdit = { kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 11, z: 0 } };
  const openingMove: PlanEdit = { kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.25 };

  test('VIEW forbids everything, with no suggestions', () => {
    for (const e of [interiorMove, exteriorMove, openingMove]) {
      const c = checkEdit(sample, [e], VIEW);
      assert.equal(c.allowed, false);
      assert.match(c.reason!, /view-only/);
      assert.deepEqual(c.suggestions, []);
    }
    assert.equal(canEditFinishes(sample, VIEW).allowed, false);
    assert.equal(canEditWall(sample, 'int-1', VIEW).allowed, false);
  });

  test('FINISHES forbids all geometry but allows finishes', () => {
    for (const e of [interiorMove, openingMove]) {
      const c = checkEdit(sample, [e], FINISHES);
      assert.equal(c.allowed, false);
      assert.match(c.reason!, /Finishes level/);
    }
    assert.equal(canEditFinishes(sample, FINISHES).allowed, true);
    assert.equal(canEditWall(sample, 'int-1', FINISHES).allowed, false);
  });

  test('LAYOUT allows interior corners and openings', () => {
    assert.equal(checkEdit(sample, [interiorMove], LAYOUT).allowed, true);
    assert.equal(checkEdit(sample, [openingMove], LAYOUT).allowed, true);
    assert.equal(checkEdit(sample, [{ kind: 'MOVE_OPENING', openingId: 'op-win-kitchen', t: 0.75 }], LAYOUT).allowed, true,
      'openings in exterior walls are layout, not envelope');
    assert.equal(canEditWall(sample, 'int-1', LAYOUT).allowed, true);
    assert.equal(canEditFinishes(sample, LAYOUT).allowed, true);
  });

  test('LAYOUT refuses an exterior corner, naming the wall in plain language', () => {
    const c = checkEdit(sample, [exteriorMove], LAYOUT);
    assert.equal(c.allowed, false);
    assert.equal(c.reason, 'The east exterior wall is part of the building envelope and is locked at Layout level.');
    const north = checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 10, z: -1 } }], LAYOUT);
    assert.match(north.reason!, /^The north exterior wall/);
    assert.equal(canEditWall(sample, 'ext-n', LAYOUT).allowed, false);
    assert.match(canEditWall(sample, 'ext-n', LAYOUT).reason!, /north exterior wall/);
  });

  test('LAYOUT lets a T-junction slide along the envelope but not leave it', () => {
    // int-1 starts at (6, 0), part-way along ext-n.
    assert.equal(checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 6, z: 0 }, to: { x: 6.5, z: 0 } }], LAYOUT).allowed, true);
    const off = checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 6, z: 0 }, to: { x: 6.5, z: 0.5 } }], LAYOUT);
    assert.equal(off.allowed, false);
    assert.match(off.reason!, /slide along/);
  });

  test('LAYOUT refuses locked walls and their openings', () => {
    const locked: EditPolicy = { ...LAYOUT, lockedWallIds: ['int-1'] };
    const c = checkEdit(sample, [interiorMove], locked);
    assert.equal(c.allowed, false);
    assert.match(c.reason!, /Living Room and Kitchen is locked as load-bearing/);
    const o = checkEdit(sample, [{ kind: 'RESIZE_OPENING', openingId: 'op-kitchen-pass', widthM: 1.2 }], locked);
    assert.equal(o.allowed, false);
    assert.match(o.reason!, /locked/);
    assert.equal(canEditWall(sample, 'int-1', locked).allowed, false);
    assert.equal(checkEdit(sample, [openingMove], locked).allowed, true);
  });

  test('FULL allows everything, locked walls included', () => {
    const fullLocked: EditPolicy = { ...FULL, lockedWallIds: ['int-1'] };
    for (const e of [interiorMove, exteriorMove, openingMove]) assert.equal(checkEdit(sample, [e], fullLocked).allowed, true);
    assert.equal(canEditWall(sample, 'ext-n', fullLocked).allowed, true);
  });

  test('defaults to the project policy', () => {
    assert.equal(checkEdit(sample, [exteriorMove]).allowed, false);
    assert.equal(checkEdit({ ...sample, policy: FULL }, [exteriorMove]).allowed, true);
  });

  test('refuses edits that refer to nothing', () => {
    assert.match(checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 3, z: 3 }, to: { x: 4, z: 4 } }], FULL).reason!, /no corner/);
    assert.match(checkEdit(sample, [{ kind: 'MOVE_OPENING', openingId: 'nope', t: 0.5 }], FULL).reason!, /no opening/);
    assert.match(checkEdit(sample, [{ kind: 'ADD_OPENING', opening: door('op-entry', 'int-3', 0.5) }], FULL).reason!, /already exists/);
    assert.equal(canEditWall(sample, 'nope').allowed, false);
  });

  test('each edit in a sequence is checked against the plan the previous ones left', () => {
    const c = checkEdit(sample, [interiorMove, { kind: 'MOVE_CORNER', from: { x: 6.5, z: 5 }, to: { x: 7, z: 5 } }], LAYOUT);
    assert.equal(c.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// checkEdit: new-only violations
// ---------------------------------------------------------------------------

describe('checkEdit violations', () => {
  test('pre-existing violations are not repeated', () => {
    const c = checkEdit(sample, [{ kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.25 }], LAYOUT);
    assert.equal(c.allowed, true);
    assert.deepEqual(c.violations, [], 'the 2.7 m ceilings were already there');
  });

  test('only what the edit breaks is reported', () => {
    const c = checkEdit(sample, [{ kind: 'RESIZE_OPENING', openingId: 'op-door-bedroom', widthM: 0.6 }], LAYOUT);
    assert.deepEqual(ids(c.violations), ['door.min-width']);
    assert.equal(c.violations[0].openingId, 'op-door-bedroom');
  });

  test('an empty edit list is allowed and changes nothing', () => {
    assert.deepEqual(checkEdit(sample, [], LAYOUT), { allowed: true, violations: [], suggestions: [] });
  });
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

describe('suggestions', () => {
  test('a corner move that shrinks a room too far is clamped at the area minimum', () => {
    // A 3 x 4 bedroom (12 m², the only habitable room -> 9.5 m²). Dragging
    // the south-east corner north along the east wall makes it a trapezoid
    // of area 1.5 * (4 + z).
    const p = plan({ w: 3, d: 4, openings: [win('o', 'ext-n', 0.5, 2, 1.6, 0.5), door('d', 'ext-w', 0.5)] });
    const edit: PlanEdit = { kind: 'MOVE_CORNER', from: { x: 3, z: 4 }, to: { x: 3, z: 1 } };
    const c = checkEdit(p, [edit], FULL);
    assert.equal(c.allowed, true);
    check(has(c.violations, 'room.min-area'));
    const clamp = c.suggestions.find((s) => s.resolves.includes('room.min-area'));
    check(clamp, JSON.stringify(c.suggestions));
    assert.match(clamp.title, /^Stop the wall after 1\.67 m — keeps Bedroom at 9\.50 m²$/);
    const move = clamp.edits[0] as Extract<PlanEdit, { kind: 'MOVE_CORNER' }>;
    // Exact boundary: 1.5 * (4 + z) = 9.5  =>  z = 2.3333
    check(Math.abs(move.to.z - 7 / 3) <= 0.01, `clamped to ${move.to.z}`);
    check(move.to.z >= 7 / 3 - 1e-9, 'on the safe side of the boundary');
    const after = applyEdits(p, clamp.edits);
    check(polygonArea(after.floors[0].rooms[0].polygon) >= 9.5);
    assertSuggestionsSound(p, c.suggestions, FULL);
    const recheck = checkEdit(p, clamp.edits, FULL);
    check(!has(recheck.violations, 'room.min-area') && !has(recheck.violations, 'room.min-width'));
  });

  test('the clamp is within 1 cm of the point where a rule starts to break', () => {
    // Shrink the sample bedroom by dragging int-3's foot west along the south wall.
    const edit: PlanEdit = { kind: 'MOVE_CORNER', from: { x: 5.5, z: 8 }, to: { x: 1, z: 8 } };
    const c = checkEdit(sample, [edit], LAYOUT);
    const clamp = c.suggestions.find((s) => s.title.startsWith('Stop the wall'));
    check(clamp);
    const to = (clamp.edits[0] as Extract<PlanEdit, { kind: 'MOVE_CORNER' }>).to;
    const blocking = (v: RuleViolation) => v.severity === 'ERROR' || v.ruleId === 'room.min-area' || v.ruleId === 'room.min-width';
    check(!checkEdit(sample, clamp.edits, LAYOUT).violations.some(blocking));
    const further = { x: to.x - 0.01, z: 8 };
    check(checkEdit(sample, [{ ...edit, to: further }], LAYOUT).violations.some(blocking), '1 cm further breaks a rule');
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('a door resized too narrow snaps up to 0.75 m', () => {
    const c = checkEdit(sample, [{ kind: 'RESIZE_OPENING', openingId: 'op-door-bedroom', widthM: 0.6 }], LAYOUT);
    const s = c.suggestions.find((x) => x.resolves.includes('door.min-width'));
    check(s);
    assert.deepEqual(s.edits, [{ kind: 'RESIZE_OPENING', openingId: 'op-door-bedroom', widthM: 0.75 }]);
    assert.equal(s.title, 'Make the door 0.75 m wide');
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('an entrance door snaps up to 0.9 m', () => {
    const p = plan({ w: 4, d: 4, openings: [door('d', 'ext-s', 0.5, 1)] });
    const c = checkEdit(p, [{ kind: 'RESIZE_OPENING', openingId: 'd', widthM: 0.8 }], LAYOUT);
    assert.deepEqual(ids(c.violations), ['door.entry-width']);
    const s = c.suggestions.find((x) => x.resolves.includes('door.entry-width'));
    assert.deepEqual(s?.edits, [{ kind: 'RESIZE_OPENING', openingId: 'd', widthM: 0.9 }]);
    assertSuggestionsSound(p, c.suggestions, LAYOUT);
  });

  test('a new door that is too narrow is added at the minimum instead', () => {
    const c = checkEdit(sample, [{ kind: 'ADD_OPENING', opening: door('op-new', 'int-3', 0.5, 0.6) }], LAYOUT);
    const s = c.suggestions.find((x) => x.resolves.includes('door.min-width'));
    assert.equal((s?.edits[0] as Extract<PlanEdit, { kind: 'ADD_OPENING' }>).opening.widthM, 0.75);
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('an opening moved off its wall is put back inside it', () => {
    const c = checkEdit(sample, [{ kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0 }], LAYOUT);
    check(has(c.violations, 'opening.outside-wall'));
    const s = c.suggestions.find((x) => x.resolves.includes('opening.outside-wall'));
    check(s);
    const t = (s.edits[0] as Extract<PlanEdit, { kind: 'MOVE_OPENING' }>).t;
    check(t > 0 && t < 0.1, `t = ${t}`);
    assert.deepEqual(checkEdit(sample, s.edits, LAYOUT).violations.filter((v) => v.severity === 'ERROR'), []);
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('an opening moved onto another is moved off it', () => {
    // op-door-hall sits at t = 0.9 on int-2.
    const c = checkEdit(sample, [{ kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.88 }], LAYOUT);
    check(has(c.violations, 'opening.overlap') || has(c.violations, 'opening.at-junction'));
    const s = c.suggestions.find((x) => x.resolves.some((r) => r === 'opening.overlap' || r === 'opening.at-junction'));
    check(s);
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('a resize that no longer fits offers a move and the widest size that fits', () => {
    const c = checkEdit(sample, [{ kind: 'RESIZE_OPENING', openingId: 'op-door-bedroom', widthM: 4.2 }], LAYOUT);
    check(c.violations.some((v) => v.severity === 'ERROR'));
    check(c.suggestions.length >= 1);
    const widest = c.suggestions.find((s) => s.title.startsWith('Make it'));
    check(widest, JSON.stringify(c.suggestions.map((s) => s.title)));
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('a new window taller than the wall gets a lower sill', () => {
    const c = checkEdit(sample, [{ kind: 'ADD_OPENING', opening: win('op-new', 'ext-e', 0.3, 1.2, 1.4, 1.5) }], LAYOUT);
    const s = c.suggestions.find((x) => x.resolves.includes('opening.too-tall'));
    assert.equal((s?.edits[0] as Extract<PlanEdit, { kind: 'ADD_OPENING' }>).opening.sillM, 1.3);
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('a refused envelope move suggests moving the interior wall instead', () => {
    const c = checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 11, z: 0 } }], LAYOUT);
    assert.equal(c.allowed, false);
    assert.equal(c.suggestions.length, 1);
    const s = c.suggestions[0];
    assert.match(s.title, /Living Room and Kitchen/);
    const after = applyEdits(sample, s.edits);
    const kitchen = after.floors[0].rooms.find((r) => r.id === 'room-kitchen')!;
    assert.equal(polygonArea(kitchen.polygon), 25, 'the kitchen grows by the same 5 m² it would have');
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('a T-junction pulled off a locked wall is offered the slide along it', () => {
    const c = checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 6, z: 0 }, to: { x: 6.5, z: 0.5 } }], LAYOUT);
    assert.equal(c.allowed, false);
    assert.deepEqual(c.suggestions.map((s) => s.edits), [[{ kind: 'MOVE_CORNER', from: { x: 6, z: 0 }, to: { x: 6.5, z: 0 } }]]);
    assertSuggestionsSound(sample, c.suggestions, LAYOUT);
  });

  test('no suggestion when nothing permitted would do it', () => {
    const c = checkEdit(oneRoom('Bedroom', 4, 4), [{ kind: 'MOVE_CORNER', from: { x: 4, z: 4 }, to: { x: 5, z: 4 } }], LAYOUT);
    assert.equal(c.allowed, false);
    assert.deepEqual(c.suggestions, []);
  });

  test('suggestions never break the policy they are offered under', () => {
    const locked: EditPolicy = { ...LAYOUT, lockedWallIds: ['int-1'] };
    const c = checkEdit(sample, [{ kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 11, z: 0 } }], locked);
    assert.equal(c.allowed, false);
    assert.deepEqual(c.suggestions, [], 'the only interior alternative is locked too');
  });

  test('a sweep of drags: every suggestion offered is itself sound', () => {
    const corners: Vec2[] = [{ x: 6, z: 5 }, { x: 5.5, z: 5 }, { x: 8, z: 5 }, { x: 5.5, z: 8 }, { x: 8, z: 8 }, { x: 6, z: 0 }, { x: 10, z: 8 }];
    const deltas: Vec2[] = [{ x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 2.5 }, { x: 0, z: -2.5 }, { x: 2, z: 2 }];
    let offered = 0;
    for (const policy of [LAYOUT, FULL]) {
      for (const from of corners) {
        for (const d of deltas) {
          const c = checkEdit(sample, [{ kind: 'MOVE_CORNER', from, to: { x: from.x + d.x, z: from.z + d.z } }], policy);
          offered += c.suggestions.length;
          assertSuggestionsSound(sample, c.suggestions, policy);
        }
      }
    }
    check(offered > 5, `only ${offered} suggestions in the sweep`);
  });
});

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

describe('proposals', () => {
  const grow: PlanEdit[] = [
    { kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 11, z: 0 } },
    { kind: 'MOVE_CORNER', from: { x: 10, z: 8 }, to: { x: 11, z: 8 } },
  ];
  const shrink: PlanEdit[] = [
    { kind: 'MOVE_CORNER', from: { x: 10, z: 0 }, to: { x: 9.5, z: 0 } },
    { kind: 'MOVE_CORNER', from: { x: 10, z: 8 }, to: { x: 9.5, z: 8 } },
  ];

  test('createProposal describes the proposed plan without changing the project', () => {
    const before = structuredClone(sample);
    const p = createProposal(sample, grow, 'Asha', catalog, 'Push the east wall out');
    assert.deepEqual(sample, before);
    assert.equal(p.status, 'PENDING');
    assert.equal(p.author, 'Asha');
    assert.equal(p.note, 'Push the east wall out');
    assert.deepEqual(p.edits, grow);
    check(!Number.isNaN(Date.parse(p.createdAt)));
    assert.match(p.id, /^prop-/);
    assert.deepEqual(p.violations, validatePlan(applyEdits(sample, grow)));
  });

  test('costDelta: a bigger house costs more, a smaller one less', () => {
    check(createProposal(sample, grow, 'a', catalog).costDelta! > 0);
    check(createProposal(sample, shrink, 'a', catalog).costDelta! < 0);
    assert.equal(createProposal(sample, [], 'a', catalog).costDelta, 0);
  });

  test('ids are unique', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createProposal(sample, [], 'a', catalog).id));
    assert.equal(seen.size, 50);
  });

  test('acceptProposal applies the edits, marks it ACCEPTED and re-validates', () => {
    const proposal = createProposal(sample, grow, 'Asha', catalog);
    const pending = { ...sample, proposals: [proposal] };
    const snapshot = structuredClone(pending);
    const accepted = acceptProposal(pending, proposal.id);
    assert.deepEqual(pending, snapshot, 'input untouched');
    assert.equal(accepted.proposals![0].status, 'ACCEPTED');
    assert.deepEqual(accepted.floors, applyEdits(sample, grow).floors);
    assert.deepEqual(accepted.proposals![0].violations, validatePlan(accepted));
    assert.throws(() => acceptProposal(accepted, proposal.id), /already accepted/);
  });

  test('rejectProposal marks it REJECTED and leaves the plan alone', () => {
    const proposal = createProposal(sample, grow, 'Asha', catalog);
    const rejected = rejectProposal({ ...sample, proposals: [proposal] }, proposal.id);
    assert.equal(rejected.proposals![0].status, 'REJECTED');
    assert.deepEqual(rejected.floors, sample.floors);
    assert.throws(() => acceptProposal(rejected, proposal.id), /already rejected/);
  });

  test('an unknown proposal id throws', () => {
    assert.throws(() => acceptProposal(sample, 'nope'), /No proposal/);
    assert.throws(() => rejectProposal(sample, 'nope'), /No proposal/);
  });
});
