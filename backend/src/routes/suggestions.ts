import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { SuggestionRequestSchema, SuggestionResponseSchema } from '../schemas.ts';
import { getCachedCatalog } from '../repo.ts';
import { suggest } from '../suggest.ts';

export const suggestionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/suggestions',
    {
      schema: {
        tags: ['suggestions'],
        summary: 'Ranked material suggestions with a plain-language reason',
        description:
          'Three modes.\n\n' +
          '- `AESTHETIC` — 0.35·Harmony + 0.30·StyleFit + 0.15·Tone + ' +
          '0.10·Chroma + 0.10·Aesthetic. Colour work is done in OKLCH, so an ' +
          '18° harmony window means the same thing at every hue.\n' +
          '- `COST_EFFICIENCY` — Quality ÷ normLog(effective price), where ' +
          'effective price includes wastage and the log-price min/max is taken ' +
          'over the whole category, not the filtered result set.\n' +
          '- `BALANCED` — half of each.\n\n' +
          'Applicability is a **gate**, not a score: a material that cannot go ' +
          'on the surface is removed and listed under `exclusions`. Every item ' +
          'carries a `reason` built from its top contributing terms and a ' +
          '`breakdown` of component scores.',
        body: SuggestionRequestSchema,
        response: { 200: SuggestionResponseSchema },
      },
    },
    async (req) => {
      const catalog = await getCachedCatalog();
      const { limitPerSurface, ...request } = req.body;
      return suggest(request, catalog, { ...(limitPerSurface ? { limitPerSurface } : {}) });
    },
  );
};
