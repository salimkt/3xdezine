-- Issued tax documents survive project deletion, direct deletion and account
-- deletion (CGST Act s.36 / Rule 56: 72-month retention). Drafts and plain
-- quotations do not need protecting and must stay deletable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'retention.test@example.com', now(), '{}', now(), now());
insert into public.studios (id, owner_id, profile)
values ('f1f1f1f1-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', '{"numberPrefix": "RT"}');
insert into public.projects (id, owner_id, name, data, studio_id) values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Has invoice',   '{"floors": []}', 'f1f1f1f1-0000-0000-0000-000000000000'),
  ('f1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'Quotes only',   '{"floors": []}', 'f1f1f1f1-0000-0000-0000-000000000000'),
  ('f1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f1', 'Draft invoice', '{"floors": []}', 'f1f1f1f1-0000-0000-0000-000000000000');
insert into public.quotes (id, project_id, studio_id, doc_type, status, number, hash, issued_at, data, input) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000001', 'f1f1f1f1-0000-0000-0000-000000000000', 'TAX_INVOICE', 'ISSUED', 'RT/TI/26-27/0001', repeat('a', 64), now(), '{}', '{}'),
  ('f1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000000', 'QUOTATION',   'ISSUED', 'RT/Q/26-27/0001',  repeat('b', 64), now(), '{}', '{}'),
  ('f1000000-0000-0000-0000-0000000000a3', 'f1000000-0000-0000-0000-000000000003', 'f1f1f1f1-0000-0000-0000-000000000000', 'TAX_INVOICE', 'DRAFT',  null, null, null, '{}', '{}');

select throws_ok($$ delete from public.projects where id = 'f1000000-0000-0000-0000-000000000001' $$,
  'P0001', 'TAX_DOCUMENTS_RETAINED', 'a project with an issued tax invoice cannot be deleted');
select throws_ok($$ delete from public.quotes where id = 'f1000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'TAX_DOCUMENTS_RETAINED', 'an issued tax invoice cannot be deleted directly');
select throws_ok($$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'P0001', 'TAX_DOCUMENTS_RETAINED', 'deleting the account cannot cascade away issued tax invoices');
select lives_ok($$ delete from public.projects where id = 'f1000000-0000-0000-0000-000000000002' $$,
  'a project with only quotations can be deleted');
select lives_ok($$ delete from public.projects where id = 'f1000000-0000-0000-0000-000000000003' $$,
  'a project whose tax invoice is still a draft can be deleted');
select is((select count(*)::int from public.quotes where id = 'f1000000-0000-0000-0000-0000000000a1'), 1,
  'the issued invoice is still there');

select * from finish();
rollback;
