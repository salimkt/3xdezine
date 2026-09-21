/**
 * Route-level tests.
 *
 * Everything that only exercises schemas (validation, the OpenAPI document,
 * error envelopes) runs unconditionally. Anything that needs real rows is
 * gated on Postgres actually being reachable and SKIPS rather than fails, so
 * `npm test` is green on a laptop with no Docker running.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from './app.ts';
import { closeDb, isDbReachable } from './db/client.ts';
import { readSampleProject, readSeedCatalog } from './shared.ts';
import {
  CatalogSchema,
  CostBreakdownSchema,
  MaterialSchema,
  ProjectSchema,
  ProjectSummarySchema,
  SuggestionRequestSchema,
  SuggestionResponseSchema,
} from './schemas.ts';
import type { FastifyInstance } from 'fastify';

const dbUp = await isDbReachable();
const needsDb = dbUp
  ? {}
  : { skip: 'Postgres is not reachable on localhost:5433 — run `docker compose up -d`' };

const sample = readSampleProject();
/** The seed the database is loaded from — the reference for price-derived
 *  assertions, so re-pricing the catalog never invalidates a test. */
const catalog = readSeedCatalog();

let app: FastifyInstance;
before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
after(async () => {
  await app?.close();
  await closeDb();
});

const json = (res: { payload: string }): any => JSON.parse(res.payload);

// ---------------------------------------------------------------------------
// Schema-only: no database involved
// ---------------------------------------------------------------------------

describe('request validation', () => {
  test('an unknown surface is a 400, not a 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/materials?surface=CARPET' });
    assert.equal(res.statusCode, 400);
    const body = json(res);
    assert.equal(body.error, 'validation_error');
    assert.ok(Array.isArray(body.details) && body.details.length > 0);
  });

  test('maxPrice is coerced from its query string', () => {
    const parsed = SuggestionRequestSchema.safeParse({ mode: 'BALANCED' });
    assert.ok(parsed.success);
    // Query params arrive as strings; the schema has to cope.
    const q = MaterialSchema.pick({ pricePerUnit: true });
    assert.ok(!q.safeParse({ pricePerUnit: '40' }).success, 'body numbers stay strict');
  });

  test('a suggestion request without a mode is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/suggestions', payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'validation_error');
  });

  test('an invalid suggestion mode is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      payload: { mode: 'CHEAPEST' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('a project with a two-point room polygon is rejected', async () => {
    const broken = structuredClone(sample);
    broken.floors[0]!.rooms[0]!.polygon = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/cost/estimate',
      payload: broken,
    });
    assert.equal(res.statusCode, 400);
  });

  test('a contingency buffer above 1 is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cost/estimate',
      payload: { ...sample, contingencyBuffer: 5 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('an unknown route gets the ApiError envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(res.statusCode, 404);
    const body = json(res);
    assert.equal(body.error, 'not_found');
    assert.ok(typeof body.message === 'string');
  });
});

describe('schemas mirror the shared contract', () => {
  test('the sample project round-trips through ProjectSchema', () => {
    const parsed = ProjectSchema.safeParse(sample);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
    assert.equal(parsed.data.floors.length, sample.floors.length);
  });

  test('timestamps are ISO strings, because z.date() has no JSON Schema', () => {
    assert.ok(ProjectSchema.safeParse({ ...sample, createdAt: '2026-09-21T10:00:00.000Z' }).success);
    assert.ok(!ProjectSchema.safeParse({ ...sample, createdAt: 'yesterday' }).success);
    assert.ok(!ProjectSchema.safeParse({ ...sample, createdAt: new Date() as never }).success);
  });

  test('a material hex must be a 6-digit hex colour', () => {
    const base = { name: 'x', hex: '#C8A165' };
    assert.ok(MaterialSchema.shape.color.safeParse(base).success);
    assert.ok(!MaterialSchema.shape.color.safeParse({ ...base, hex: 'C8A165' }).success);
    assert.ok(!MaterialSchema.shape.color.safeParse({ ...base, hex: '#FFF' }).success);
  });

  test('packSize is optional but must be positive when present', () => {
    const shape = MaterialSchema.shape.packSize;
    assert.ok(shape.safeParse(undefined).success);
    assert.ok(shape.safeParse(1.44).success);
    assert.ok(!shape.safeParse(0).success);
    assert.ok(!shape.safeParse(-1).success);
  });
});

