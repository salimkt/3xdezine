// respond-to-quote — RespondToQuoteRequest -> RespondToQuoteResponse. PUBLIC.
//
// Pinned to the document: refused when `documentHash` ≠ the stored hash (the
// client saw a different version) or the quote is no longer ISSUED. The
// decision is appended to quote_responses (append-only evidence: name,
// contact, comment, hash, user agent, IP) and, in the same transaction,
// APPROVED → status APPROVED + locked_at; CHANGES_REQUESTED → that status.
// Limits: field lengths, one decision per link per minute.
import type { RespondToQuoteResponse } from '../_shared/domain/business.ts';
import { admin } from '../_shared/auth.ts';
import { Fail, invalid, notFound, oneOf, serve, str } from '../_shared/http.ts';

serve(async (req, body) => {
  const token = str(body, 'token', { max: 200 })!;
  const decision = oneOf(body, 'decision', ['APPROVED', 'CHANGES_REQUESTED'] as const);
  const byName = str(body, 'byName', { max: 120 })!;
  const byContact = str(body, 'byContact', { max: 120 })!;
  if (byContact.length < 3) throw invalid('Please enter a phone number or email address.');
  const comment = str(body, 'comment', { max: 2000, optional: true }) ?? '';
  if (decision === 'CHANGES_REQUESTED' && !comment) throw invalid('Please say what you’d like changed.');
  const documentHash = str(body, 'documentHash', { max: 64 })!.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(documentHash)) throw invalid('`documentHash` must be a SHA-256 hex digest.');

  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500) || null;
  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '').split(',')[0].trim().slice(0, 64) || null;

  const { data, error } = await admin().rpc('record_quote_response', {
    p_token: token,
    p_decision: decision,
    p_by_name: byName,
    p_by_contact: byContact,
    p_comment: comment,
    p_hash: documentHash,
    p_user_agent: userAgent,
    p_ip: ip,
  });
  if (error) throw error;
  const r = data as { result: string; status?: string; data?: RespondToQuoteResponse['quote'] };
  switch (r.result) {
    case 'OK': {
      const res: Omit<RespondToQuoteResponse, 'ok'> = { quote: r.data! };
      return res;
    }
    case 'NOT_FOUND':
      throw notFound('This quotation link has expired or been turned off. Ask your designer for a new one.');
    case 'NOT_ISSUED':
      throw new Fail('CONFLICT', r.status === 'APPROVED'
        ? 'This quotation has already been approved.'
        : r.status === 'SUPERSEDED'
          ? 'Your designer has sent a newer version of this quotation. Please open the latest link.'
          : 'This quotation is no longer open for a response.');
    case 'STALE':
      throw new Fail('CONFLICT', 'This quotation changed after you opened it. Reload the page to see the current version before responding.');
    case 'RATE_LIMITED':
      throw invalid('A response was just recorded for this link. Please wait a minute before sending another.');
    default:
      throw new Error(`record_quote_response returned ${r.result}`);
  }
});
