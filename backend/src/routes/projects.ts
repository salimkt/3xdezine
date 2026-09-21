import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  ApiErrorSchema,
  IdParamSchema,
  ProjectSchema,
  ProjectSummarySchema,
} from '../schemas.ts';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '../repo.ts';

/** Postgres rejects a malformed uuid with a 22P02, which would surface as a 500. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const notFound = (id: string) => ({
  error: 'not_found',
  message: `No project with id "${id}".`,
});

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects',
    {
      schema: {
        tags: ['projects'],
        summary: 'List saved projects',
        description:
          'Summaries only. The geometry document can be megabytes, and a list ' +
          'view never needs it — fetch `/projects/:id` for the full project.',
        response: { 200: z.array(ProjectSummarySchema) },
      },
    },
    async () => listProjects(),
  );

  app.post(
    '/projects',
    {
      schema: {
        tags: ['projects'],
        summary: 'Save a project',
        description: 'The id is assigned server-side with Postgres 18 `uuidv7()`.',
        body: ProjectSchema,
        response: { 201: ProjectSchema },
      },
    },
    async (req, reply) => {
      const created = await createProject(req.body);
      return reply.code(201).send(created);
    },
  );

  app.get(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Fetch a project',
        params: IdParamSchema,
        response: { 200: ProjectSchema, 404: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send(notFound(req.params.id));
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send(notFound(req.params.id));
      return project;
    },
  );

  app.put(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Replace a project',
        params: IdParamSchema,
        body: ProjectSchema,
        response: { 200: ProjectSchema, 404: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send(notFound(req.params.id));
      const updated = await updateProject(req.params.id, req.body);
      if (!updated) return reply.code(404).send(notFound(req.params.id));
      return updated;
    },
  );

  app.delete(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Delete a project',
        params: IdParamSchema,
        response: { 204: z.null(), 404: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send(notFound(req.params.id));
      const deleted = await deleteProject(req.params.id);
      if (!deleted) return reply.code(404).send(notFound(req.params.id));
      return reply.code(204).send(null);
    },
  );
};