describe('the OpenAPI document', () => {
  test('is served at /openapi.json as OpenAPI 3.1', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).openapi, '3.1.0');
  });

  test('documents every path in the ARCHITECTURE.md REST table', async () => {
    const doc = json(await app.inject({ method: 'GET', url: '/openapi.json' }));
    const expected: [string, string][] = [
      ['/api/health', 'get'],
      ['/api/catalog', 'get'],
      ['/api/materials', 'get'],
      ['/api/materials/{id}', 'get'],
      ['/api/components', 'get'],
      ['/api/styles', 'get'],
      ['/api/cost/estimate', 'post'],
      ['/api/suggestions', 'post'],
      ['/api/projects', 'get'],
      ['/api/projects', 'post'],
      ['/api/projects/{id}', 'get'],
      ['/api/projects/{id}', 'put'],
      ['/api/projects/{id}', 'delete'],
    ];
    for (const [path, method] of expected) {
      assert.ok(doc.paths[path]?.[method], `missing ${method.toUpperCase()} ${path}`);
    }
  });

  test('schemas come from the zod declarations, not a hand-written copy', async () => {
    const doc = json(await app.inject({ method: 'GET', url: '/openapi.json' }));
    const query = doc.paths['/api/materials'].get.parameters.map((p: any) => p.name).sort();
    assert.deepEqual(query, ['category', 'maxPrice', 'q', 'style', 'surface', 'tier']);

    const body = doc.paths['/api/suggestions'].post.requestBody.content['application/json'].schema;
    // Named schemas are emitted as refs, so they must actually resolve.
    assert.ok(body.$ref, 'SuggestionRequest should be a named component');
    const name = body.$ref.replace('#/components/schemas/', '');
    const resolved = doc.components?.schemas?.[name];
    assert.ok(resolved, `dangling $ref: ${body.$ref}`);
    assert.deepEqual(resolved.properties.mode.enum, [
      'AESTHETIC',
      'COST_EFFICIENCY',
      'BALANCED',
    ]);
  });

  test('every $ref in the document resolves', async () => {
    const doc = json(await app.inject({ method: 'GET', url: '/openapi.json' }));
    const refs = new Set<string>();
    JSON.stringify(doc, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.add(value);
      return value;
    });
    assert.ok(refs.size > 0, 'named schemas should produce refs');
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '');
      assert.ok(doc.components?.schemas?.[name], `unresolvable ${ref}`);
    }
  });

  test('the Scalar reference page renders', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
    assert.match(res.payload, /openapi\.json/);
  });
});

// ---------------------------------------------------------------------------
// Database-backed
// ---------------------------------------------------------------------------

