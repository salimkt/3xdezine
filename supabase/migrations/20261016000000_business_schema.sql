-- 3xDezine business schema: studios, rate cards, quotations, client approvals,
-- plans/entitlements and Razorpay billing.
--
-- Contract: shared/business.ts. Same security model as the cloud schema:
-- clients READ through PostgREST under RLS; every WRITE goes through an Edge
-- Function using the service role. No INSERT/UPDATE/DELETE policy or table
-- privilege exists for `anon`/`authenticated` on any table below.
--
-- Evidence tables (quote_responses, payments) are append-only for EVERYONE,
-- the service role included: a trigger refuses UPDATE, DELETE and TRUNCATE.

-- ---------------------------------------------------------------------------
-- Studios and seats
-- ---------------------------------------------------------------------------

create type public.studio_role as enum ('OWNER', 'MEMBER');

create table public.studios (
  id          uuid primary key default gen_random_uuid(),
  -- One owned (personal) studio per user, created lazily by save-studio.
  owner_id    uuid not null unique references public.profiles (id) on delete cascade,
  -- StudioProfile minus `id`.
  profile     jsonb not null check (jsonb_typeof(profile) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A 64 KB image is at most 87,384 base64 chars plus a short data-URL header.
  -- save-studio checks the decoded size exactly; this is the backstop.
  constraint studios_logo_size check (coalesce(char_length(profile ->> 'logoDataUrl'), 0) <= 87500),
  constraint studios_profile_size check (pg_column_size(profile) <= 200000)
);

create trigger studios_touch before update on public.studios
  for each row execute function public.touch_updated_at();

create table public.studio_members (
  studio_id  uuid not null references public.studios (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.studio_role not null default 'MEMBER',
  added_at   timestamptz not null default now(),
  primary key (studio_id, user_id)
);

create index studio_members_user_idx on public.studio_members (user_id);

alter table public.projects
  add column studio_id uuid references public.studios (id) on delete set null;
create index projects_studio_idx on public.projects (studio_id);

-- A studio's changes on top of the base rate card (RateCardOverrides).
create table public.rate_overrides (
  studio_id   uuid primary key references public.studios (id) on delete cascade,
  overrides   jsonb not null check (jsonb_typeof(overrides) = 'object'),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint rate_overrides_size check (pg_column_size(overrides) <= 1000000)
);

create trigger rate_overrides_touch before update on public.rate_overrides
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------

create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  studio_id       uuid not null references public.studios (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null,
  doc_type        text not null check (doc_type in ('QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE', 'VARIATION_ORDER')),
  -- Assigned on issue by issue_quote_commit(); never reused.
  number          text,
  financial_year  text check (financial_year ~ '^\d{4}-\d{2}$'),
  version         integer not null default 1 check (version >= 1),
  supersedes_id   uuid references public.quotes (id) on delete cascade,
  amends_id       uuid references public.quotes (id) on delete cascade,
  status          text not null default 'DRAFT'
                  check (status in ('DRAFT', 'ISSUED', 'APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'CANCELLED')),
  -- QuotationDocument, as computed by the server (shared/quote.ts buildQuote).
  data            jsonb not null check (jsonb_typeof(data) = 'object'),
  -- The editable draft input (SaveQuoteDraftRequest['input']) the document was
  -- built from, so issue-quote can rebuild it against the latest studio and plan.
  input           jsonb not null check (jsonb_typeof(input) = 'object'),
  -- The plan as it was when issued: what the client's link shows.
  project_data    jsonb,
  -- VARIATION_ORDER only: shared/quote.ts diffQuotes(approved quote, this).
  diff            jsonb,
  hash            text check (hash ~ '^[0-9a-f]{64}$'),
  issued_at       timestamptz,
  locked_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint quotes_issued_has_number check (status = 'DRAFT' or (number is not null and hash is not null and issued_at is not null)),
  constraint quotes_data_size check (pg_column_size(data) + pg_column_size(input) + coalesce(pg_column_size(project_data), 0) <= 8000000)
);

create index quotes_project_idx on public.quotes (project_id, created_at desc);
create index quotes_studio_idx on public.quotes (studio_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quotes_supersedes_idx on public.quotes (supersedes_id);
create index quotes_amends_idx on public.quotes (amends_id);
create unique index quotes_number_unique on public.quotes (studio_id, doc_type, number) where number is not null;

create trigger quotes_touch before update on public.quotes
  for each row execute function public.touch_updated_at();

-- Issued documents are immutable. After DRAFT, only the status may move
-- forward, and the document may change only in the fields the hash excludes
-- (status, approvals, lockedAt). Applies to the service role too.
create or replace function public.guard_quote_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'approvals', 'lockedAt'];
begin
  if old.status = 'DRAFT' then
    return new;
  end if;
  if new.number is distinct from old.number
     or new.doc_type is distinct from old.doc_type
     or new.hash is distinct from old.hash
     or new.project_id is distinct from old.project_id
     or new.studio_id is distinct from old.studio_id
     or new.version is distinct from old.version
     or new.financial_year is distinct from old.financial_year
     or new.supersedes_id is distinct from old.supersedes_id
     or new.amends_id is distinct from old.amends_id
     or new.issued_at is distinct from old.issued_at
     or new.input is distinct from old.input
     or new.project_data is distinct from old.project_data
     or new.diff is distinct from old.diff
     or (old.locked_at is not null and new.locked_at is distinct from old.locked_at)
     or (new.data - v_mutable) is distinct from (old.data - v_mutable) then
    raise exception 'quote % is issued and immutable', old.id using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'ISSUED' and new.status in ('APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'CANCELLED'))
    or (old.status = 'CHANGES_REQUESTED' and new.status in ('SUPERSEDED', 'CANCELLED'))
  ) then
    raise exception 'quote % cannot go from % to %', old.id, old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger quotes_guard before update on public.quotes
  for each row execute function public.guard_quote_update();

-- Per studio, document type and financial year: the last number handed out.
create table public.quote_number_series (
  studio_id       uuid not null references public.studios (id) on delete cascade,
  doc_type        text not null,
  financial_year  text not null check (financial_year ~ '^\d{4}-\d{2}$'),
  last_seq        integer not null default 0 check (last_seq >= 0),
  primary key (studio_id, doc_type, financial_year)
);

-- Client approval links. A token is a capability: ≥ 128 bits, base64url.
create table public.quote_links (
  token       text primary key check (char_length(token) >= 22),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked     boolean not null default false
);

create index quote_links_quote_idx on public.quote_links (quote_id);
create index quote_links_created_by_idx on public.quote_links (created_by);

-- Append-only evidence of client decisions. No foreign key to quotes on
-- purpose: the record survives even if the project is deleted later.
create table public.quote_responses (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null,
  link_token     text,
  quote_number   text,
  decision       text not null check (decision in ('APPROVED', 'CHANGES_REQUESTED')),
  by_name        text not null check (char_length(by_name) between 1 and 120),
  by_contact     text not null check (char_length(by_contact) between 3 and 120),
  comment        text check (char_length(comment) <= 2000),
  document_hash  text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  user_agent     text check (char_length(user_agent) <= 500),
  ip             text check (char_length(ip) <= 64),
  at             timestamptz not null default now()
);

create index quote_responses_quote_idx on public.quote_responses (quote_id, at desc);
create index quote_responses_token_idx on public.quote_responses (link_token, at desc);

create or replace function public.refuse_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger quote_responses_append_only before update or delete on public.quote_responses
  for each row execute function public.refuse_mutation();
create trigger quote_responses_no_truncate before truncate on public.quote_responses
  for each statement execute function public.refuse_mutation();

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  plan                      text not null check (plan in ('SOLO', 'STUDIO', 'BUSINESS')),
  interval                  text not null check (interval in ('MONTH', 'YEAR')),
  -- Razorpay subscription states, upper-cased: CREATED, AUTHENTICATED, ACTIVE,
  -- PENDING, HALTED, CANCELLED, COMPLETED, EXPIRED, PAUSED.
  status                    text not null default 'CREATED',
  razorpay_subscription_id  text not null unique,
  razorpay_plan_id          text,
  razorpay_customer_id      text,
  current_period_end        timestamptz,
  seats                     integer not null default 1 check (seats >= 1),
  simulated                 boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index subscriptions_user_idx on public.subscriptions (user_id);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Checkouts we started: lets the webhook map a Razorpay order back to the
-- buyer and project, and check the amount paid.
create table public.checkout_orders (
  razorpay_order_id  text primary key,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  project_id         uuid references public.projects (id) on delete set null,
  plan               text not null,
  amount             integer not null check (amount > 0),
  currency           text not null default 'INR',
  simulated          boolean not null default false,
  created_at         timestamptz not null default now()
);

create index checkout_orders_user_idx on public.checkout_orders (user_id);
create index checkout_orders_project_idx on public.checkout_orders (project_id);

create table public.project_passes (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  project_id           uuid not null references public.projects (id) on delete cascade,
  razorpay_order_id    text,
  razorpay_payment_id  text not null unique,
  expires_at           timestamptz not null,
  created_at           timestamptz not null default now()
);

create index project_passes_user_idx on public.project_passes (user_id, expires_at desc);
create index project_passes_project_idx on public.project_passes (project_id);

-- Ledger of webhook-confirmed payments. Append-only.
create table public.payments (
  id                        uuid primary key default gen_random_uuid(),
  -- No FK: the ledger outlives a deleted account (and an ON DELETE SET NULL would be an UPDATE).
  user_id                   uuid,
  kind                      text not null check (kind in ('PROJECT_PASS', 'SUBSCRIPTION')),
  razorpay_payment_id       text not null unique,
  razorpay_order_id         text,
  razorpay_subscription_id  text,
  amount                    integer not null,
  currency                  text not null default 'INR',
  event_id                  text not null,
  raw                       jsonb not null,
  simulated                 boolean not null default false,
  created_at                timestamptz not null default now()
);

create index payments_user_idx on public.payments (user_id, created_at desc);

create trigger payments_append_only before update or delete on public.payments
  for each row execute function public.refuse_mutation();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function public.refuse_mutation();

-- Webhook events already processed (idempotency on x-razorpay-event-id).
create table public.billing_events (
  event_id     text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER; answer only about the caller)
-- ---------------------------------------------------------------------------

create or replace function public.is_studio_member(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.studio_members m where m.studio_id = p_studio_id and m.user_id = auth.uid())
  );
$$;

create or replace function public.can_read_quote(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote_id
      and (public.can_read_project(q.project_id) or public.is_studio_member(q.studio_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic issue (service role only)
--
-- Numbers are consecutive and never reused (CGST Rule 46(b)). The Edge
-- Function peeks at last_seq, formats the number with the shared engine
-- (nextQuoteNumber), builds and hashes the document, then calls this, which
-- locks the series row and compare-and-sets last_seq. Number allocation and
-- the quote update commit together, so a failure leaves no gap; a concurrent
-- issue makes this return 'SEQ:<current>' and the caller retries.
--
-- Returns 'OK', 'SEQ:<n>', 'NOT_DRAFT' or 'NOT_FOUND'.
-- ---------------------------------------------------------------------------

create or replace function public.issue_quote_commit(
  p_quote_id      uuid,
  p_expected_seq  integer,
  p_number        text,
  p_fy            text,
  p_data          jsonb,
  p_hash          text,
  p_project_data  jsonb,
  p_token         text,
  p_created_by    uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_seq   integer;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if v_quote.status <> 'DRAFT' then
    return 'NOT_DRAFT';
  end if;

  insert into public.quote_number_series (studio_id, doc_type, financial_year, last_seq)
  values (v_quote.studio_id, v_quote.doc_type, p_fy, 0)
  on conflict do nothing;

  select last_seq into v_seq from public.quote_number_series
  where studio_id = v_quote.studio_id and doc_type = v_quote.doc_type and financial_year = p_fy
  for update;

  if v_seq <> p_expected_seq then
    return 'SEQ:' || v_seq;
  end if;

  update public.quote_number_series set last_seq = v_seq + 1
  where studio_id = v_quote.studio_id and doc_type = v_quote.doc_type and financial_year = p_fy;

  update public.quotes set
    status         = 'ISSUED',
    number         = p_number,
    financial_year = p_fy,
    data           = p_data,
    hash           = p_hash,
    project_data   = p_project_data,
    issued_at      = now()
  where id = p_quote_id;

  if v_quote.supersedes_id is not null then
    update public.quotes set
      status = 'SUPERSEDED',
      data   = jsonb_set(data, '{status}', '"SUPERSEDED"')
    where id = v_quote.supersedes_id and status in ('ISSUED', 'CHANGES_REQUESTED');
    if not found then
      raise exception 'quote % can no longer be revised', v_quote.supersedes_id using errcode = 'P0001';
    end if;
    -- The old link keeps working and shows SUPERSEDED; respond-to-quote refuses it.
  end if;

  insert into public.quote_links (token, quote_id, created_by) values (p_token, p_quote_id, p_created_by);
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic client response (service role only)
--
-- Locks the quote, checks the link, status and hash, applies a one-decision-
-- per-token-per-minute limit, appends the evidence row and moves the status.
-- Returns { result: 'OK' | 'NOT_FOUND' | 'NOT_ISSUED' | 'STALE' | 'RATE_LIMITED', data? }.
-- ---------------------------------------------------------------------------

create or replace function public.record_quote_response(
  p_token       text,
  p_decision    text,
  p_by_name     text,
  p_by_contact  text,
  p_comment     text,
  p_hash        text,
  p_user_agent  text,
  p_ip          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.quote_links%rowtype;
  v_quote    public.quotes%rowtype;
  v_at       timestamptz := now();
  v_id       uuid := gen_random_uuid();
  v_approval jsonb;
  v_data     jsonb;
begin
  select * into v_link from public.quote_links where token = p_token;
  if not found or v_link.revoked then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;
  select * into v_quote from public.quotes where id = v_link.quote_id for update;
  if not found then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;
  if v_quote.status <> 'ISSUED' then
    return jsonb_build_object('result', 'NOT_ISSUED', 'status', v_quote.status);
  end if;
  if v_quote.hash is distinct from p_hash then
    return jsonb_build_object('result', 'STALE');
  end if;
  if exists (select 1 from public.quote_responses r
             where r.link_token = p_token and r.at > v_at - interval '1 minute') then
    return jsonb_build_object('result', 'RATE_LIMITED');
  end if;

  insert into public.quote_responses (id, quote_id, link_token, quote_number, decision, by_name, by_contact, comment, document_hash, user_agent, ip, at)
  values (v_id, v_quote.id, p_token, v_quote.number, p_decision, p_by_name, p_by_contact, nullif(p_comment, ''), p_hash, p_user_agent, p_ip, v_at);

  v_approval := jsonb_strip_nulls(jsonb_build_object(
    'id', v_id,
    'decision', p_decision,
    'byName', p_by_name,
    'byContact', p_by_contact,
    'method', 'PORTAL_LINK',
    'at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'documentHash', p_hash,
    'comment', nullif(p_comment, ''),
    'userAgent', p_user_agent
  ));

  v_data := jsonb_set(v_quote.data, '{approvals}', coalesce(v_quote.data -> 'approvals', '[]'::jsonb) || jsonb_build_array(v_approval));
  v_data := jsonb_set(v_data, '{status}', to_jsonb(p_decision));
  if p_decision = 'APPROVED' then
    v_data := jsonb_set(v_data, '{lockedAt}', to_jsonb(to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;

  update public.quotes set
    status    = p_decision,
    data      = v_data,
    locked_at = case when p_decision = 'APPROVED' then v_at else locked_at end
  where id = v_quote.id;

  return jsonb_build_object('result', 'OK', 'data', v_data);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: default deny, then read-only grants
-- ---------------------------------------------------------------------------

alter table public.studios             enable row level security;
alter table public.studio_members      enable row level security;
alter table public.rate_overrides      enable row level security;
alter table public.quotes              enable row level security;
alter table public.quote_number_series enable row level security;
alter table public.quote_links         enable row level security;
alter table public.quote_responses     enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.checkout_orders     enable row level security;
alter table public.project_passes      enable row level security;
alter table public.payments            enable row level security;
alter table public.billing_events      enable row level security;

create policy studios_select_member on public.studios
  for select to authenticated using (owner_id = (select auth.uid()) or public.is_studio_member(id));

create policy studio_members_select on public.studio_members
  for select to authenticated using (user_id = (select auth.uid()) or public.is_studio_member(studio_id));

create policy rate_overrides_select_member on public.rate_overrides
  for select to authenticated using (public.is_studio_member(studio_id));

create policy quotes_select_readable on public.quotes
  for select to authenticated using (public.can_read_project(project_id) or public.is_studio_member(studio_id));

create policy quote_number_series_select_member on public.quote_number_series
  for select to authenticated using (public.is_studio_member(studio_id));

-- A token is a capability: the project owner and whoever issued it.
create policy quote_links_select on public.quote_links
  for select to authenticated using (
    created_by = (select auth.uid())
    or exists (select 1 from public.quotes q where q.id = quote_id and public.is_project_owner(q.project_id))
  );

create policy quote_responses_select on public.quote_responses
  for select to authenticated using (public.can_read_quote(quote_id));

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

create policy checkout_orders_select_own on public.checkout_orders
  for select to authenticated using (user_id = (select auth.uid()));

create policy project_passes_select_own on public.project_passes
  for select to authenticated using (user_id = (select auth.uid()));

create policy payments_select_own on public.payments
  for select to authenticated using (user_id = (select auth.uid()));

-- billing_events: no policy — nobody but the service role reads it.

revoke all on public.studios, public.studio_members, public.rate_overrides, public.quotes,
              public.quote_number_series, public.quote_links, public.quote_responses,
              public.subscriptions, public.checkout_orders, public.project_passes,
              public.payments, public.billing_events
  from anon, authenticated;

grant select on public.studios, public.studio_members, public.rate_overrides, public.quotes,
                public.quote_number_series, public.quote_links, public.quote_responses,
                public.subscriptions, public.checkout_orders, public.project_passes, public.payments
  to authenticated;

grant all on public.studios, public.studio_members, public.rate_overrides, public.quotes,
             public.quote_number_series, public.quote_links,
             public.subscriptions, public.checkout_orders, public.project_passes, public.billing_events
  to service_role;
-- Evidence: the service role may only read and append.
revoke all on public.quote_responses, public.payments from service_role;
grant select, insert on public.quote_responses, public.payments to service_role;

revoke execute on function
  public.is_studio_member(uuid), public.can_read_quote(uuid),
  public.issue_quote_commit(uuid, integer, text, text, jsonb, text, jsonb, text, uuid),
  public.record_quote_response(text, text, text, text, text, text, text, text),
  public.guard_quote_update(), public.refuse_mutation()
  from public, anon, authenticated;

grant execute on function public.is_studio_member(uuid), public.can_read_quote(uuid) to authenticated;
grant execute on function
  public.is_studio_member(uuid), public.can_read_quote(uuid),
  public.issue_quote_commit(uuid, integer, text, text, jsonb, text, jsonb, text, uuid),
  public.record_quote_response(text, text, text, text, text, text, text, text)
  to service_role;
