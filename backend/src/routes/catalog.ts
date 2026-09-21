import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  ApiErrorSchema,
  CatalogSchema,
  ComponentProductSchema,
  IdParamSchema,
  MaterialQuerySchema,
  MaterialSchema,
  StylePresetSchema,
} from '../schemas.ts';
import {
  getCachedCatalog,
  getMaterial,
  listComponents,
  listMaterials,
  listStyles,
} from '../repo.ts';
import { z } from 'zod';

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog',
    {
      schema: {
        tags: ['catalog'],
        summary: 'The whole catalog in one call',
        description:
          'Materials, components and style presets together, for clients that ' +
          'want to hydrate once and filter locally. Served from a short-lived ' +
          'in-process cache.',
        response: { 200: CatalogSchema },
      },
    },
    async () => getCachedCatalog(),
  );

  app.get(
    '/materials',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Filter materials',
        description:
          'Every filter is a real indexed column. `surface` uses array ' +
          'containment; `style` accepts a raw tag or a StylePreset id; `q` is a ' +
          'case-insensitive match over name, description and subtype.',
        querystring: MaterialQuerySchema,
        response: { 200: z.array(MaterialSchema) },
      },
    },
    async (req) => listMaterials(req.query),
  );

  app.get(
    '/materials/:id',
    {
      schema: {
        tags: ['catalog'],
        summary: 'One material by id',
        params: IdParamSchema,
        response: { 200: MaterialSchema, 404: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      const material = await getMaterial(req.params.id);
      if (!material) {
        return reply.code(404).send({
          error: 'not_found',
          message: `No material with id "${req.params.id}".`,
        });
      }
      return material;
    },
  );

  app.get(
    '/components',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Doors, windows, lights and furniture',
        response: { 200: z.array(ComponentProductSchema) },
      },
    },
    async () => listComponents(),
  );

  app.get(
    '/styles',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Style presets',
        description:
          'Each preset carries its tag set, a palette, and a recommended ' +
          'material per surface. The recommendation engine uses these as the ' +
          'colour anchor when the user has not chosen anything yet.',
        response: { 200: z.array(StylePresetSchema) },
      },
    },
    async () => listStyles(),
  );
};