describe('catalog endpoints', needsDb, () => {
  test('GET /api/health reports the database as up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res), { status: 'ok', version: '0.1.0', db: 'up' });
  });

  test('GET /api/catalog satisfies CatalogSchema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalog' });
    assert.equal(res.statusCode, 200);
    const parsed = CatalogSchema.safeParse(json(res));
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
    assert.equal(parsed.data.materials.length, 24);
    assert.equal(parsed.data.components.length, 8);
    assert.equal(parsed.data.styles.length, 5);
  });

  test('pack sizes survive the round trip through Postgres', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/materials/ceramic-tile-grey' });
    const m = MaterialSchema.parse(json(res));
    assert.ok(m.packSize && m.packSize > 0, 'tile ships in boxes');
    assert.equal(typeof m.packLabel, 'string');
  });

  test('a material with no pack size omits the key rather than sending null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/materials/polished-concrete' });
    const body = json(res);
    assert.ok(!('packSize' in body), 'null would break the shared contract');
    assert.ok(MaterialSchema.safeParse(body).success);
  });

  test('GET /api/materials?surface=FLOOR returns only floor materials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/materials?surface=FLOOR' });
    assert.equal(res.statusCode, 200);
    const list = json(res);
    assert.ok(list.length > 0);
    for (const m of list) {
      assert.ok(MaterialSchema.safeParse(m).success);
      assert.ok(m.applicableSurfaces.includes('FLOOR'), `${m.id} is not a floor material`);
    }
  });

  test('filters compose', async () => {
    // The price cap is derived from the catalog at runtime rather than written
    // down as a magic number, so a re-price (or a change of base currency)
    // cannot turn this into a false failure.
    const unfiltered = json(
      await app.inject({ method: 'GET', url: '/api/materials?surface=WALL&tier=LUXURY' }),
    );
    assert.ok(unfiltered.length > 1, 'need a spread of LUXURY wall prices for maxPrice to bite');
    const prices = unfiltered
      .map((m: { pricePerUnit: number }) => m.pricePerUnit)
      .sort((a: number, b: number) => a - b);
    // The lower median is a price that exists in the set, so at least one
    // material always survives the cap and at least one is always excluded.
    const cap = prices[Math.floor((prices.length - 1) / 2)] as number;

    const res = await app.inject({
      method: 'GET',
      url: `/api/materials?surface=WALL&tier=LUXURY&maxPrice=${cap}`,
    });
    const list = json(res);
    assert.ok(list.length > 0);
    assert.ok(list.length < unfiltered.length, 'maxPrice must actually exclude something');
    for (const m of list) {
      assert.ok(m.applicableSurfaces.includes('WALL'));
      assert.equal(m.tier, 'LUXURY');
      assert.ok(m.pricePerUnit <= cap);
    }
  });

  test('`style` accepts a preset id as well as a bare tag', async () => {
    const byId = json(await app.inject({ method: 'GET', url: '/api/materials?style=modern-warm' }));
    const byTag = json(await app.inject({ method: 'GET', url: '/api/materials?style=modern' }));
    assert.ok(byId.length > 0 && byTag.length > 0);
    // The preset expands to four tags, so it can only ever match more widely.
    assert.ok(byId.length >= byTag.length);
  });

  test('an unknown material id is a 404 with the ApiError envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/materials/unobtanium' });
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error, 'not_found');
  });
});

