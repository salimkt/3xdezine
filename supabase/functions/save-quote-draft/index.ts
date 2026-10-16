// save-quote-draft — SaveQuoteDraftRequest -> SaveQuoteDraftResponse.
// Caller needs effective level ≥ FINISHES on the project. The whole document
// is recomputed with the shared buildQuote from the STORED plan, the studio,
// the rate card and the studio's overrides — client totals are never trusted.
//
// quoteId absent        → new DRAFT (version 1)
// quoteId = DRAFT       → updated in place
// quoteId = ISSUED / CHANGES_REQUESTED → new DRAFT revision (version + 1,
//                         supersedes_id); issuing it marks the old one SUPERSEDED
// quoteId = APPROVED    → refused: approved quotes change only by variation order
import type { SaveQuoteDraftResponse } from '../_shared/domain/business.ts';
import { diffQuotes, type QuoteDiff } from '../_shared/domain/quote.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, invalid, notFound, serve, uuid } from '../_shared/http.ts';
import { access } from '../_shared/project.ts';
import { entitlementsOf, forProject, loadQuote, loadStudio, parseDraftInput, studioForProject, type QuoteRow } from '../_shared/business.ts';
import { buildDocument, finalize, requireFeatures, requireQuoteEditor } from '../_shared/quotes.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const quoteId = body.quoteId === undefined || body.quoteId === null ? undefined : uuid(body, 'quoteId');
  const a = await access(projectId, caller);
  requireQuoteEditor(a);
  const input = parseDraftInput(body.input);

  let existing: QuoteRow | undefined;
  let supersedes: QuoteRow | undefined;
  if (quoteId) {
    const q = await loadQuote(quoteId);
    if (!q || q.project_id !== projectId) throw notFound('That quote doesn’t exist or isn’t shared with you.');
    if (q.status === 'DRAFT') existing = q;
    else if (q.status === 'ISSUED' || q.status === 'CHANGES_REQUESTED') supersedes = q;
    else if (q.status === 'APPROVED') throw forbidden('This quote is approved and locked. Changes go in a variation order.');
    else throw invalid(`This quote is ${q.status.toLowerCase()} and can’t be revised.`);
    const base = existing ?? supersedes!;
    if ((base.doc_type === 'VARIATION_ORDER') !== (input.docType === 'VARIATION_ORDER')) {
      throw invalid(base.doc_type === 'VARIATION_ORDER' ? 'A variation order stays a variation order.' : 'Use create-variation-order to amend an approved quote.');
    }
  } else if (input.docType === 'VARIATION_ORDER') {
    throw invalid('Use create-variation-order to amend an approved quote.');
  }

  // A revision keeps the studio of the quote it revises.
  const base = existing ?? supersedes;
  const studioRow = base ? await loadStudio(base.studio_id) : await studioForProject(a.project);
  if (!studioRow) throw invalid('The studio for this quote no longer exists.');
  const ent = forProject(await entitlementsOf(studioRow.owner_id), projectId);
  requireFeatures(ent, input);

  const id = existing?.id ?? crypto.randomUUID();
  const version = existing?.version ?? (supersedes ? supersedes.version + 1 : 1);
  const amendsId = existing?.amends_id ?? supersedes?.amends_id ?? null;
  const built = await buildDocument({ project: a.project, studio: studioRow, ent, input, existing: existing?.data ?? supersedes?.data });
  const doc = finalize(built, {
    id,
    projectId,
    version,
    supersedesId: existing?.supersedes_id ?? supersedes?.id ?? null,
    amendsId,
    projectVersion: a.project.version,
  });

  // A variation order keeps its summary against the approved quote current.
  let diff: QuoteDiff | null = null;
  if (doc.docType === 'VARIATION_ORDER' && amendsId) {
    const amended = await loadQuote(amendsId);
    if (amended) diff = diffQuotes(amended.data, doc);
  }

  const db = admin();
  if (existing) {
    const { data, error } = await db
      .from('quotes')
      .update({ doc_type: doc.docType, data: doc, input, diff })
      .eq('id', id)
      .eq('status', 'DRAFT')
      .select('id');
    if (error) throw error;
    if (!data?.length) throw invalid('This quote was issued in the meantime. Reload it.');
  } else {
    const { error } = await db.from('quotes').insert({
      id,
      project_id: projectId,
      studio_id: studioRow.id,
      created_by: caller.id,
      doc_type: doc.docType,
      version,
      supersedes_id: supersedes?.id ?? null,
      amends_id: amendsId,
      status: 'DRAFT',
      data: doc,
      input,
      diff,
    });
    if (error) throw error;
  }

  const res: Omit<SaveQuoteDraftResponse, 'ok'> & { diff?: QuoteDiff } = { quote: doc, ...(diff ? { diff } : {}) };
  return res;
});
