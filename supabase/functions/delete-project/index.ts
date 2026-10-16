// delete-project — DeleteProjectRequest -> DeleteProjectResponse. Owner only.
// Members, invites, share links and versions go with it (ON DELETE CASCADE).
import { admin, requireCaller } from '../_shared/auth.ts';
import { forbidden, serve, uuid } from '../_shared/http.ts';
import { access, requireOwner } from '../_shared/project.ts';

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const a = await access(projectId, caller);
  requireOwner(a, 'delete it');

  // Issued tax documents must be kept for 72 months (CGST Act s.36, Rule 56).
  // The database refuses the delete regardless (guard_project_tax_documents);
  // checking first turns that into a message a person can act on.
  const { count, error: countError } = await admin()
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('doc_type', ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE'])
    .neq('status', 'DRAFT');
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw forbidden(
      `This project has ${count} issued invoice${count === 1 ? '' : 's'}. GST law requires keeping tax records for 72 months, so it can't be deleted. You can still rename it.`,
    );
  }

  const { error } = await admin().from('projects').delete().eq('id', projectId);
  if (error) {
    if (String(error.message).includes('TAX_DOCUMENTS_RETAINED')) {
      throw forbidden("This project has issued invoices that GST law requires keeping for 72 months, so it can't be deleted.");
    }
    throw error;
  }
  return {};
});
