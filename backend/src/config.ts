/** Runtime configuration. Everything overridable by env, with dev-safe defaults. */

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  /** Matches docker-compose: Postgres 18 on host port 5433 (not 5432). */
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://dezine:dezine@localhost:5433/dezine',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  version: '0.1.0',
} as const;
