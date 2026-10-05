import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { estimateCost, polygonArea, wallLength } from './cost.ts';
import { checkEdit, effectivePolicy, inferRoomKind, isWindow, validatePlan } from './rules.ts';
import { buildAll, formatJson } from './templates/generate.ts';
import type { Catalog, PlanTemplateMeta, Project } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'templates');
const catalog = JSON.parse(readFileSync(join(here, 'catalog.seed.json'), 'utf8')) as Catalog;
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as PlanTemplateMeta[];
const load = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Project;
const templates = index.map((meta) => ({ meta, project: load(meta.file) }));

const check: (value: unknown, message?: string) => asserts value = (value, message = 'expected a truthy value') =>
  assert.ok(value, message);

const materialIds = new Set(catalog.materials.map((m) => m.id));
const componentIds = new Set(catalog.components.map((c) => c.id));
const styleIds = new Set(catalog.styles.map((s) => s.id));

describe('template index', () => {
  test('lists 8 templates, each with its own file', () => {
    assert.equal(index.length, 8);
    assert.equal(new Set(index.map((m) => m.id)).size, 8);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    assert.deepEqual(index.map((m) => m.file).sort(), files);
  });

  test('covers the requested range of homes and one commercial plan', () => {
    const by = Object.fromEntries(index.map((m) => [m.id, m]));
    const within = (id: string, lo: number, hi: number) =>
      check(by[id] && by[id].builtUpSqm >= lo && by[id].builtUpSqm <= hi, `${id} is ${by[id]?.builtUpSqm} m², wanted ${lo}–${hi}`);
    within('studio', 28, 32);
    within('1bhk', 42, 48);
    within('2bhk-compact', 60, 65);
    within('2bhk', 76, 84);
    within('3bhk', 105, 115);
    within('4bhk-villa', 170, 190);
    within('row-house', 115, 125);
    within('cafe', 60, 80);
    assert.deepEqual(index.map((m) => m.bhk), [0, 1, 2, 2, 3, 4, 3, 0]);
    assert.deepEqual([...new Set(index.map((m) => m.category))].sort(), ['APARTMENT', 'COMMERCIAL', 'STUDIO', 'VILLA']);
  });

  test('uses all five catalog style presets', () => {
    for (const m of index) check(styleIds.has(m.styleId), `${m.id}: unknown style ${m.styleId}`);
    assert.equal(new Set(index.map((m) => m.styleId)).size, 5);
  });

  test('builtUpSqm, rooms and bhk match the files', () => {
    for (const { meta, project } of templates) {
      const rooms = project.floors.flatMap((f) => f.rooms);
      const area = Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) * 100) / 100;
      assert.equal(meta.builtUpSqm, area, meta.id);
      assert.equal(meta.rooms, rooms.length, meta.id);
      const beds = rooms.filter((r) => inferRoomKind(r.name) === 'HABITABLE' && /\b(bed|bedroom|master)\b/i.test(r.name));
      assert.equal(meta.bhk, beds.length, meta.id);
      assert.equal(project.templateId, meta.id);
      assert.equal(project.name, meta.name);
      check(meta.tagline.length > 10, `${meta.id} needs a tagline`);
    }
  });

  test('the committed JSON is exactly what the generator produces', () => {
    const built = buildAll();
    assert.equal(built.length, templates.length);
    for (const { spec, project } of built) {
      assert.equal(readFileSync(join(dir, spec.file), 'utf8'), formatJson(project) + '\n', `${spec.file} is stale — rerun generate.ts`);
    }
  });
});

