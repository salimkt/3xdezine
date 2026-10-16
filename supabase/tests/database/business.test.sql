-- RLS, privilege, immutability and numbering tests for the business schema
-- (studios, rate cards, quotes, approvals, billing). Run with `npm run sb:test`.
-- Everything happens in a transaction that is rolled back.
--
-- Concurrent numbering across real transactions is exercised end to end in
-- tests/e2e.ts (parallel issue-quote calls); here we test the compare-and-set
-- inside issue_quote_commit() that makes it safe.

begin;
create extension if not exists pgtap with schema extensions;

select plan(80);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   a1 studio owner + project owner   b2 project member (VIEW)
--   c3 stranger                       d4 studio member (seat)
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.anita@example.com',  now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer.bala@example.com', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger.chitra@example.com', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seat.dev@example.com', now(), '{}', now(), now());

insert into public.studios (id, owner_id, profile)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1',
        '{"legalName": "Anita Studio", "numberPrefix": "AS", "gstRegistration": "REGULAR"}');
insert into public.studio_members (studio_id, user_id, role) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1', 'OWNER'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000d4', 'MEMBER');
insert into public.rate_overrides (studio_id, overrides)
values ('22222222-2222-2222-2222-222222222222', '{"baseCardId": "metro-mid-2026", "overrides": {}, "added": [], "disabled": []}');

insert into public.projects (id, owner_id, name, data, studio_id)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Test house', '{"name": "Test house", "floors": []}',
        '22222222-2222-2222-2222-222222222222');
insert into public.project_members (project_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'VIEW');

-- Three drafts: q1 stays a draft, q2 and q3 get issued below.
insert into public.quotes (id, project_id, studio_id, created_by, doc_type, data, input) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1', 'QUOTATION', '{"status": "DRAFT"}', '{}'),
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1', 'QUOTATION', '{"status": "DRAFT"}', '{}'),
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1', 'QUOTATION', '{"status": "DRAFT"}', '{}');

insert into public.subscriptions (user_id, plan, interval, status, razorpay_subscription_id, current_period_end)
values ('00000000-0000-0000-0000-0000000000a1', 'SOLO', 'MONTH', 'ACTIVE', 'sub_test_1', now() + interval '30 days');
insert into public.checkout_orders (razorpay_order_id, user_id, project_id, plan, amount)
values ('order_test_1', '00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'PROJECT_PASS', 49900);
insert into public.project_passes (user_id, project_id, razorpay_order_id, razorpay_payment_id, expires_at)
values ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'order_test_1', 'pay_test_1', now() + interval '90 days');
insert into public.payments (user_id, kind, razorpay_payment_id, razorpay_order_id, amount, event_id, raw)
values ('00000000-0000-0000-0000-0000000000a1', 'PROJECT_PASS', 'pay_test_1', 'order_test_1', 49900, 'evt_test_1', '{}');
insert into public.billing_events (event_id, event_type) values ('evt_test_1', 'payment.captured');

create or replace function pg_temp.act_as(p_user uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Numbering: consecutive, compare-and-set, never reused
-- ---------------------------------------------------------------------------

select is(public.issue_quote_commit('33333333-0000-0000-0000-000000000002', 0, 'AS/Q/26-27/0001', '2026-27',
            '{"status": "ISSUED", "number": "AS/Q/26-27/0001"}', repeat('a', 64), '{"floors": []}', 'tok_q2_0123456789abcdefghij', null),
          'OK', 'issue: first number in the series');
select is(public.issue_quote_commit('33333333-0000-0000-0000-000000000003', 0, 'AS/Q/26-27/0001', '2026-27',
            '{"status": "ISSUED"}', repeat('b', 64), '{}', 'tok_q3_0123456789abcdefghij', null),
          'SEQ:1', 'issue: a stale sequence (someone else took 0001) is refused with the current value');
select is((select status from public.quotes where id = '33333333-0000-0000-0000-000000000003'), 'DRAFT',
          'the refused issue changed nothing');
select is(public.issue_quote_commit('33333333-0000-0000-0000-000000000003', 1, 'AS/Q/26-27/0002', '2026-27',
            '{"status": "ISSUED", "number": "AS/Q/26-27/0002"}', repeat('b', 64), '{}', 'tok_q3_0123456789abcdefghij', null),
          'OK', 'issue: the retry with the current sequence gets the next number');
select is((select last_seq from public.quote_number_series
           where studio_id = '22222222-2222-2222-2222-222222222222' and doc_type = 'QUOTATION' and financial_year = '2026-27'),
          2, 'series advanced by exactly one per issue');
select is(public.issue_quote_commit('33333333-0000-0000-0000-000000000002', 2, 'AS/Q/26-27/0003', '2026-27', '{}', repeat('c', 64), '{}', 'tok_again_0123456789abcdef', null),
          'NOT_DRAFT', 'an issued quote cannot be issued again');
select is(public.issue_quote_commit('33333333-0000-0000-0000-000000000099', 0, 'x', '2026-27', '{}', repeat('c', 64), '{}', 'tok_none_0123456789abcdefg', null),
          'NOT_FOUND', 'unknown quote');
select throws_ok($$ insert into public.quotes (project_id, studio_id, doc_type, number, status, data, input, hash, issued_at)
                    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'QUOTATION', 'AS/Q/26-27/0001', 'ISSUED', '{}', '{}', repeat('d', 64), now()) $$,
  '23505', null, 'a number is never reused within studio + doc type');
