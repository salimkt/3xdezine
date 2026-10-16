import {
  BUSINESS_FUNCTIONS,
  type CancelSubscriptionResponse,
  type CreateCheckoutRequest,
  type CreateCheckoutResponse,
  type CreateVariationOrderRequest,
  type CreateVariationOrderResponse,
  type Entitlements,
  type IssueQuoteResponse,
  type OpenQuoteResponse,
  type QuotationDocument,
  type RateCardOverrides,
  type RespondToQuoteRequest,
  type RespondToQuoteResponse,
  type SaveQuoteDraftRequest,
  type SaveQuoteDraftResponse,
  type SaveStudioRequest,
  type SaveStudioResponse,
  type StudioProfile,
} from '@shared/business';
import type { CloudError } from '@shared/cloud';
import { CLOUD_ANON_KEY, CLOUD_ENABLED, CLOUD_URL, loadEngine, useCloud } from '../cloud/state';
import { saveLocalStudio, useBiz } from './state';

/**
 * Every business call. Two doors:
 *
 *  - `publicCall` — `open-quote` and `respond-to-quote`, for the client
 *    approval page. A plain `fetch` with the anon key: the homeowner on a phone
 *    never downloads supabase-js.
 *  - `authedCall` — everything else, through the cloud engine (supabase-js,
 *    the signed-in session), loaded on first use.
 *
 * Neither does anything without cloud configured; callers check
 * `CLOUD_ENABLED` first and fall back to local behaviour.
 */

