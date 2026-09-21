import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { CostBreakdownSchema, ProjectSchema } from '../schemas.ts';
import { getCachedCatalog } from '../repo.ts';
import { estimateCost } from '../shared.ts';

export const costRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/cost/estimate',
    {
      schema: {
        tags: ['cost'],
        summary: 'Price a project',
        description:
          'Takes the whole project rather than an id so the client can price ' +
          'an unsaved design on every edit. Pure and deterministic: the same ' +
          'project always yields the same breakdown.\n\n' +
          'Scope is MATERIAL SUPPLY ONLY — no labour, delivery or tax. Two ' +
          'buffers are applied and reported separately: per-material ' +
          '`wastageFactor` (offcuts and breakage, rolled into each line item ' +
          'and rounded up to whole packs where a material ships in boxes) and ' +
          'the project-wide `contingencyBuffer`.',
        body: ProjectSchema,
        response: { 200: CostBreakdownSchema },
      },
    },
    async (req) => {
      // Delegated wholesale to shared/cost.ts. The web client imports the very
      // same function, which is the only way the two can be guaranteed not to
      // disagree about a number a user might spend money against.
      const catalog = await getCachedCatalog();
      return estimateCost(req.body, catalog);
    },
  );
};