select is((select count(*)::int from public.quote_number_series where studio_id = '22222222-2222-2222-2222-222222222222'), 1,
  'one series per studio, doc type and FY');

-- ---------------------------------------------------------------------------
-- Issued quotes are immutable (even for postgres / service role)
-- ---------------------------------------------------------------------------

select throws_ok($$ update public.quotes set data = data || '{"grandTotal": 1}' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'issued document content cannot change');
select throws_ok($$ update public.quotes set number = 'AS/Q/26-27/9999' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'issued number cannot change');
select throws_ok($$ update public.quotes set hash = repeat('e', 64) where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'issued hash cannot change');
select throws_ok($$ update public.quotes set status = 'DRAFT' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'issued quote cannot go back to DRAFT');
select throws_ok($$ update public.quotes set input = '{"x": 1}' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'issued draft input cannot change');
select lives_ok($$ update public.quotes set data = data || '{"grandTotal": 5}' where id = '33333333-0000-0000-0000-000000000001' $$,
  'drafts stay editable');

-- ---------------------------------------------------------------------------
-- Client responses: hash-pinned, then locked; evidence is append-only
-- ---------------------------------------------------------------------------

select is(public.record_quote_response('tok_q2_0123456789abcdefghij', 'APPROVED', 'Ravi', 'ravi@example.com', '', repeat('f', 64), 'UA', '10.0.0.1') ->> 'result',
          'STALE', 'a response pinned to a different hash is refused');
select is((select count(*)::int from public.quote_responses where quote_id = '33333333-0000-0000-0000-000000000002'), 0,
  'a refused response leaves no record');
select is(public.record_quote_response('tok_unknown_0123456789abcdef', 'APPROVED', 'Ravi', 'ravi@example.com', '', repeat('a', 64), null, null) ->> 'result',
          'NOT_FOUND', 'unknown token');
select is(public.record_quote_response('tok_q2_0123456789abcdefghij', 'APPROVED', 'Ravi', 'ravi@example.com', '', repeat('a', 64), 'UA', '10.0.0.1') ->> 'result',
          'OK', 'a response pinned to the stored hash is recorded');
select is((select status from public.quotes where id = '33333333-0000-0000-0000-000000000002'), 'APPROVED', 'approval moves the status');
select isnt((select locked_at from public.quotes where id = '33333333-0000-0000-0000-000000000002'), null, 'approval sets locked_at');
select is((select data -> 'approvals' -> 0 ->> 'documentHash' from public.quotes where id = '33333333-0000-0000-0000-000000000002'), repeat('a', 64),
          'the approval is recorded in the document with the hash');
select is(public.record_quote_response('tok_q2_0123456789abcdefghij', 'CHANGES_REQUESTED', 'Ravi', 'ravi@example.com', 'x', repeat('a', 64), null, null) ->> 'result',
          'NOT_ISSUED', 'an approved quote takes no further responses');
