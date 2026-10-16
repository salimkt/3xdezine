-- Quote numbering under two REAL concurrent transactions (via dblink).
--
-- Unlike the other test files, the fixtures here must be committed so a
-- second session can see them; they use their own ids and are deleted at the
-- start and end — with the tax-retention
-- guards switched off for that one statement, since these fixtures hold issued
-- tax invoices. Only the tables' owner can do that. Connects back to this database as `postgres` over TCP with
-- the local default password.

begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(7);

select set_config('t.conn',
  format('dbname=%s user=postgres password=postgres host=%s port=%s',
         current_database(), coalesce(host(inet_server_addr()), '127.0.0.1'), inet_server_port()),
  true);

select extensions.dblink_connect('setup', current_setting('t.conn'));
select extensions.dblink_exec('setup', $$ alter table public.projects disable trigger projects_guard_tax_documents;
     alter table public.quotes disable trigger quotes_guard_tax_delete;
     delete from auth.users where id = '00000000-0000-0000-0000-0000000000e5';
     alter table public.quotes enable trigger quotes_guard_tax_delete;
     alter table public.projects enable trigger projects_guard_tax_documents; $$);
select extensions.dblink_exec('setup', $$
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'concurrency.test@example.com', now(), '{}', now(), now());
  insert into public.studios (id, owner_id, profile)
  values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-0000000000e5', '{"numberPrefix": "CC"}');
  insert into public.projects (id, owner_id, name, data, studio_id)
  values ('55555555-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e5', 'Concurrency', '{"floors": []}',
          '55555555-5555-5555-5555-555555555555');
  insert into public.quotes (id, project_id, studio_id, doc_type, data, input) values
    ('55555555-0000-0000-0000-00000000000a', '55555555-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'TAX_INVOICE', '{}', '{}'),
    ('55555555-0000-0000-0000-00000000000b', '55555555-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'TAX_INVOICE', '{}', '{}');
$$);

select extensions.dblink_connect('ta', current_setting('t.conn'));
select extensions.dblink_connect('tb', current_setting('t.conn'));

-- A takes number 1 and holds its transaction open.
select extensions.dblink_exec('ta', 'begin');
select is(
  (select r from extensions.dblink('ta', $$ select public.issue_quote_commit('55555555-0000-0000-0000-00000000000a', 0, 'CC/I/26-27/0001', '2026-27',
      '{"number": "CC/I/26-27/0001"}', repeat('a', 64), '{}', 'tok_conc_a_0123456789abcdef', null) $$) as t(r text)),
  'OK', 'transaction A allocates 0001 (uncommitted)');

-- B, in parallel, also believes the series is at 0.
select extensions.dblink_exec('tb', 'begin');
select extensions.dblink_send_query('tb', $$ select public.issue_quote_commit('55555555-0000-0000-0000-00000000000b', 0, 'CC/I/26-27/0001', '2026-27',
    '{"number": "CC/I/26-27/0001"}', repeat('b', 64), '{}', 'tok_conc_b_0123456789abcdef', null) $$);
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('tb'), 1, 'transaction B blocks on A''s lock on the series');

select extensions.dblink_exec('ta', 'commit');
select is((select r from extensions.dblink_get_result('tb') as t(r text)), 'SEQ:1',
  'once A commits, B is told 0001 is taken (no duplicate)');
select count(*) from extensions.dblink_get_result('tb') as t(r text);  -- drain

select is(
  (select r from extensions.dblink('tb', $$ select public.issue_quote_commit('55555555-0000-0000-0000-00000000000b', 1, 'CC/I/26-27/0002', '2026-27',
      '{"number": "CC/I/26-27/0002"}', repeat('b', 64), '{}', 'tok_conc_b_0123456789abcdef', null) $$) as t(r text)),
  'OK', 'B retries with the current value and gets 0002');
select extensions.dblink_exec('tb', 'commit');

select is(
  (select array_agg(n order by n) from extensions.dblink('setup',
     $$ select number from public.quotes where studio_id = '55555555-5555-5555-5555-555555555555' $$) as t(n text)),
  array['CC/I/26-27/0001', 'CC/I/26-27/0002'], 'numbers are consecutive with no gap and no duplicate');
select is(
  (select s from extensions.dblink('setup',
     $$ select last_seq from public.quote_number_series where studio_id = '55555555-5555-5555-5555-555555555555' $$) as t(s int)),
  2, 'the series records exactly two issues');
select is(
  (select c from extensions.dblink('setup',
     $$ select count(*)::int from public.quote_links where quote_id in ('55555555-0000-0000-0000-00000000000a', '55555555-0000-0000-0000-00000000000b') $$) as t(c int)),
  2, 'each issue committed its own share link');

select extensions.dblink_exec('setup', $$ alter table public.projects disable trigger projects_guard_tax_documents;
     alter table public.quotes disable trigger quotes_guard_tax_delete;
     delete from auth.users where id = '00000000-0000-0000-0000-0000000000e5';
     alter table public.quotes enable trigger quotes_guard_tax_delete;
     alter table public.projects enable trigger projects_guard_tax_documents; $$);
select extensions.dblink_disconnect('ta');
select extensions.dblink_disconnect('tb');
select extensions.dblink_disconnect('setup');

select * from finish();
rollback;
