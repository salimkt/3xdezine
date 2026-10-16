// create-variation-order — CreateVariationOrderRequest -> CreateVariationOrderResponse
// (+ `diff`). Only against an APPROVED quote, by someone who can quote on the
// project, on a plan with `variationOrders`. Builds a VARIATION_ORDER draft
// (amends_id = the approved quote) from the input with the shared engine and
// summarises what changed with diffQuotes(approved, variation). Issue it with
// issue-quote (its own VO number series). The approved quote stays locked.
import type { CreateVariationOrderResponse } from '../_shared/domain/business.ts';
import { diffQuotes } from '../_shared/domain/quote.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { invalid, notFound, serve, uuid } from '../_shared/http.ts';
import { access } from '../_shared/project.ts';
import { entitlementsOf, forProject, isObj, loadQuote, loadStudio, parseDraftInput } from '../_shared/business.ts';
import { buildDocument, finalize, requireFeatures, requireQuoteEditor } from '../_shared/quotes.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const approvedId = uuid(body, 'approvedQuoteId');
  const approved = await loadQuote(approvedId);
  if (!approved) throw notFound('That quote doesn’t exist or isn’t shared with you.');
  const a = await access(approved.project_id, caller);
  requireQuoteEditor(a);
  if (approved.status !== 'APPROVED') throw invalid('A variation order can only amend a quote the client has approved.');

  const input = parseDraftInput(isObj(body.input) ? { ...body.input, docType: 'VARIATION_ORDER' } : body.input);
  const studio = await loadStudio(approved.studio_id);
  if (!studio) throw invalid('The studio for this quote no longer exists.');
  const ent = forProject(await entitlementsOf(studio.owner_id), approved.project_id);
  requireFeatures(ent, input);

  const id = crypto.randomUUID();
  // `existing` = the approved quote, so unchanged lines keep their line numbers.
  const built = await buildDocument({ project: a.project, studio, ent, input, existing: approved.data });
  const doc = finalize(built, { id, projectId: approved.project_id, version: 1, amendsId: approved.id, projectVersion: a.project.version });
  const diff = diffQuotes(approved.data, doc);

  const { error } = await admin().from('quotes').insert({
    id,
    project_id: approved.project_id,
    studio_id: studio.id,
    created_by: caller.id,
    doc_type: 'VARIATION_ORDER',
    version: 1,
    amends_id: approved.id,
    status: 'DRAFT',
    data: doc,
    input,
    diff,
  });
  if (error) throw error;
  const res: Omit<CreateVariationOrderResponse, 'ok'> & { diff: typeof diff } = { quote: doc, diff };
  return res;
});