select throws_ok($$ update public.quotes set status = 'CANCELLED' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'an approved quote is locked (no status change)');
select throws_ok($$ update public.quotes set locked_at = now() + interval '1 day' where id = '33333333-0000-0000-0000-000000000002' $$,
  'P0001', null, 'locked_at cannot move');

select throws_ok($$ update public.quote_responses set decision = 'CHANGES_REQUESTED' $$, 'P0001', null, 'responses: UPDATE refused even for postgres');
select throws_ok($$ delete from public.quote_responses $$, 'P0001', null, 'responses: DELETE refused even for postgres');
select throws_ok($$ truncate public.quote_responses $$, 'P0001', null, 'responses: TRUNCATE refused');
select throws_ok($$ update public.payments set amount = 1 $$, 'P0001', null, 'payments: UPDATE refused even for postgres');
select throws_ok($$ delete from public.payments $$, 'P0001', null, 'payments: DELETE refused even for postgres');

set local role service_role;
select throws_ok($$ update public.quote_responses set comment = 'edited' $$, '42501', null, 'service role has no UPDATE on responses');
select throws_ok($$ delete from public.quote_responses $$, '42501', null, 'service role has no DELETE on responses');
select throws_ok($$ delete from public.payments $$, '42501', null, 'service role has no DELETE on payments');
reset role;

-- ---------------------------------------------------------------------------
-- Schema-level guarantees
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.studios'::regclass, 'public.studio_members'::regclass, 'public.rate_overrides'::regclass,
                 'public.quotes'::regclass, 'public.quote_number_series'::regclass, 'public.quote_links'::regclass,
                 'public.quote_responses'::regclass, 'public.subscriptions'::regclass, 'public.checkout_orders'::regclass,
                 'public.project_passes'::regclass, 'public.payments'::regclass, 'public.billing_events'::regclass)),
  'RLS is enabled on every business table');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
     and tablename in ('studios', 'studio_members', 'rate_overrides', 'quotes', 'quote_number_series', 'quote_links',
                       'quote_responses', 'subscriptions', 'checkout_orders', 'project_passes', 'payments', 'billing_events')),
  0, 'no INSERT/UPDATE/DELETE policy on any business table');

select throws_ok($$ insert into public.studios (owner_id, profile) values ('00000000-0000-0000-0000-0000000000c3',
                    jsonb_build_object('logoDataUrl', 'data:image/png;base64,' || repeat('A', 90000))) $$,
  '23514', null, 'a logo over 64 KB is refused by the table');

-- ---------------------------------------------------------------------------
-- Stranger (C)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', 'stranger.chitra@example.com');
select is((select count(*)::int from public.studios), 0, 'stranger: no studios');
select is((select count(*)::int from public.studio_members), 0, 'stranger: no studio seats');
select is((select count(*)::int from public.rate_overrides), 0, 'stranger: no rate cards');
select is((select count(*)::int from public.quotes), 0, 'stranger: no quotes');
select is((select count(*)::int from public.quote_number_series), 0, 'stranger: no number series');
select is((select count(*)::int from public.quote_links), 0, 'stranger: no quote tokens');
select is((select count(*)::int from public.quote_responses), 0, 'stranger: no responses');
select is((select count(*)::int from public.subscriptions), 0, 'stranger: no subscriptions');
select is((select count(*)::int from public.project_passes), 0, 'stranger: no passes');
select is((select count(*)::int from public.payments), 0, 'stranger: no payments');
select is((select count(*)::int from public.checkout_orders), 0, 'stranger: no checkouts');
select throws_ok($$ select * from public.billing_events $$, '42501', null, 'billing_events is not readable by clients');
select is(public.is_studio_member('22222222-2222-2222-2222-222222222222'), false, 'is_studio_member() answers only about the caller');
reset role;

-- ---------------------------------------------------------------------------
-- Project member (B, VIEW) — not in the studio
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2', 'viewer.bala@example.com');
select is((select count(*)::int from public.quotes), 3, 'project member reads the project''s quotes');
select is((select count(*)::int from public.quote_responses), 1, 'project member reads the client responses');
select is((select count(*)::int from public.studios), 0, 'project member does not read the studio');
select is((select count(*)::int from public.rate_overrides), 0, 'project member does not read the rate card');
select is((select count(*)::int from public.quote_links), 0, 'project member does not read quote tokens');
select is((select count(*)::int from public.subscriptions), 0, 'project member does not read the owner''s subscription');

