import { buildApp } from './app.ts';
import { config } from './config.ts';
import { closeDb } from './db/client.ts';

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`docs on http://localhost:${config.port}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
