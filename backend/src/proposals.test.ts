/**
 * Edit policy and proposals must survive the API: Zod strips unknown keys, so
 * a schema that forgot them would silently drop a review queue on save.
 *
 * The schema-only tests always run; the round trip through Postgres skips
 * when the database isn't reachable, like routes.test.ts.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from './app.ts';
import { closeDb, isDbReachable } from './db/client.ts';
import { readSampleProject, readSeedCatalog } from './shared.ts';
import { EditProposalSchema, PlanEditSchema, ProjectSchema } from './schemas.ts';
import { acceptProposal, createProposal } from '../../shared/rules.ts';
import type { PlanEdit, Project } from '../../shared/types.ts';
import type { FastifyInstance } from 'fastify';

const dbUp = await isDbReachable();
const needsDb = dbUp
  ? {}
  : { skip: 'Postgres is not reachable on localhost:5433 — run `docker compose up -d`' };

const sample = readSampleProject();
const catalog = readSeedCatalog();

const edits: PlanEdit[] = [
  { kind: 'MOVE_CORNER', from: { x: 6, z: 5 }, to: { x: 6.5, z: 5 } },
  { kind: 'MOVE_OPENING', openingId: 'op-door-bedroom', t: 0.25 },
  { kind: 'RESIZE_OPENING', openingId: 'op-door-hall', widthM: 0.8 },
  {
    kind: 'ADD_OPENING',
    opening: { id: 'op-new', wallId: 'int-3', componentId: 'door-flush-oak', t: 0.5, widthM: 0.9, heightM: 2.1, sillM: 0 },
  },
  { kind: 'REMOVE_OPENING', openingId: 'op-kitchen-pass' },
];

function withProposal(): Project {
  const proposal = createProposal(sample, edits, 'reviewer@example.com', catalog, 'Widen the living room');
  return {
    ...sample,
    templateId: '2bhk',
    policy: { level: 'LAYOUT', lockedWallIds: ['int-2'], requireReview: true },
    proposals: [proposal],
  };
}

describe('policy and proposal schemas', () => {
  test('every PlanEdit kind parses', () => {
    for (const e of edits) assert.deepEqual(PlanEditSchema.parse(e), e);
  });

  test('an unknown edit kind is rejected', () => {
    assert.equal(PlanEditSchema.safeParse({ kind: 'MOVE_WALL', wallId: 'x' }).success, false);
  });

  test('a proposal from shared/rules.ts parses unchanged', () => {
    const p = withProposal().proposals![0];
    assert.deepEqual(EditProposalSchema.parse(p), p);
  });

  test('ProjectSchema keeps policy, proposals and templateId', () => {
    const project = withProposal();
    const parsed = ProjectSchema.parse(project);
    assert.deepEqual(parsed.policy, project.policy);
    assert.deepEqual(parsed.proposals, project.proposals);
    assert.equal(parsed.templateId, '2bhk');
  });

  test('an invalid policy level is a validation error', () => {
    const bad = { ...withProposal(), policy: { level: 'ADMIN', lockedWallIds: [], requireReview: false } };
    assert.equal(ProjectSchema.safeParse(bad).success, false);
  });
});

describe('project round trip with a proposal', needsDb, () => {
  let app: FastifyInstance;
  let id: string;

  before(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  after(async () => {
    if (id) await app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    await app?.close();
    await closeDb();
  });

  test('POST then GET returns policy, proposals and templateId intact', async () => {
    const project = withProposal();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: project });
    assert.equal(res.statusCode, 201, res.payload);
    id = JSON.parse(res.payload).id;

    const got = ProjectSchema.parse(JSON.parse((await app.inject({ url: `/api/projects/${id}` })).payload));
    assert.deepEqual(got.policy, project.policy);
    assert.deepEqual(got.proposals, project.proposals);
    assert.equal(got.templateId, project.templateId);
  });

  test('PUT an accepted proposal persists the new geometry and status', async () => {
    const current = ProjectSchema.parse(JSON.parse((await app.inject({ url: `/api/projects/${id}` })).payload)) as Project;
    const accepted = acceptProposal(current, current.proposals![0].id);
    const res = await app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: accepted });
    assert.equal(res.statusCode, 200, res.payload);

    const got = ProjectSchema.parse(JSON.parse((await app.inject({ url: `/api/projects/${id}` })).payload));
    assert.equal(got.proposals![0].status, 'ACCEPTED');
    assert.deepEqual(got.floors, accepted.floors);
    assert.ok(got.floors[0]!.openings.some((o) => o.id === 'op-new'), 'the added door was saved');
  });

  test('a project without the new fields still round-trips without them', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: sample });
    const created = JSON.parse(res.payload);
    try {
      assert.equal('policy' in created, false);
      assert.equal('proposals' in created, false);
      assert.equal('templateId' in created, false);
    } finally {
      await app.inject({ method: 'DELETE', url: `/api/projects/${created.id}` });
    }
  });
});