-- Client writes: every path refused.
select throws_ok($$ update public.quotes set status = 'APPROVED' $$, '42501', null, 'member cannot update quotes');
select throws_ok($$ insert into public.quotes (project_id, studio_id, doc_type, data, input) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'QUOTATION', '{}', '{}') $$,
  '42501', null, 'member cannot insert quotes');
select throws_ok($$ insert into public.quote_responses (quote_id, decision, by_name, by_contact, document_hash) values ('33333333-0000-0000-0000-000000000003', 'APPROVED', 'x', 'xyz', repeat('b', 64)) $$,
  '42501', null, 'member cannot forge a client response');
select throws_ok($$ insert into public.subscriptions (user_id, plan, interval, status, razorpay_subscription_id) values ('00000000-0000-0000-0000-0000000000b2', 'STUDIO', 'YEAR', 'ACTIVE', 'sub_forged') $$,
  '42501', null, 'cannot grant yourself a subscription');
select throws_ok($$ insert into public.project_passes (user_id, project_id, razorpay_payment_id, expires_at) values ('00000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'pay_forged', now() + interval '1 year') $$,
  '42501', null, 'cannot grant yourself a project pass');
select throws_ok($$ insert into public.payments (kind, razorpay_payment_id, amount, event_id, raw) values ('SUBSCRIPTION', 'pay_forged', 1, 'e', '{}') $$,
  '42501', null, 'cannot write the payments ledger');
select throws_ok($$ insert into public.studios (owner_id, profile) values ('00000000-0000-0000-0000-0000000000b2', '{}') $$,
  '42501', null, 'cannot create a studio directly');
select throws_ok($$ insert into public.studio_members (studio_id, user_id) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000b2') $$,
  '42501', null, 'cannot take a studio seat');
select throws_ok($$ select public.issue_quote_commit('33333333-0000-0000-0000-000000000001', 2, 'x', '2026-27', '{}', repeat('a', 64), '{}', 'tok_member_0123456789abcd', null) $$,
  '42501', null, 'issue_quote_commit() is service-role only');
select throws_ok($$ select public.record_quote_response('tok_q3_0123456789abcdefghij', 'APPROVED', 'x', 'xyz', '', repeat('b', 64), null, null) $$,
  '42501', null, 'record_quote_response() is service-role only');
reset role;

-- ---------------------------------------------------------------------------
-- Studio seat (D) — not a project member
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4', 'seat.dev@example.com');
select is((select count(*)::int from public.studios), 1, 'studio member reads the studio');
select is((select count(*)::int from public.studio_members), 2, 'studio member reads the seats');
select is((select count(*)::int from public.rate_overrides), 1, 'studio member reads the shared rate card');
select is((select count(*)::int from public.quotes), 3, 'studio member reads the studio''s quotes');
select is((select count(*)::int from public.quote_number_series), 1, 'studio member reads the number series');
select is((select count(*)::int from public.subscriptions), 0, 'studio member does not read the owner''s billing');
select throws_ok($$ update public.rate_overrides set overrides = '{}' $$, '42501', null, 'studio member cannot write the rate card directly');
select throws_ok($$ update public.studios set profile = '{}' $$, '42501', null, 'studio member cannot write the studio directly');
reset role;

-- ---------------------------------------------------------------------------
-- Owner (A)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'owner.anita@example.com');
select is((select count(*)::int from public.subscriptions), 1, 'owner reads their subscription');
select is((select count(*)::int from public.project_passes), 1, 'owner reads their passes');
select is((select count(*)::int from public.payments), 1, 'owner reads their payments');
select is((select count(*)::int from public.quote_links), 2, 'owner reads the quote tokens');
select throws_ok($$ update public.subscriptions set current_period_end = now() + interval '10 years' $$, '42501', null, 'owner cannot extend their own subscription');
reset role;

set local role anon;
select throws_ok($$ select * from public.quotes $$, '42501', null, 'anon cannot read quotes');
select throws_ok($$ select * from public.quote_links $$, '42501', null, 'anon cannot enumerate quote tokens');
reset role;

select * from finish();
rollback;
