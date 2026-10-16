-- Issued tax documents must outlive the project they belong to.
--
-- CGST Act s.36 with Rule 56 requires books and records — tax invoices, bills
-- of supply and other invoices — to be kept for 72 months from the due date of
-- the annual return for the year they relate to. `quotes.project_id` cascades on
-- delete, so without this guard deleting a project would silently destroy them.
--
-- Enforced in the database rather than only in the delete-project function, so
-- it also binds the service role and anything written later. Drafts and plain
-- quotations are not tax documents and stay deletable.

create or replace function public.guard_project_tax_documents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.quotes q
    where q.project_id = old.id
      and q.doc_type in ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE')
      and q.status <> 'DRAFT'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TAX_DOCUMENTS_RETAINED',
      detail  = 'Project has issued tax documents that must be retained (CGST Act s.36, Rule 56).';
  end if;
  return old;
end;
$$;

drop trigger if exists projects_guard_tax_documents on public.projects;
create trigger projects_guard_tax_documents
  before delete on public.projects
  for each row execute function public.guard_project_tax_documents();

comment on function public.guard_project_tax_documents() is
  'Blocks deleting a project that has issued tax invoices, bills of supply or plain invoices (72-month GST record retention).';

-- The same rule directly on quotes: without it, an issued invoice could be
-- deleted row-by-row (the existing quotes_guard only covers UPDATE).
create or replace function public.guard_tax_document_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.doc_type in ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE') and old.status <> 'DRAFT' then
    raise exception using
      errcode = 'P0001',
      message = 'TAX_DOCUMENTS_RETAINED',
      detail  = 'Issued tax documents must be retained (CGST Act s.36, Rule 56).';
  end if;
  return old;
end;
$$;

drop trigger if exists quotes_guard_tax_delete on public.quotes;
create trigger quotes_guard_tax_delete
  before delete on public.quotes
  for each row execute function public.guard_tax_document_delete();
