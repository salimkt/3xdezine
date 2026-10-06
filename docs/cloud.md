# 3xDezine cloud (Supabase)

Accounts, cloud projects, sharing with roles, proposals and version history.
The contract is `shared/cloud.ts`. The backend lives in `supabase/`.

```
supabase/
  config.toml                         local stack and auth settings (magic link, redirects, Google off)
  migrations/20261006000000_cloud_schema.sql   tables, RLS, views, helper functions
  functions/<name>/index.ts           one Edge Function per CLOUD_FUNCTIONS entry
  functions/_shared/                  auth, HTTP/CORS/errors, project access, save enforcement
  functions/_shared/domain/           GENERATED copies of shared/{types,cost,rules,cloud}.ts + catalog
  scripts/sync-shared.mjs             writes / checks those copies
  tests/database/rls.test.sql         pgTAP: RLS and privileges
  tests/e2e.ts                        end-to-end scenario against the running stack
```

## How it works

- **Reads** go through PostgREST. Row-level security limits each user to the
  projects they own or belong to. Clients read `my_projects`, `projects`,
  `project_member_profiles`, `project_versions`, `my_invites`, their own
  `profiles` row, and, as the owner, `project_invites` and `share_links`.
- **Writes** go only through Edge Functions. `authenticated` has no
  INSERT/UPDATE/DELETE policy and no table privilege on any project table.
  The only exception is the `display_name`, `avatar_color` and `preferences`
  columns of the user's own profile. The functions identify the caller by
  asking Auth about the bearer token, resolve their role, and write with the
  service role.
- **Roles.** The owner always has FULL. A member's effective level is
  `min(role, project.policy.level)`. If no policy is set, the rules engine's
  `DEFAULT_POLICY` applies, which is LAYOUT, so FULL members are capped at
  LAYOUT until the owner sets `policy.level = FULL`. Only the owner may change
  `policy`.
- **save-project** diffs the stored document against the incoming one, matching
  entities by id, and refuses anything beyond the caller's level
  (`functions/_shared/enforce.ts`):

  | Level | May change |
  |---|---|
  | VIEW | nothing |
  | FINISHES | material ids on walls, rooms and the roof; product swaps (`componentId`) on openings and placed items; project name and unit system |
  | LAYOUT | everything the rules engine allows at LAYOUT: interior walls, rooms (shape, height, name), openings, furniture positions. Not allowed: exterior or locked walls, openings on locked walls, or a corner attached to a protected wall leaving it. A corner part-way along that wall may slide along it. |
  | FULL | everything else: envelope, roof shape, floors, currency, contingency, unknown fields |
  | OWNER | `policy` |

  At any level, a save is refused if it would add a rule **ERROR** the plan
  didn't already have (`validatePlan` before vs after). WARNINGs are allowed.
  If `policy.requireReview` is set, geometry changes from anyone below the
  owner or a FULL member are refused with a request to submit a proposal.
  `proposals` is server-owned: a save keeps the stored list, whatever the
  client sends.
- **Concurrency.** `baseVersion` must equal the stored version or the call
  fails with `CONFLICT` and `currentVersion`. The compare-and-set, summary
  update and snapshot all happen in a single transaction (`public.commit_project`).
- **History.** Snapshots are taken with these reasons:
  - CREATE, PROPOSAL_ACCEPTED and RESTORE each add a new snapshot.
  - SAVE snapshots are **coalesced**. A save by the same author within 10
    minutes of the creation of the latest snapshot, when that snapshot is the
    same author's SAVE, updates it in place. One history entry therefore covers
    at most 10 minutes of one person's autosaves.
  - Submitting or rejecting a proposal bumps the version without a snapshot.
  - Only the latest 50 snapshots per project are kept.
  - Restoring writes the old document as a new version. It keeps the current
    `proposals` and `policy`.
- **Invites.** If the email belongs to a confirmed account, that person becomes
  a member immediately. The invite is recorded as accepted and `member` is
  returned. Otherwise a pending invite is stored for 14 days, and if no account
  exists Supabase's own invite email is sent (`auth.admin.inviteUserByEmail`).
  Locally that email lands in Mailpit. The invitee signs in, sees the invite in
  `my_invites`, and calls `accept-invite`, which requires their confirmed email
  to match.
- **Share links.** Each token is 256 random bits in base64url. Links are capped
  at FINISHES, and only the owner can create, read or revoke them.
  `open-share-link` works signed out. With `join: true`, a signed-in user is
  recorded as a member at the link's role (a link never lowers an existing
  role). Unknown, revoked and expired links all return `NOT_FOUND`.
- **Errors** use the `CloudError` JSON body with a matching HTTP status: 401,
  403, 404, 409, 400 or 500. Projects you can't access return `NOT_FOUND`, so
  ids can't be probed.

### Shared code in Deno

The functions run the real `shared/rules.ts`, `shared/cost.ts` and catalog.
Deno can't resolve the NodeNext-style `./types.js` specifiers in `shared/`,
and deploy bundling only reliably includes files under `supabase/functions/`.
For both reasons, `npm run sb:sync` copies these files into
`supabase/functions/_shared/domain/` and changes only the following:

