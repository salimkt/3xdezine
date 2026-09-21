/**
 * Postgres connection. One pool per process, created lazily so that tests and
 * tooling that never touch the database do not open sockets.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { config } from '../config.ts';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof makeDb>;

function makeDb(url: string, max: number) {
  const client = postgres(url, {
    max,
    // A dead database should fail fast and be reported by /health, not hang
    // an HTTP request until the client gives up.
    connect_timeout: 5,
    onnotice: () => {},
  });
  return { client, orm: drizzle(client, { schema, casing: 'snake_case' }) };
}

let singleton: { client: postgres.Sql; orm: ReturnType<typeof drizzle> } | undefined;

export function getDb(url = config.databaseUrl, max = 10) {
  singleton ??= makeDb(url, max);
  return singleton;
}

export async function closeDb(): Promise<void> {
  if (!singleton) return;
  await singleton.client.end({ timeout: 5 });
  singleton = undefined;
}

/** Cheap liveness probe used by `/api/health`. Never throws. */
export async function pingDb(): Promise<'up' | 'down'> {
  try {
    await getDb().orm.execute(sql`select 1`);
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * True when a real Postgres is reachable. Used by tests so the suite runs
 * green without Docker instead of failing on connection refused.
 */
export async function isDbReachable(url = config.databaseUrl): Promise<boolean> {
  const probe = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 2 }).catch(() => {});
  }
}
