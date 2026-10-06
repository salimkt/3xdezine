-- 3xDezine cloud schema: profiles, projects, sharing, versions.
--
-- Contract: shared/cloud.ts. Security model in one line: clients READ through
-- PostgREST under row-level security; every WRITE (except a user's own profile)
-- goes through an Edge Function using the service role, which runs the shared
-- rules engine first. So there are deliberately no INSERT/UPDATE/DELETE
-- policies for `authenticated` on anything but `profiles`, and the table
-- privileges are revoked as well (two independent locks).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Declaration order IS the privilege order, so `role >= 'LAYOUT'` works.
create type public.edit_level as enum ('VIEW', 'FINISHES', 'LAYOUT', 'FULL');
create type public.version_reason as enum ('CREATE', 'SAVE', 'PROPOSAL_ACCEPTED', 'RESTORE');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 80),
  avatar_color  text not null check (avatar_color ~ '^#[0-9A-F]{6}$'),
  preferences   jsonb not null default '{"showSqft": false, "defaultHour": 10}'::jsonb
                check (jsonb_typeof(preferences) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user, created by trigger. Owner may update display_name, avatar_color, preferences.';

-- Fixed palette for avatar chips: muted, legible with white initials.
create or replace function public.avatar_color_for(seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array[
    '#C0573E', '#B7793A', '#8A8F3C', '#4F8A5B', '#2F8A84',
    '#3C7BA8', '#5867B0', '#7C5BA6', '#A4528A', '#6B6460'
  ])[1 + ((hashtext(coalesce(seed, ''))::bigint % 10) + 10) % 10];
$$;

-- "anita.rao_92@x.com" -> "Anita Rao 92"
create or replace function public.display_name_from_email(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(initcap(trim(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[._+-]+', ' ', 'g'))), 80), ''),
    'Designer'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_color)
  values (
    new.id,
    coalesce(
      nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 80), ''),
      nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 80), ''),
      public.display_name_from_email(new.email)
    ),
    public.avatar_color_for(new.id::text)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Projects and access
-- ---------------------------------------------------------------------------

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 200),
  data               jsonb not null check (jsonb_typeof(data) = 'object'),
  template_id        text,
  version            integer not null default 1 check (version >= 1),
  -- Denormalised for the projects grid; recomputed by the Edge Functions on every write.
  built_up_sqm       double precision not null default 0,
  rooms              integer not null default 0,
  buffered_total     double precision not null default 0,
  currency           text not null default 'INR',
  pending_proposals  integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index projects_owner_idx on public.projects (owner_id);

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.edit_level not null,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);
create index project_members_added_by_idx on public.project_members (added_by);

create table public.project_invites (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  email        text not null check (email = lower(email) and email like '%_@_%'),
  role         public.edit_level not null,
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz
);

create index project_invites_project_idx on public.project_invites (project_id);
create index project_invites_email_idx on public.project_invites (lower(email));
create index project_invites_invited_by_idx on public.project_invites (invited_by);
-- One open invite per address per project; re-inviting refreshes it.
create unique index project_invites_one_pending
  on public.project_invites (project_id, email) where accepted_at is null;

create table public.share_links (
  -- 32 random bytes (256 bits). The Edge Function supplies a base64url token;
  -- the default is a hex fallback of the same strength.
  token       text primary key default encode(extensions.gen_random_bytes(32), 'hex')
              check (char_length(token) >= 32),
  project_id  uuid not null references public.projects (id) on delete cascade,
  role        public.edit_level not null check (role in ('VIEW', 'FINISHES')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked     boolean not null default false
);

create index share_links_project_idx on public.share_links (project_id);
create index share_links_created_by_idx on public.share_links (created_by);

create table public.project_versions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  version         integer not null,
  author_id       uuid references public.profiles (id) on delete set null,
  reason          public.version_reason not null,
  data            jsonb not null,
  rooms           integer not null default 0,
  built_up_sqm    double precision not null default 0,
  buffered_total  double precision not null default 0,
  created_at      timestamptz not null default now(),
  -- Moves forward when consecutive saves are coalesced into this snapshot.
  updated_at      timestamptz not null default now()
);

create index project_versions_project_idx on public.project_versions (project_id, created_at desc);
create index project_versions_author_idx on public.project_versions (author_id);

-- Keep at most the latest 50 snapshots per project.
create or replace function public.trim_project_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.project_versions v
  where v.project_id = new.project_id
    and v.id not in (
      select k.id from public.project_versions k
      where k.project_id = new.project_id
      order by k.created_at desc, k.version desc
      limit 50
    );
  return null;
end;
$$;

create trigger project_versions_trim
  after insert on public.project_versions
  for each row execute function public.trim_project_versions();

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- SECURITY DEFINER so policies can consult project_members / projects without
-- re-entering their RLS (projects -> members -> projects would recurse).
-- Each refuses to answer questions about anyone but the caller, so they can't
-- be used as an oracle via /rest/v1/rpc. Service-role callers (auth.uid() is
-- null) may ask about anyone.
-- ---------------------------------------------------------------------------

