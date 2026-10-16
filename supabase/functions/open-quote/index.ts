// open-quote — OpenQuoteRequest -> OpenQuoteResponse. PUBLIC (works signed out).
// Token → that one quote, the plan as it was when the quote was issued (for
// the plan/3D view, without proposals or policy) and the studio's display
// name. Unknown and revoked tokens are NOT_FOUND. Nothing about other quotes,
// members or the live project is returned.
import type { OpenQuoteResponse } from '../_shared/domain/business.ts';
import { admin } from '../_shared/auth.ts';
import { notFound, serve, str } from '../_shared/http.ts';
import { loadQuote, publicProject } from '../_shared/business.ts';

const GONE = 'This quotation link has expired or been turned off. Ask your designer for a new one.';

serve(async (_req, body) => {
  const token = str(body, 'token', { max: 200 })!;
  const { data: link, error } = await admin().from('quote_links').select('quote_id, revoked').eq('token', token).maybeSingle();
  if (error) throw error;
  if (!link || link.revoked) throw notFound(GONE);
  const q = await loadQuote(link.quote_id);
  if (!q || q.status === 'DRAFT' || !q.project_data) throw notFound(GONE);
  const supplier = q.data.supplier;
  const res: Omit<OpenQuoteResponse, 'ok'> & { diff?: unknown } = {
    quote: q.data,
    project: publicProject(q.project_data),
    studioName: supplier?.tradeName || supplier?.legalName || 'Your designer',
    // Variation orders: what changed against the approved quote.
    ...(q.diff ? { diff: q.diff } : {}),
  };
  return res;
});
