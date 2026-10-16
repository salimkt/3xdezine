// issue-quote — IssueQuoteRequest -> IssueQuoteResponse.
//
// Refuses doc types outside the plan's `docTypes` ∩ allowedDocTypes(the
// studio's GST registration); watermark = !brandedQuotes, honouring a
// Project Pass for this project. Rebuilds the document one last time (dated
// today, IST; supplier snapshotted), assigns the next consecutive number for
// (studio, doc type, financial year), hashes it, and commits number + document
// + share link in ONE transaction (public.issue_quote_commit), retrying if a
// concurrent issue took the number first. Issued quotes are immutable.
import type { IssueQuoteResponse, QuotationDocument } from '../_shared/domain/business.ts';
import { financialYear } from '../_shared/domain/gst.ts';
import { hashQuote, nextQuoteNumber } from '../_shared/domain/quote.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { Fail, invalid, notFound, serve, uuid } from '../_shared/http.ts';
import { access } from '../_shared/project.ts';
import {
  entitlementsOf, forProject, loadQuote, loadStudio, publicProject, randomToken, todayIst, toStudio,
} from '../_shared/business.ts';
import { buildDocument, requireFeatures, requireIssuable, requireQuoteEditor } from '../_shared/quotes.ts';

const MAX_ATTEMPTS = 10;

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const quoteId = uuid(body, 'quoteId');
  const q = await loadQuote(quoteId);
  if (!q) throw notFound('That quote doesn’t exist or isn’t shared with you.');
  const a = await access(q.project_id, caller);
  requireQuoteEditor(a);
  if (q.status !== 'DRAFT') throw invalid('This quote has already been issued. Save a revision to change it.');

  const studio = await loadStudio(q.studio_id);
  if (!studio) throw invalid('The studio for this quote no longer exists.');
  const ent = forProject(await entitlementsOf(studio.owner_id), q.project_id);
  requireIssuable(ent, studio, q.doc_type);
  requireFeatures(ent, q.input);

  const db = admin();
  if (q.supersedes_id) {
    const prev = await loadQuote(q.supersedes_id);
    if (!prev || (prev.status !== 'ISSUED' && prev.status !== 'CHANGES_REQUESTED')) {
      throw invalid('The quote this revises has moved on (approved, superseded or cancelled). Start a new revision from the latest version.');
    }
  }

  const issueDate = todayIst();
  const fy = financialYear(issueDate);
  const input = { ...q.input, issueDate };
  const built = await buildDocument({ project: a.project, studio, ent, input, existing: q.data });
  const prefix = toStudio(studio).numberPrefix;
  const token = randomToken(32);
  const projectData = publicProject(a.project.data);

  let lastSeq = await currentSeq(q.studio_id, q.doc_type, fy);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const number = nextQuoteNumber(prefix, q.doc_type, fy, lastSeq);
    const doc: QuotationDocument = {
      ...built,
      id: q.id,
      projectId: q.project_id,
      version: q.version,
      status: 'ISSUED',
      number,
      issueDate,
      financialYear: fy,
      approvals: [],
      projectVersion: a.project.version,
      ...(q.supersedes_id ? { supersedesId: q.supersedes_id } : {}),
      ...(q.amends_id ? { amendsId: q.amends_id } : {}),
    };
    delete doc.hash;
    delete doc.lockedAt;
    const hash = await hashQuote(doc);
    doc.hash = hash;

    const { data, error } = await db.rpc('issue_quote_commit', {
      p_quote_id: q.id,
      p_expected_seq: lastSeq,
      p_number: number,
      p_fy: fy,
      p_data: doc,
      p_hash: hash,
      p_project_data: projectData,
      p_token: token,
      p_created_by: caller.id,
    });
    if (error) {
      if (error.code === 'P0001') throw invalid('The quote this revises has moved on. Start a new revision from the latest version.');
      throw error;
    }
    const result = String(data);
    if (result === 'OK') {
      const res: Omit<IssueQuoteResponse, 'ok'> = { quote: doc, shareToken: token, shareUrlPath: `#/q/${token}` };
      return res;
    }
    if (result === 'NOT_FOUND') throw notFound('That quote doesn’t exist or isn’t shared with you.');
    if (result === 'NOT_DRAFT') throw invalid('This quote has already been issued. Save a revision to change it.');
    if (result.startsWith('SEQ:')) {
      lastSeq = Number(result.slice(4));
      continue;
    }
    throw new Error(`issue_quote_commit returned ${result}`);
  }
  throw new Fail('CONFLICT', 'Several documents were being numbered at once. Please try again.');
});

async function currentSeq(studioId: string, docType: string, fy: string): Promise<number> {
  const { data, error } = await admin()
    .from('quote_number_series')
    .select('last_seq')
    .eq('studio_id', studioId)
    .eq('doc_type', docType)
    .eq('financial_year', fy)
    .maybeSingle();
  if (error) throw error;
  return (data?.last_seq as number | undefined) ?? 0;
}
