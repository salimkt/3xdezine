/**
 * Fastify application factory.
 *
 * Kept separate from `server.ts` so tests can build an app and drive it with
 * `app.inject()` without binding a port.
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { config } from './config.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { costRoutes } from './routes/cost.ts';
import { healthRoutes } from './routes/health.ts';
import { projectRoutes } from './routes/projects.ts';
import { suggestionRoutes } from './routes/suggestions.ts';

export interface BuildOptions {
  logger?: boolean;
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            ...(config.nodeEnv === 'development'
              ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
              : {}),
          },
    // Floor plans with a few hundred walls are large but not unbounded.
    bodyLimit: 8 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  // One declaration per shape drives validation, serialization AND the
  // OpenAPI document. Registering these compilers is what wires that up.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // Scalar's reference app is a client-side bundle; the default CSP blocks it.
    contentSecurityPolicy: false,
  });
  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: '3xDezine API',
        version: config.version,
        description:
          'Catalog, cost estimation and material recommendations for the ' +
          '3xDezine house-design platform.\n\n' +
          'Units are metres and square metres. Money is a decimal number in ' +
          'the project currency. Costs are MATERIAL SUPPLY ONLY — no labour, ' +
          'delivery or tax.',
      },
      servers: [{ url: `http://localhost:${config.port}`, description: 'local dev' }],
      tags: [
        { name: 'meta', description: 'Health and diagnostics' },
        { name: 'catalog', description: 'Materials, components and style presets' },
        { name: 'cost', description: 'Deterministic material cost estimation' },
        { name: 'suggestions', description: 'Explainable material recommendations' },
        { name: 'projects', description: 'Saved designs' },
      ],
    },
    // Zod 4 emits JSON Schema natively, so no zod-to-openapi shim is needed.
    transform: jsonSchemaTransform,
    // `transformObject` is not optional here. Schemas carrying `.meta({ id })`
    // are emitted as `$ref: '#/components/schemas/...'`, and without this the
    // document ships those refs with an empty `components.schemas` — it looks
    // fine until a client tries to resolve one.
    transformObject: jsonSchemaTransformObject,
  });

  app.get(
    '/openapi.json',
    { schema: { hide: true } },
    async () => app.swagger(),
  );

  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { url: '/openapi.json', title: '3xDezine API' },
  });

  // --- errors: one shape, matching ApiError in shared/types.ts -------------
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: 'validation_error',
        message: `Request ${error.validationContext ?? 'body'} failed validation.`,
        details: error.validation,
      });
    }
    if (isResponseSerializationError(error)) {
      // A response that does not match its own schema is a server bug, not a
      // client one. Log loudly instead of quietly shipping a wrong shape.
      request.log.error({ err: error }, 'response failed its schema');
      return reply.code(500).send({
        error: 'response_serialization_error',
        message: 'The server produced a response that did not match its schema.',
        details: error.cause?.issues,
      });
    }
    const fallback = error as FastifyError;
    const status = fallback.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: fallback }, 'unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 ? 'Internal server error.' : fallback.message,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}.`,
    }),
  );

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(catalogRoutes);
      await api.register(costRoutes);
      await api.register(suggestionRoutes);
      await api.register(projectRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