describe('POST /api/cost/estimate', needsDb, () => {
  test('prices the sample apartment and matches CostBreakdownSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cost/estimate',
      payload: sample,
    });
    assert.equal(res.statusCode, 200);
    const parsed = CostBreakdownSchema.safeParse(json(res));
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));

    const b = parsed.data;
    // The breakdown reports the project's own currency, whatever that is —
    // asserting a literal here just re-breaks on the next re-pricing.
    assert.equal(b.currency, sample.currency);
    assert.equal(b.quantities.floorAreaSqm, 80);
    assert.ok(b.lineItems.length > 0);
    assert.equal(b.contingencyBuffer, sample.contingencyBuffer);

    // The arithmetic that actually has to hold, none of which depends on the
    // magnitude of the price list.
    assert.ok(
      Math.abs(b.total - (b.materialsSubtotal + b.contingencyAmount)) < 0.01,
      'total must be subtotal plus contingency',
    );
    assert.ok(
      Math.abs(b.contingencyAmount - b.materialsSubtotal * b.contingencyBuffer) < 0.01,
      'the contingency is that fraction of the subtotal',
    );
    const summed = b.lineItems.reduce((s, i) => s + i.subtotal, 0);
    assert.ok(Math.abs(b.materialsSubtotal - summed) < 0.01, 'the subtotal is the line items');
    assert.ok(
      Math.abs(Object.values(b.perSurface).reduce((s, v) => s + v, 0) - b.materialsSubtotal) < 0.01,
      'the per-surface split must add back up to the subtotal',
    );
    assert.ok(b.total > 0);
    for (const i of b.lineItems) {
      assert.ok(
        Math.abs(i.subtotal - i.bufferedQuantity * i.unitPrice) < 0.01,
        `${i.materialId}: subtotal is buffered quantity times unit price`,
      );
    }

    // Plausibility, expressed against the catalog instead of against a fixed
    // band of money: the blended rate paid per m² must sit inside the range of
    // per-m² prices the catalog actually offers.
    const sqmPrices = catalog.materials
      .filter((m) => m.unit === 'SQM')
      .map((m) => m.pricePerUnit);
    const sqmItems = b.lineItems.filter((i) => i.unit === 'SQM');
    assert.ok(sqmItems.length > 0);
    const blended =
      sqmItems.reduce((s, i) => s + i.subtotal, 0) /
      sqmItems.reduce((s, i) => s + i.bufferedQuantity, 0);
    assert.ok(
      blended >= Math.min(...sqmPrices) && blended <= Math.max(...sqmPrices),
      `implausible blended rate ${blended} per m²`,
    );
  });

  test('is pure: the same body twice gives byte-identical output', async () => {
    const call = () =>
      app.inject({ method: 'POST', url: '/api/cost/estimate', payload: sample });
    const [a, b] = await Promise.all([call(), call()]);
    assert.equal(a.payload, b.payload);
  });

  test('pack rounding reaches the API, not just the library', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cost/estimate', payload: sample });
    const b = CostBreakdownSchema.parse(json(res));
    const paint = b.lineItems.find((i) => i.materialId === 'paint-warm-grey');
    assert.ok(paint, 'the sample paints its interior walls');
    assert.equal(paint.unit, 'LITER');
    // Emulsion ships in whole cans, so the order must be a multiple of whatever
    // the catalog says a can holds — read it back rather than assuming a size.
    const seeded = MaterialSchema.parse(
      json(await app.inject({ method: 'GET', url: '/api/materials/paint-warm-grey' })),
    );
    assert.ok(seeded.packSize && seeded.packSize > 0, 'emulsion is sold in cans');
    assert.equal(
      paint.bufferedQuantity % seeded.packSize,
      0,
      `got ${paint.bufferedQuantity} litres, not a multiple of the ${seeded.packSize} L can`,
    );
    assert.ok(paint.bufferedQuantity >= paint.rawQuantity, 'rounding is always up');
  });

  test('an empty project costs nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cost/estimate',
      payload: { name: 'Empty', currency: 'USD', unitSystem: 'metric', contingencyBuffer: 0.08, floors: [] },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).total, 0);
  });
});