-- 'OWNER', a member role ('VIEW'..'FULL'), or null for no access.
create or replace function public.project_role(p_project_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then null
    when auth.uid() is not null and p_user_id <> auth.uid() then null
    when exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_user_id) then 'OWNER'
    else (select m.role::text from public.project_members m
          where m.project_id = p_project_id and m.user_id = p_user_id)
  end;
$$;

create or replace function public.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.project_role(p_project_id, auth.uid()) is not null;
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid());
$$;

-- True when the caller and `p_user_id` are the same person or share a project.
create or replace function public.shares_project_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or exists (
      with mine as (
        select p.id from public.projects p where p.owner_id = auth.uid()
        union select m.project_id from public.project_members m where m.user_id = auth.uid()
      )
      select 1 from mine
      where exists (select 1 from public.projects p where p.id = mine.id and p.owner_id = p_user_id)
         or exists (select 1 from public.project_members m where m.project_id = mine.id and m.user_id = p_user_id)
    )
  );
$$;

-- Public face of another user: name and colour, only for people you share a project with.
create or replace function public.profile_card(p_user_id uuid)
returns table (display_name text, avatar_color text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.display_name, pr.avatar_color
  from public.profiles pr
  where pr.id = p_user_id and public.shares_project_with(p_user_id);
$$;

-- A member's email, but only to that project's owner.
create or replace function public.member_email(p_project_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
  from auth.users u
  where u.id = p_user_id
    and public.is_project_owner(p_project_id)
    and exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = p_user_id);
$$;

-- What an invitee may know about the project they are invited to: its name and the inviter's name.
create or replace function public.invite_card(p_invite_id uuid)
returns table (project_name text, invited_by_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, pr.display_name
  from public.project_invites i
  join public.projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.invited_by
  where i.id = p_invite_id
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Service-role only: resolve an email to a confirmed account, for invite-member.
create or replace function public.user_id_by_email(p_email text)
returns table (user_id uuid, confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Atomic write used by the Edge Functions (service role only)
--
-- Compare-and-set on `version` plus an optional snapshot, in one transaction.
-- Returns the new version, or -1 * stored version on a CONFLICT (so the caller
-- can report `currentVersion` without a second round trip), or null when the
-- project does not exist.
--
-- Snapshot coalescing: a SAVE by the same author within 10 minutes of the
-- latest snapshot's creation, when that latest snapshot is itself that
-- author's SAVE, updates it in place (data, version, summary, updated_at)
-- instead of adding a row. So a burst of autosaves becomes one history entry
-- covering at most 10 minutes of work. CREATE, PROPOSAL_ACCEPTED and RESTORE
-- always add a row and end any burst.
-- ---------------------------------------------------------------------------

create or replace function public.commit_project(
  p_project_id    uuid,
  p_base_version  integer,
  p_data          jsonb,
  p_name          text,
  p_summary       jsonb,
  p_author_id     uuid,
  p_reason        public.version_reason
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer;
  v_next    integer;
  v_latest  public.project_versions%rowtype;
begin
  select version into v_current from public.projects where id = p_project_id for update;
  if not found then
    return null;
  end if;
  if v_current <> p_base_version then
    return -v_current;
  end if;
  v_next := v_current + 1;

  update public.projects set
    data              = p_data,
    name              = coalesce(p_name, name),
    version           = v_next,
    built_up_sqm      = coalesce((p_summary ->> 'builtUpSqm')::double precision, built_up_sqm),
    rooms             = coalesce((p_summary ->> 'rooms')::integer, rooms),
    buffered_total    = coalesce((p_summary ->> 'bufferedTotal')::double precision, buffered_total),
    currency          = coalesce(p_summary ->> 'currency', currency),
    pending_proposals = coalesce((p_summary ->> 'pendingProposals')::integer, pending_proposals),
    updated_at        = now()
  where id = p_project_id;

  if p_reason is not null then
    select * into v_latest from public.project_versions
      where project_id = p_project_id
      order by created_at desc, version desc
      limit 1;

    if p_reason = 'SAVE'
       and v_latest.id is not null
       and v_latest.reason = 'SAVE'
       and v_latest.author_id is not distinct from p_author_id
       and v_latest.created_at > now() - interval '10 minutes' then
      update public.project_versions set
        version        = v_next,
        data           = p_data,
        rooms          = coalesce((p_summary ->> 'rooms')::integer, 0),
        built_up_sqm   = coalesce((p_summary ->> 'builtUpSqm')::double precision, 0),
        buffered_total = coalesce((p_summary ->> 'bufferedTotal')::double precision, 0),
        updated_at     = now()
      where id = v_latest.id;
    else
      insert into public.project_versions (project_id, version, author_id, reason, data, rooms, built_up_sqm, buffered_total)
      values (
        p_project_id, v_next, p_author_id, p_reason, p_data,
        coalesce((p_summary ->> 'rooms')::integer, 0),
        coalesce((p_summary ->> 'builtUpSqm')::double precision, 0),
        coalesce((p_summary ->> 'bufferedTotal')::double precision, 0)
      );
    end if;
  end if;

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: default deny, then read-only grants
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.project_invites  enable row level security;
alter table public.share_links      enable row level security;
alter table public.project_versions enable row level security;

-- profiles: your own row only. Other people's names come through profile_card().
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- projects: owner and members read; nobody writes directly.
create policy projects_select_readable on public.projects
  for select to authenticated using (owner_id = (select auth.uid()) or public.can_read_project(id));

-- project_members: visible to anyone who can read the project.
create policy project_members_select on public.project_members
  for select to authenticated using (user_id = (select auth.uid()) or public.can_read_project(project_id));

-- project_invites: the owner, and the invitee for invites addressed to them.
create policy project_invites_select on public.project_invites
  for select to authenticated using (
    public.is_project_owner(project_id)
    or email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

-- share_links: owner only — a token is a capability.
create policy share_links_select_owner on public.share_links
  for select to authenticated using (public.is_project_owner(project_id));

-- project_versions: anyone who can read the project.
create policy project_versions_select on public.project_versions
  for select to authenticated using (public.can_read_project(project_id));

-- Privileges. Supabase grants everything to anon/authenticated by default;
-- take it back so a missing policy can never become a write path.
revoke all on public.profiles, public.projects, public.project_members, public.project_invites,
              public.share_links, public.project_versions from anon, authenticated;
grant select on public.profiles, public.projects, public.project_members, public.project_invites,
                public.share_links, public.project_versions to authenticated;
grant update (display_name, avatar_color, preferences) on public.profiles to authenticated;

grant all on public.profiles, public.projects, public.project_members, public.project_invites,
             public.share_links, public.project_versions to service_role;

-- Functions: helpers callable by signed-in users (they only ever answer about
-- the caller); the rest service-role only.
revoke execute on function
  public.project_role(uuid, uuid), public.can_read_project(uuid), public.is_project_owner(uuid),
  public.shares_project_with(uuid), public.profile_card(uuid), public.member_email(uuid, uuid),
  public.invite_card(uuid), public.user_id_by_email(text),
  public.commit_project(uuid, integer, jsonb, text, jsonb, uuid, public.version_reason),
  public.handle_new_user(), public.trim_project_versions(),
  public.avatar_color_for(text), public.display_name_from_email(text)
  from public, anon, authenticated;

grant execute on function
  public.project_role(uuid, uuid), public.can_read_project(uuid), public.is_project_owner(uuid),
  public.shares_project_with(uuid), public.profile_card(uuid), public.member_email(uuid, uuid),
  public.invite_card(uuid)
  to authenticated;

grant execute on function
  public.project_role(uuid, uuid), public.can_read_project(uuid), public.is_project_owner(uuid),
  public.shares_project_with(uuid), public.profile_card(uuid), public.member_email(uuid, uuid),
  public.invite_card(uuid), public.user_id_by_email(text),
  public.commit_project(uuid, integer, jsonb, text, jsonb, uuid, public.version_reason),
  public.avatar_color_for(text), public.display_name_from_email(text)
  to service_role;

-- The auth trigger runs as the definer, but supabase_auth_admin needs to call it.
grant execute on function public.handle_new_user(), public.avatar_color_for(text),
  public.display_name_from_email(text) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------

-- CloudProjectSummary for every project the caller owns or belongs to.
create view public.my_projects
with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.owner_id,
  coalesce((select c.display_name from public.profile_card(p.owner_id) c), 'Unknown') as owner_name,
  case when p.owner_id = (select auth.uid()) then 'OWNER' else m.role::text end as role,
  p.template_id,
  p.version,
  p.created_at,
  p.updated_at,
  p.built_up_sqm,
  p.rooms,
  p.buffered_total,
  p.currency,
  p.pending_proposals
from public.projects p
left join public.project_members m
  on m.project_id = p.id and m.user_id = (select auth.uid())
where p.owner_id = (select auth.uid()) or m.user_id is not null;

-- ProjectMember rows for projects the caller can read. `email` is null unless
-- the caller owns the project.
create view public.project_member_profiles
with (security_invoker = true)
as
select
  m.project_id,
  m.user_id,
  coalesce(c.display_name, 'Unknown') as display_name,
  coalesce(c.avatar_color, '#6B6460') as avatar_color,
  public.member_email(m.project_id, m.user_id) as email,
  m.role,
  m.added_at
from public.project_members m
left join lateral public.profile_card(m.user_id) c on true;

-- Pending, unexpired invites addressed to the caller's (confirmed) email.
create view public.my_invites
with (security_invoker = true)
as
select
  i.id,
  i.project_id,
  c.project_name,
  i.invited_by,
  c.invited_by_name,
  i.email,
  i.role,
  i.created_at,
  i.expires_at
from public.project_invites i
left join lateral public.invite_card(i.id) c on true
where i.accepted_at is null
  and i.expires_at > now()
  and i.email = lower(coalesce((select auth.jwt()) ->> 'email', ''));

revoke all on public.my_projects, public.project_member_profiles, public.my_invites from anon, authenticated;
grant select on public.my_projects, public.project_member_profiles, public.my_invites to authenticated;
