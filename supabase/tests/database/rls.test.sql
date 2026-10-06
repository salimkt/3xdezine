-- Row-level security and privilege tests for the 3xDezine cloud schema.
-- Run with `npm run sb:test` (npx supabase test db). Everything happens in a
-- transaction that is rolled back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.anita@example.com',  now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer.bala@example.com', now(), '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger.chitra@example.com', now(), '{"display_name": "Chitra"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invitee.dev@example.com', now(), '{}', now(), now());

insert into public.projects (id, owner_id, name, data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Test house', '{"name": "Test house", "floors": []}');

insert into public.project_members (project_id, user_id, role, added_by)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'VIEW', '00000000-0000-0000-0000-0000000000a1');

insert into public.project_invites (project_id, email, role, invited_by)
values ('11111111-1111-1111-1111-111111111111', 'invitee.dev@example.com', 'FINISHES', '00000000-0000-0000-0000-0000000000a1');

insert into public.share_links (token, project_id, role, created_by)
values ('tok_0123456789abcdef0123456789abcdef0123456789', '11111111-1111-1111-1111-111111111111', 'VIEW', '00000000-0000-0000-0000-0000000000a1');

insert into public.project_versions (project_id, version, author_id, reason, data)
values ('11111111-1111-1111-1111-111111111111', 1, '00000000-0000-0000-0000-0000000000a1', 'CREATE', '{}');

-- Switch identity: sets the role and the JWT claims auth.uid()/auth.jwt() read.
create or replace function pg_temp.act_as(p_user uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Schema-level guarantees
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.profiles'::regclass, 'public.projects'::regclass, 'public.project_members'::regclass,
                 'public.project_invites'::regclass, 'public.share_links'::regclass, 'public.project_versions'::regclass)),
  'RLS is enabled on every table');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'projects' and cmd <> 'SELECT'),
  0, 'projects has no INSERT/UPDATE/DELETE policy');

select ok(
  (select bool_and(coalesce((reloptions::text[] @> array['security_invoker=true']), false)) from pg_class
   where oid in ('public.my_projects'::regclass, 'public.project_member_profiles'::regclass, 'public.my_invites'::regclass)),
  'views run with security_invoker');

select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'Owner Anita',
  'profile auto-created, display name from the email local-part');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'), 'Chitra',
  'display_name metadata wins over the email');
select matches((select avatar_color from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), '^#[0-9A-F]{6}$',
  'avatar colour assigned from the palette');

-- ---------------------------------------------------------------------------
-- Stranger (C)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', 'stranger.chitra@example.com');

select is((select count(*)::int from public.projects), 0, 'stranger cannot read the project');
select is((select count(*)::int from public.my_projects), 0, 'stranger: my_projects is empty');
select is((select count(*)::int from public.project_members), 0, 'stranger cannot read memberships');
select is((select count(*)::int from public.project_member_profiles), 0, 'stranger cannot read member profiles');
select is((select count(*)::int from public.project_versions), 0, 'stranger cannot read versions');
select is((select count(*)::int from public.share_links), 0, 'stranger cannot read share-link tokens');
select is((select count(*)::int from public.project_invites), 0, 'stranger cannot read invites');
select is((select count(*)::int from public.profiles), 1, 'stranger reads only their own profile row');
select is(public.project_role('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1'), null,
  'project_role() will not answer about other users (no oracle)');
select is((select count(*)::int from public.profile_card('00000000-0000-0000-0000-0000000000b2')), 0,
  'profile_card() hides people you share no project with');
select throws_ok($$ select * from public.user_id_by_email('owner.anita@example.com') $$, '42501', null,
  'user_id_by_email() is service-role only');

reset role;

-- ---------------------------------------------------------------------------
-- VIEW member (B)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2', 'viewer.bala@example.com');

select is((select count(*)::int from public.projects), 1, 'member can read the project');
select is((select role from public.my_projects), 'VIEW', 'my_projects shows the member''s role');
select is((select owner_name from public.my_projects), 'Owner Anita', 'my_projects shows the owner''s name');
select is((select count(*)::int from public.project_versions), 1, 'member can read versions');
select is((select email from public.project_member_profiles where user_id = '00000000-0000-0000-0000-0000000000b2'), null,
  'emails do not leak to non-owners (even your own row via the view)');
select is((select count(*)::int from public.share_links), 0, 'member cannot read share-link tokens');
select is((select count(*)::int from public.project_invites), 0, 'member cannot read other people''s invites');

select throws_ok($$ insert into public.projects (owner_id, name, data) values ('00000000-0000-0000-0000-0000000000b2', 'x', '{}') $$,
  '42501', null, 'member cannot insert projects');
select throws_ok($$ update public.projects set name = 'hijacked' $$, '42501', null, 'member cannot update projects');
select throws_ok($$ delete from public.projects $$, '42501', null, 'member cannot delete projects');
select throws_ok($$ update public.project_members set role = 'FULL' $$, '42501', null, 'member cannot raise their own role');
select throws_ok($$ insert into public.project_members (project_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c3', 'FULL') $$,
  '42501', null, 'member cannot add members');
select throws_ok($$ insert into public.share_links (project_id, role) values ('11111111-1111-1111-1111-111111111111', 'VIEW') $$,
  '42501', null, 'member cannot mint share links');
select throws_ok($$ select public.commit_project('11111111-1111-1111-1111-111111111111', 1, '{}', null, '{}', null, 'SAVE') $$,
  '42501', null, 'commit_project() is service-role only');

update public.profiles set display_name = 'Bala K' where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set display_name = 'Pwned' where id = '00000000-0000-0000-0000-0000000000a1';
select throws_ok($$ update public.profiles set id = gen_random_uuid() $$, '42501', null, 'profile id is not updatable');

reset role;

select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'Bala K', 'user can rename themselves');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'Owner Anita', 'user cannot rename someone else');

-- ---------------------------------------------------------------------------
-- Owner (A)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'owner.anita@example.com');

select is((select role from public.my_projects), 'OWNER', 'owner sees role OWNER');
select is((select email from public.project_member_profiles where user_id = '00000000-0000-0000-0000-0000000000b2'), 'viewer.bala@example.com',
  'owner sees member emails');
select is((select count(*)::int from public.share_links), 1, 'owner reads their share links');
select throws_ok($$ update public.projects set data = '{}' $$, '42501', null, 'even the owner cannot update projects directly');

reset role;

-- ---------------------------------------------------------------------------
-- Invitee (D) and anonymous
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4', 'invitee.dev@example.com');
select is((select project_name from public.my_invites), 'Test house', 'invitee sees their pending invite with the project name');
select is((select count(*)::int from public.projects), 0, 'a pending invite grants no project access');
reset role;

set local role anon;
select throws_ok($$ select * from public.projects $$, '42501', null, 'anon cannot read projects at all');
select throws_ok($$ select * from public.share_links $$, '42501', null, 'anon cannot enumerate share links');
reset role;

-- ---------------------------------------------------------------------------
-- History retention
-- ---------------------------------------------------------------------------

insert into public.project_versions (project_id, version, author_id, reason, data, created_at)
select '11111111-1111-1111-1111-111111111111', 1 + g, '00000000-0000-0000-0000-0000000000a1', 'SAVE', '{}', now() + make_interval(secs => g)
from generate_series(1, 60) g;
select is((select count(*)::int from public.project_versions where project_id = '11111111-1111-1111-1111-111111111111'), 50,
  'only the latest 50 versions are kept');

select * from finish();
rollback;