export class BizError extends Error {
  code: string;
  details?: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function publicCall<T extends { ok: true }>(name: string, body: object): Promise<T> {
  if (!CLOUD_ENABLED) throw new BizError('Cloud is not configured.', 'OFFLINE');
  let res: Response;
  try {
    res = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: CLOUD_ANON_KEY,
        authorization: `Bearer ${CLOUD_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BizError('Can’t reach the server right now. Check your connection and try again.', 'NETWORK');
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON */
  }
  const p = payload as (T | CloudError | null);
  if (!res.ok || !p || (p as { ok?: unknown }).ok !== true) {
    const err = p && (p as CloudError).ok === false ? (p as CloudError) : null;
    throw new BizError(
      err?.message ?? `The server answered ${res.status}.`,
      err?.code ?? (res.status === 404 ? 'NOT_FOUND' : res.status === 409 ? 'CONFLICT' : 'INTERNAL'),
      err ?? undefined,
    );
  }
  return p as T;
}

export async function authedCall<T extends { ok: true }>(name: string, body: object): Promise<T> {
  if (!CLOUD_ENABLED) throw new BizError('Sign in to do this — cloud is not configured on this site.', 'OFFLINE');
  if (useCloud.getState().status !== 'signedIn') throw new BizError('Sign in first.', 'UNAUTHENTICATED');
  const engine = await loadEngine();
  try {
    return (await engine.invokeFunction<T>(name, body)) as T;
  } catch (e) {
    const err = e as Error & { code?: string; details?: unknown };
    throw new BizError(err.message, err.code ?? 'INTERNAL', err.details);
  }
}

export const isSignedIn = () => CLOUD_ENABLED && useCloud.getState().status === 'signedIn';

// ---------------------------------------------------------------------------
// Entitlements and studio
// ---------------------------------------------------------------------------

interface EntitlementsResponse {
  ok: true;
  entitlements?: Entitlements;
  studio?: StudioProfile | null;
  overrides?: RateCardOverrides | null;
}

let entitlementsSeq = 0;

/** Re-reads the plan (after sign-in, and after a checkout). Silent on failure: FREE stays. */
export async function refreshEntitlements(): Promise<Entitlements | null> {
  if (!isSignedIn()) {
    useBiz.setState({ entitlements: null });
    return null;
  }
  const seq = ++entitlementsSeq;
  try {
    const r = await authedCall<EntitlementsResponse>(BUSINESS_FUNCTIONS.getEntitlements, {});
    if (seq !== entitlementsSeq) return null;
    const ents = r.entitlements ?? ((r as unknown as Entitlements).plan ? (r as unknown as Entitlements) : null);
    useBiz.setState({ entitlements: ents });
    if (r.studio) useBiz.setState({ studio: r.studio, studioSource: 'cloud' });
    if (r.overrides !== undefined) cloudOverrides = r.overrides ?? null;
    return ents;
  } catch (e) {
    console.warn('[3xDezine] entitlements unavailable', e);
    return null;
  }
}

let cloudOverrides: RateCardOverrides | null = null;
export const getCloudOverrides = () => cloudOverrides;

/** Reads the caller's studio row (PostgREST, RLS: own studio). */
export async function loadCloudStudio(): Promise<StudioProfile | null> {
  if (!isSignedIn()) return null;
  try {
    const sb = (await loadEngine()).client();
    const { data, error } = await sb.from('studios').select('*').limit(1).maybeSingle();
    if (error || !data) return null;
    const studio = rowToStudio(data as Record<string, unknown>);
    if (studio) useBiz.setState({ studio, studioSource: 'cloud' });
    if (studio) {
      const ov = await sb.from('rate_overrides').select('overrides').eq('studio_id', studio.id).maybeSingle();
      const value = (ov.data as { overrides?: RateCardOverrides } | null)?.overrides;
      cloudOverrides = value && typeof value === 'object' ? value : null;
    }
    return studio;
  } catch {
    return null;
  }
}

function rowToStudio(r: Record<string, unknown>): StudioProfile | null {
  // The table may keep the profile as one JSON column or spread over columns.
  const profile = (r.profile ?? r.data) as StudioProfile | undefined;
  if (profile && typeof profile === 'object') return { ...profile, id: String(r.id ?? profile.id) };
  if (typeof r.legal_name === 'string' || typeof r.legalName === 'string') {
    return r as unknown as StudioProfile;
  }
  return null;
}

/** Saves the studio: to the cloud when signed in, else to this browser. */
export async function saveStudio(studio: StudioProfile): Promise<StudioProfile> {
  if (isSignedIn()) {
    const { id, ...rest } = studio;
    const req: SaveStudioRequest = { studio: id && !id.startsWith('local-') ? { ...rest, id } : rest };
    const r = await authedCall<SaveStudioResponse>(BUSINESS_FUNCTIONS.saveStudio, req);
    useBiz.setState({ studio: r.studio, studioSource: 'cloud' });
    return r.studio;
  }
  saveLocalStudio(studio);
  useBiz.setState({ studio, studioSource: 'local' });
  return studio;
}

export async function saveRateOverrides(studioId: string, overrides: RateCardOverrides): Promise<void> {
  await authedCall(BUSINESS_FUNCTIONS.saveRateOverrides, { studioId, overrides });
  cloudOverrides = overrides;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function saveQuoteDraft(req: SaveQuoteDraftRequest): Promise<QuotationDocument> {
  return (await authedCall<SaveQuoteDraftResponse>(BUSINESS_FUNCTIONS.saveQuoteDraft, req)).quote;
}

export async function issueQuote(quoteId: string): Promise<IssueQuoteResponse> {
  return authedCall<IssueQuoteResponse>(BUSINESS_FUNCTIONS.issueQuote, { quoteId });
}

export async function createVariationOrder(req: CreateVariationOrderRequest): Promise<QuotationDocument> {
  return (await authedCall<CreateVariationOrderResponse>(BUSINESS_FUNCTIONS.createVariationOrder, req)).quote;
}

export interface QuoteRow {
  quote: QuotationDocument;
  /** The editable input the document was built from (for revising). */
  input?: SaveQuoteDraftRequest['input'];
  shareToken?: string;
  updatedAt?: string;
}

/** The project's quotes, newest first (PostgREST, RLS). */
export async function listProjectQuotes(projectId: string): Promise<QuoteRow[]> {
  if (!isSignedIn()) return [];
  const sb = (await loadEngine()).client();
  const { data, error } = await sb
    .from('quotes')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw new BizError(error.message, 'INTERNAL');
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => String(r.id));
  const tokens = new Map<string, string>();
  if (ids.length) {
    const links = await sb.from('quote_links').select('token, quote_id, revoked, created_at').in('quote_id', ids);
    for (const l of (links.data ?? []) as Array<{ token: string; quote_id: string; revoked: boolean }>) {
      if (!l.revoked || !tokens.has(l.quote_id)) tokens.set(l.quote_id, l.token);
    }
  }
  return rows
    .map((r) => rowToQuote({ ...r, share_token: tokens.get(String(r.id)) }))
    .filter((x): x is QuoteRow => x !== null);
}

function rowToQuote(r: Record<string, unknown>): QuoteRow | null {
  const doc = (r.doc ?? r.document ?? r.data) as QuotationDocument | undefined;
  if (!doc || typeof doc !== 'object') return null;
  const status = (r.status as QuotationDocument['status']) ?? doc.status;
  const number = (r.number as string | undefined) ?? doc.number;
  return {
    quote: { ...doc, id: String(r.id ?? doc.id), status, ...(number ? { number } : {}) },
    ...(r.input && typeof r.input === 'object' ? { input: r.input as SaveQuoteDraftRequest['input'] } : {}),
    shareToken: (r.share_token as string | undefined) ?? (r.token as string | undefined),
    updatedAt: r.updated_at as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Public: the client approval page
// ---------------------------------------------------------------------------

export function openQuote(token: string): Promise<OpenQuoteResponse> {
  return publicCall<OpenQuoteResponse>(BUSINESS_FUNCTIONS.openQuote, { token });
}

export function respondToQuote(req: RespondToQuoteRequest): Promise<RespondToQuoteResponse> {
  return publicCall<RespondToQuoteResponse>(BUSINESS_FUNCTIONS.respondToQuote, req);
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export function createCheckout(req: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
  return authedCall<CreateCheckoutResponse>(BUSINESS_FUNCTIONS.createCheckout, req);
}

/** Stops renewal; access continues to the end of the paid period. */
export async function cancelSubscription(reason?: string): Promise<CancelSubscriptionResponse> {
  const res = await authedCall<CancelSubscriptionResponse>(BUSINESS_FUNCTIONS.cancelSubscription, reason ? { reason } : {});
  await refreshEntitlements();
  return res;
}