- It rewrites `./x.js` imports to `./x.ts`.
- It wraps `catalog.seed.json` as `catalog.ts`.

The copies are committed. Run `npm run sb:check` to fail on drift.
`sb:test`, `sb:e2e` and `sb:deploy` run that check, and `sb:functions` re-syncs.
**After editing anything in `shared/`, run `npm run sb:sync`.**

## Local development

Docker must be running. The first start downloads about 1–2 GB of images.

```sh
npm install
npm run sb:start      # db, auth, PostgREST, Kong, edge runtime, Mailpit (studio etc. excluded)
npm run sb:status     # URLs and keys
npm run sb:test       # pgTAP RLS tests
npm run sb:e2e        # full scenario against the running stack
npm run sb:functions  # foreground function server with logs + hot reload (optional; start already serves them)
npm run sb:reset      # re-apply migrations to an empty database
npm run sb:stop
```

| What | Local value |
|---|---|
| API URL (`VITE_SUPABASE_URL`) | `http://127.0.0.1:54321` |
| Anon key (`VITE_SUPABASE_ANON_KEY`) | `ANON_KEY` from `npm run sb:status` (the standard local demo key) |
| Mailpit (magic-link emails) | `http://127.0.0.1:54324` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

Auth redirects allow `http://localhost:5183/**`, `http://127.0.0.1:5183/**` and
`https://salimkt.github.io/3xdezine/**`. Email confirmation is **on**: invites
are matched by email, so an unconfirmed address must not be able to claim one.
Magic-link sign-in confirms the address on its own.

## Going live: checklist

1. [ ] Create a free project at <https://supabase.com/dashboard>. Note the
       **project ref** (the subdomain of `https://<ref>.supabase.co`) and the
       database password.
2. [ ] Log in and link the repo:
       ```sh
       npx supabase login
       npx supabase link --project-ref <ref>
       ```
3. [ ] Push the schema: `npx supabase db push`.
4. [ ] Deploy the functions:
       ```sh
       npm run sb:check
       npx supabase functions deploy
       ```
       This deploys every function under `supabase/functions/`. `verify_jwt = false` comes from
       `config.toml`, because the functions authenticate callers themselves and
       `open-share-link` must work signed out.
5. [ ] Set the function secrets. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
       `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically, so
       don't set them yourself.
       ```sh
       npx supabase secrets set APP_URL=https://salimkt.github.io/3xdezine/
       # optional, comma-separated, for extra web origins (e.g. a custom domain):
       # npx supabase secrets set EXTRA_CORS_ORIGINS=https://3xdezine.example
       ```
6. [ ] Auth settings in the dashboard (Authentication → URL Configuration):
       - **Site URL**: `https://salimkt.github.io/3xdezine/`
       - **Redirect URLs**: `https://salimkt.github.io/3xdezine/**`, plus
         `http://localhost:5183/**` if you want local dev against production.
       - Authentication → Providers → Email: keep **Email** enabled and
         **Confirm email** on.
7. [ ] Email delivery. Supabase's built-in mailer is heavily rate-limited (a few
       emails per hour) and meant for testing. For real users, set up custom
       SMTP under Authentication → Emails → SMTP Settings (Resend, Postmark,
       SES, …).
8. [ ] Web build values. Both are **public** and go in GitHub → Settings →
       Secrets and variables → Actions → **Variables**, not Secrets:
       - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
       - `VITE_SUPABASE_ANON_KEY` = Project Settings → API Keys → `anon` (legacy) key, or the publishable key

       Expose them to the build step in `.github/workflows/deploy-pages.yml`:
       ```yaml
       env:
         VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
         VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
       ```
9. [ ] The **service-role / secret key never leaves Supabase.** Don't put it in
       GitHub, in `web/`, or anywhere a browser can reach. The Edge Functions
       already receive it from the platform.
10. [ ] Smoke test: sign in on the deployed site with a magic link, create a
        project, share it with a second address, and open a VIEW share link in a
        private window.

### Enabling Google sign-in

1. In Google Cloud Console, go to APIs & Services → Credentials. Create an
   **OAuth client ID** of type "Web application".
   - Authorised JavaScript origins: `https://salimkt.github.io` (add
     `http://localhost:5183` for local).
   - Authorised redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
     (local: `http://127.0.0.1:54321/auth/v1/callback`).
   - Configure the OAuth consent screen with the app name and support email.
2. **Production:** in the Supabase dashboard, go to Authentication → Providers →
   Google. Enable it and paste the client ID and secret.
3. **Local:** put the credentials in `supabase/.env` (gitignored):
   ```
   SUPABASE_AUTH_GOOGLE_CLIENT_ID=...
   SUPABASE_AUTH_GOOGLE_SECRET=...
   ```
   Set `[auth.external.google] enabled = true` in `supabase/config.toml`, then
   run `npm run sb:stop && npm run sb:start`.
4. Turn on the Google button in the web app with `VITE_SUPABASE_GOOGLE=1`.
   It is another public GitHub Actions variable.
