/**
 * Who is calling, and the privileged client used for writes.
 *
 * The caller is identified by asking Auth (GoTrue) about the bearer token, so
 * a forged or expired JWT is rejected by the same service that issued it.
 * Writes then use the service-role client — RLS gives clients no write paths
 * on project tables at all.
 */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.117.2';
import { Fail } from './http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE_KEY;

let adminClient: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS: every use must follow an explicit access check. */
export function admin(): SupabaseClient {
  adminClient ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}

export interface Caller {
  id: string;
  email: string;
  emailConfirmed: boolean;
  displayName: string;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1];
}

/** The signed-in user, or undefined when the request is anonymous (no token, the anon key, or an invalid token). */
export async function optionalCaller(req: Request): Promise<Caller | undefined> {
  const token = bearer(req);
  if (!token || token.split('.').length !== 3) return undefined; // publishable/anon keys are not user sessions
  // A client bound to the caller's own JWT: getUser() validates it with Auth.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return undefined;
  return toCaller(data.user);
}

/** The signed-in user; throws UNAUTHENTICATED otherwise. */
export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await optionalCaller(req);
  if (!caller) throw new Fail('UNAUTHENTICATED', 'Please sign in to do that.');
  return caller;
}

async function toCaller(user: User): Promise<Caller> {
  const { data } = await admin().from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const email = (user.email ?? '').toLowerCase();
  return {
    id: user.id,
    email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    displayName: data?.display_name ?? (email.split('@')[0] || 'Someone'),
  };
}
