/**
 * HTTP plumbing shared by every Edge Function: CORS, JSON responses and the
 * one error shape (`CloudError` from shared/cloud.ts).
 *
 * Status codes follow the error code (401/403/404/409/400/500) and the body is
 * always JSON, `{ ok: true, ... }` or `{ ok: false, code, message, ... }`.
 */
import type { CloudError } from './domain/cloud.ts';
import type { RuleViolation } from './domain/types.ts';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5183',
  'http://127.0.0.1:5183',
  'https://salimkt.github.io',
  ...(Deno.env.get('EXTRA_CORS_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const STATUS: Record<CloudError['code'], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID: 400,
  INTERNAL: 500,
};

/** Throw this anywhere inside a handler; `serve` turns it into a CloudError response. */
export class Fail extends Error {
  constructor(
    readonly code: CloudError['code'],
    message: string,
    readonly extra: { violations?: RuleViolation[]; currentVersion?: number } = {},
  ) {
    super(message);
  }
}

export const invalid = (message: string) => new Fail('INVALID', message);
export const forbidden = (message: string, violations?: RuleViolation[]) =>
  new Fail('FORBIDDEN', message, violations ? { violations } : {});
export const notFound = (message = 'That project doesn’t exist or isn’t shared with you.') =>
  new Fail('NOT_FOUND', message);
export const conflict = (currentVersion: number) =>
  new Fail('CONFLICT', 'Someone saved this project since you opened it. Reload to get their changes.', { currentVersion });

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Wraps a handler: answers CORS preflight, requires POST + a JSON object body,
 * and maps thrown errors to CloudError responses.
 */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    try {
      if (req.method !== 'POST') throw invalid('Use POST.');
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw invalid('The request body must be JSON.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('The request body must be a JSON object.');
      const result = await handler(req, body as Record<string, unknown>);
      return json(req, 200, { ok: true, ...result });
    } catch (err) {
      if (err instanceof Fail) {
        const payload: CloudError = { ok: false, code: err.code, message: err.message, ...err.extra };
        return json(req, STATUS[err.code], payload);
      }
      console.error(err);
      const payload: CloudError = { ok: false, code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' };
      return json(req, 500, payload);
    }
  });
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw invalid(`\`${key}\` must be an id.`);
  return v.toLowerCase();
}

export function str(body: Record<string, unknown>, key: string, opts: { max?: number; optional?: boolean } = {}): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw invalid(`\`${key}\` is required.`);
  }
  if (typeof v !== 'string') throw invalid(`\`${key}\` must be text.`);
  const t = v.trim();
  if (!opts.optional && !t) throw invalid(`\`${key}\` can’t be empty.`);
  if (opts.max && t.length > opts.max) throw invalid(`\`${key}\` is too long (max ${opts.max} characters).`);
  return t;
}

export function int(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalid(`\`${key}\` must be a whole number.`);
  return v;
}

export function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = body[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw invalid(`\`${key}\` must be one of ${allowed.join(', ')}.`);
  }
  return v as T;
}