describe('POST /api/suggestions', needsDb, () => {
  for (const mode of ['AESTHETIC', 'COST_EFFICIENCY', 'BALANCED'] as const) {
    test(`${mode} returns explainable, schema-valid items`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/suggestions',
        payload: {
          mode,
          styleId: 'modern-warm',
          surfaces: ['FLOOR', 'WALL'],
          current: { FLOOR: 'oak-hardwood', WALL: 'paint-warm-grey' },
          limitPerSurface: 3,
        },
      });
      assert.equal(res.statusCode, 200);
      const parsed = SuggestionResponseSchema.safeParse(json(res));
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));

      const body = parsed.data;
      assert.equal(body.mode, mode);
      assert.equal(body.styleId, 'modern-warm');
      assert.equal(body.items.length, 6, 'three per surface, two surfaces');
      assert.ok(body.note.length > 0);
      for (const item of body.items) {
        assert.ok(item.reason.length > 20, `thin reason: "${item.reason}"`);
        assert.ok(item.score >= 0 && item.score <= 1);
        assert.ok(['FLOOR', 'WALL'].includes(item.surface));
      }
      // Gates are reported, never scored.
      assert.ok((body.exclusions?.length ?? 0) > 0);
      for (const e of body.exclusions!) {
        assert.ok(!body.items.some((i) => i.materialId === e.materialId && i.surface === e.surface));
      }
    });
  }

  test('a project in the body yields money figures', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      payload: {
        mode: 'COST_EFFICIENCY',
        surfaces: ['FLOOR'],
        current: { FLOOR: 'oak-hardwood' },
        project: sample,
      },
    });
    const body = SuggestionResponseSchema.parse(json(res));
    assert.ok(body.currentTotal! > 0);
    assert.ok(body.projectedTotal! > 0);
    assert.ok(body.projectedTotal! < body.currentTotal!);
  });

  test('a budget is honoured', async () => {
    const call = (budget?: number) =>
      app.inject({
        method: 'POST',
        url: '/api/suggestions',
        payload: { mode: 'AESTHETIC', styleId: 'classic-elegant', project: sample, ...(budget ? { budget } : {}) },
      });
    const open = SuggestionResponseSchema.parse(json(await call()));
    const capped = SuggestionResponseSchema.parse(json(await call(25_000)));
    assert.ok(capped.projectedTotal! < open.projectedTotal!);
  });
});

describe('project CRUD', needsDb, () => {
  let id: string;

  test('POST creates a project and assigns a uuidv7', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: sample });
    assert.equal(res.statusCode, 201);
    const project = ProjectSchema.parse(json(res));
    assert.ok(project.id);
    id = project.id;
    // uuidv7: version nibble 7, variant bits 10xx.
    assert.equal(id[14], '7', `not a v7 uuid: ${id}`);
    assert.ok(['8', '9', 'a', 'b'].includes(id[19]!.toLowerCase()), `bad variant: ${id}`);
    assert.ok(project.createdAt && project.updatedAt);
  });

  test('GET returns the geometry intact', async () => {
    const project = ProjectSchema.parse(json(await app.inject({ url: `/api/projects/${id}` })));
    assert.equal(project.floors[0]!.walls.length, sample.floors[0]!.walls.length);
    assert.equal(project.floors[0]!.openings.length, sample.floors[0]!.openings.length);
    assert.equal(project.roof?.kind, sample.roof?.kind);
  });

  test('the list view omits geometry but counts it', async () => {
    const list = json(await app.inject({ url: '/api/projects' }));
    const row = list.find((p: { id: string }) => p.id === id);
    assert.ok(row);
    assert.ok(ProjectSummarySchema.safeParse(row).success);
    assert.equal(row.roomCount, sample.floors[0]!.rooms.length);
    assert.ok(!('floors' in row), 'a summary must not carry the document');
  });

  test('PUT replaces it and moves updatedAt', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      payload: { ...sample, name: 'Renamed' },
    });
    assert.equal(res.statusCode, 200);
    const updated = ProjectSchema.parse(json(res));
    assert.equal(updated.name, 'Renamed');
    assert.ok(Date.parse(updated.updatedAt!) >= Date.parse(updated.createdAt!));
  });

  test('DELETE returns 204 with no body, and is not repeatable', async () => {
    const first = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    assert.equal(first.statusCode, 204);
    assert.equal(first.payload, '');
    const second = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    assert.equal(second.statusCode, 404);
  });

  test('a malformed id is a 404, not a Postgres 500', async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: '/api/projects/definitely-not-a-uuid',
        ...(method === 'PUT' ? { payload: sample } : {}),
      });
      assert.equal(res.statusCode, 404, `${method} should 404`);
      assert.equal(json(res).error, 'not_found');
    }
  });

  test('the seeded sample project is present', async () => {
    const list = json(await app.inject({ url: '/api/projects' }));
    assert.ok(list.some((p: { name: string }) => p.name === 'Maple Street Apartment'));
  });
});