describe('every template', () => {
  for (const { meta, project } of templates) {
    describe(meta.id, () => {
      const floor = project.floors[0];
      const violations = validatePlan(project);

      test('validates with zero errors and zero NBC warnings', () => {
        assert.deepEqual(violations.filter((v) => v.severity === 'ERROR'), []);
        assert.deepEqual(violations.filter((v) => v.ruleId === 'room.min-area' || v.ruleId === 'room.min-width'), []);
        // Ceiling heights are 2.85 m or more, so there is no exception to make.
        assert.deepEqual(violations.filter((v) => v.severity === 'WARNING'), []);
        assert.deepEqual(violations.filter((v) => v.ruleId === 'room.no-access'), [], 'every room can be entered');
      });

      test('project basics', () => {
        assert.equal(project.currency, 'INR');
        assert.equal(project.unitSystem, 'metric');
        assert.equal(project.contingencyBuffer, 0.08);
        assert.equal(project.floors.length, 1, 'renderers support one storey');
        assert.equal(floor.level, 0);
        check(project.roof, 'has a roof');
        check(project.policy, 'has a policy');
        assert.equal(project.id, undefined, 'ids are assigned by the server');
        for (const r of floor.rooms) check(r.ceilingHeightM >= 2.75 && r.ceilingHeightM <= 3.3, `${r.name} ceiling ${r.ceilingHeightM}`);
      });

      test('references only catalog materials and components', () => {
        const used = [
          project.roof?.materialId,
          ...floor.walls.flatMap((w) => [w.interiorMaterialId, w.exteriorMaterialId]),
          ...floor.rooms.flatMap((r) => [r.floorMaterialId, r.ceilingMaterialId]),
        ].filter((x): x is string => !!x);
        for (const id of used) check(materialIds.has(id), `${meta.id}: unknown material ${id}`);
        for (const o of floor.openings) if (o.componentId) check(componentIds.has(o.componentId), `${meta.id}: unknown component ${o.componentId}`);
        for (const c of floor.components) check(componentIds.has(c.componentId), `${meta.id}: unknown component ${c.componentId}`);
        for (const r of floor.rooms) check(r.floorMaterialId && r.ceilingMaterialId, `${r.name} is finished`);
        for (const w of floor.walls) check(w.interiorMaterialId && (!w.exterior || w.exteriorMaterialId), `${w.id} is finished`);
      });

      test('walls: a closed 230 mm exterior loop and 115 mm partitions', () => {
        const ext = floor.walls.filter((w) => w.exterior);
        check(ext.length >= 4, 'at least four exterior walls');
        for (const w of floor.walls) {
          assert.equal(w.thicknessM, w.exterior ? 0.23 : 0.115, w.id);
          check(wallLength(w.start, w.end) >= 0.3, w.id);
        }
        for (const w of ext) {
          const joined = ext.filter((o) => o !== w && (o.start.x === w.end.x && o.start.z === w.end.z));
          assert.equal(joined.length, 1, `${w.id} ends where the next exterior wall starts`);
        }
      });

      test('rooms tile the footprint without overlapping', () => {
        const xs = floor.walls.filter((w) => w.exterior).flatMap((w) => [w.start.x, w.end.x]);
        const zs = floor.walls.filter((w) => w.exterior).flatMap((w) => [w.start.z, w.end.z]);
        const footprint = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
        const total = floor.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
        assert.ok(Math.abs(total - footprint) < 1e-6, `rooms ${total} vs footprint ${footprint}`);
        // Axis-aligned rectangles: pairwise intersection area must be zero.
        const box = (r: (typeof floor.rooms)[number]) => {
          const px = r.polygon.map((p) => p.x);
          const pz = r.polygon.map((p) => p.z);
          return [Math.min(...px), Math.min(...pz), Math.max(...px), Math.max(...pz)];
        };
        for (let i = 0; i < floor.rooms.length; i++) {
          assert.ok(Math.abs(polygonArea(floor.rooms[i].polygon) - (box(floor.rooms[i])[2] - box(floor.rooms[i])[0]) * (box(floor.rooms[i])[3] - box(floor.rooms[i])[1])) < 1e-9, 'rooms are rectangles');
          for (let j = i + 1; j < floor.rooms.length; j++) {
            const [a0, b0, a1, b1] = box(floor.rooms[i]);
            const [c0, d0, c1, d1] = box(floor.rooms[j]);
            const overlap = Math.max(0, Math.min(a1, c1) - Math.max(a0, c0)) * Math.max(0, Math.min(b1, d1) - Math.max(b0, d0));
            assert.equal(overlap, 0, `${floor.rooms[i].name} overlaps ${floor.rooms[j].name}`);
          }
        }
      });

      test('habitable rooms, kitchens and toilets have windows on exterior walls', () => {
        const walls = new Map(floor.walls.map((w) => [w.id, w]));
        for (const room of floor.rooms) {
          const kind = inferRoomKind(room.name);
          if (!['HABITABLE', 'KITCHEN', 'BATH_WC', 'BATH', 'WC'].includes(kind)) continue;
          // No daylight or ventilation warning means an exterior window is on this room.
          check(!violations.some((v) => v.roomId === room.id && (v.ruleId === 'room.daylight' || v.ruleId === 'room.ventilation')), room.name);
        }
        check(floor.openings.some((o) => o.componentId === 'door-entry-walnut' && walls.get(o.wallId)?.exterior), 'has an entrance door');
        check(floor.openings.filter(isWindow).every((o) => walls.get(o.wallId)?.exterior), 'windows are on exterior walls');
      });

      test('coordinates are rounded to the centimetre', () => {
        const pts = [...floor.walls.flatMap((w) => [w.start, w.end]), ...floor.rooms.flatMap((r) => r.polygon), ...floor.components.map((c) => c.position)];
        for (const p of pts) {
          assert.equal(Math.round(p.x * 100) / 100, p.x);
          assert.equal(Math.round(p.z * 100) / 100, p.z);
        }
      });

      test('prices out through the cost engine', () => {
        const cost = estimateCost(project, catalog);
        check(cost.total > 0, 'has a cost');
        assert.equal(cost.currency, 'INR');
        assert.equal(cost.quantities.floorAreaSqm, meta.builtUpSqm);
      });

      test('fits the size budget (10 KB)', () => {
        const bytes = statSync(join(dir, meta.file)).size;
        check(bytes <= 10 * 1024, `${meta.file} is ${bytes} bytes`);
      });
    });
  }

  test('all templates together stay under 80 KB', () => {
    const total = readdirSync(dir).filter((f) => f.endsWith('.json')).reduce((s, f) => s + statSync(join(dir, f)).size, 0);
    check(total <= 80 * 1024, `${total} bytes`);
  });
});

describe('the review-gated demo', () => {
  test('one template requires review and locks its load-bearing walls', () => {
    const gated = templates.filter((t) => t.project.policy?.requireReview);
    assert.equal(gated.length, 1);
    const { project } = gated[0];
    const policy = effectivePolicy(project);
    check(policy.lockedWallIds.length > 0, 'locks walls');
    for (const id of policy.lockedWallIds) check(project.floors[0].walls.some((w) => w.id === id), `${id} exists`);
    // The lock bites: the corner where a locked spine wall meets a partition can't move at Layout level.
    const spine = project.floors[0].walls.find((w) => w.id === policy.lockedWallIds[0])!;
    const c = checkEdit(project, [{ kind: 'MOVE_CORNER', from: spine.end, to: { x: spine.end.x + 0.3, z: spine.end.z } }]);
    assert.equal(c.allowed, false);
    assert.match(c.reason!, /load-bearing/);
  });

  test('the others use the default policy', () => {
    for (const { meta, project } of templates) {
      if (project.policy?.requireReview) continue;
      assert.deepEqual(project.policy, { level: 'LAYOUT', lockedWallIds: [], requireReview: false }, meta.id);
    }
  });
});
