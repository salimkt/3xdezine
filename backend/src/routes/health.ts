import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { HealthSchema } from '../schemas.ts';
import { pingDb } from '../db/client.ts';
import { config } from '../config.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['meta'],
        summary: 'Liveness and database reachability',
        description:
          'Always 200 so an orchestrator can distinguish "the process is up ' +
          'but Postgres is not" from "the process is gone". Read `db`.',
        response: { 200: HealthSchema },
      },
    },
    async () => {
      const db = await pingDb();
      return { status: db === 'up' ? ('ok' as const) : ('degraded' as const), version: config.version, db };
    },
  );
};
