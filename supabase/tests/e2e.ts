/**
 * End-to-end test of the 3xDezine cloud backend against the RUNNING local
 * stack (`npm run sb:start`). Run with `npm run sb:e2e`.
 *
 * Sign-in is the real magic-link path: the script asks Auth for a magic link
 * (POST /auth/v1/otp), pulls the email out of Mailpit's API, follows the
 * /auth/v1/verify link without following its redirect, and reads the session
 * from the redirect's URL fragment — exactly what a browser does.
 *
 * Uses plain fetch (no supabase-js) so it needs no extra dependencies.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '../../shared/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Config from `supabase status`
// ---------------------------------------------------------------------------

function status(): Record<string, string> {
  const out = execSync('npx supabase status -o json', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out.slice(out.indexOf('{')));
}
const st = status();
const API = process.env.SUPABASE_URL ?? st.API_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? st.ANON_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? st.MAILPIT_URL ?? st.INBUCKET_URL;

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface Session { email: string; token: string; userId: string }

async function call(fn: string, body: unknown, session?: Session): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${session?.token ?? ANON}`,
      Origin: 'http://localhost:5183',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function rest(path: string, session: Session, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function latestMail(email: string, after: number): Promise<{ ID: string; Subject: string } | undefined> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const body = (await res.json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const fresh = body.messages.filter((m) => new Date(m.Created).getTime() >= after - 2000);
    if (fresh.length) return fresh[0];
    await sleep(250);
  }
  return undefined;
}

/** Magic-link sign-in (signs up on first use), via Mailpit. */
async function signInWithMagicLink(email: string): Promise<Session> {
  const started = Date.now();
  const otp = await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!otp.ok) throw new Error(`otp request failed: ${otp.status} ${await otp.text()}`);

  const mail = await latestMail(email, started);
  if (!mail) throw new Error(`no email for ${email} in Mailpit`);
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { HTML: string; Text: string };
  const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${msg.HTML}\n${msg.Text}`)?.[0];
  if (!link) throw new Error(`no magic link in "${mail.Subject}"`);

  const verify = await fetch(link.replace(/&amp;/g, '&'), { redirect: 'manual' });
  const location = verify.headers.get('location') ?? '';
  const fragment = new URLSearchParams(location.split('#')[1] ?? '');
  const token = fragment.get('access_token');
  if (!token) throw new Error(`verify did not return a session (status ${verify.status}, location ${location.slice(0, 120)})`);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { email, token, userId: payload.sub };
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

const sample = (): Project => JSON.parse(readFileSync(join(root, 'shared/sample-project.json'), 'utf8'));
const clone = <T>(v: T): T => structuredClone(v);
const floor0 = (p: Project) => p.floors[0];
const wall = (p: Project, id: string) => floor0(p).walls.find((w) => w.id === id)!;
const room = (p: Project, id: string) => floor0(p).rooms.find((r) => r.id === id)!;

/** Moves interior wall int-3 (x = 5.5) to x, with the rooms that share it. */
function moveInt3(p: Project, x: number): Project {
  const n = clone(p);
  const w = wall(n, 'int-3');
  w.start.x = x;
  w.end.x = x;
  for (const r of floor0(n).rooms) for (const v of r.polygon) if (Math.abs(v.x - 5.5) < 1e-6 && v.z >= 5) v.x = x;
  return n;
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

async function main() {
  console.log(`3xDezine cloud e2e against ${API} (mail: ${MAILPIT})\n`);
  const run = Date.now().toString(36);

  // 1. Sign up three people by magic link.
  const A = await signInWithMagicLink(`anita.owner-${run}@3xdezine.test`);
  const B = await signInWithMagicLink(`bala.collab-${run}@3xdezine.test`);
  const C = await signInWithMagicLink(`chitra.stranger-${run}@3xdezine.test`);
  check('Magic-link sign-up via Mailpit (3 users)', Boolean(A.token && B.token && C.token));

  const profB = await rest(`profiles?id=eq.${B.userId}&select=display_name,avatar_color`, B);
  const bName: string = profB.json?.[0]?.display_name;
  check('Profile auto-created with name from email', /^Bala Collab /.test(bName ?? ''), `${bName}, ${profB.json?.[0]?.avatar_color}`);

  // 2. A creates a project.
  const created = await call('create-project', { name: 'Maple Street (e2e)', data: sample() }, A);
  const projectId: string = created.json?.project?.id;
  check('A creates a project (version 1, summary computed)', created.status === 200 && created.json.project.version === 1 && created.json.project.rooms === 5 && created.json.project.bufferedTotal > 0,
    `rooms ${created.json?.project?.rooms}, total ${created.json?.project?.bufferedTotal} ${created.json?.project?.currency}`);

  // 3. Invites.
  const inv = await call('invite-member', { projectId, email: B.email.toUpperCase(), role: 'FINISHES' }, A);
  check('A invites B at FINISHES — existing account added at once', inv.status === 200 && inv.json.member?.role === 'FINISHES' && Boolean(inv.json.invite?.acceptedAt) && inv.json.member?.email === B.email,
    `member ${inv.json?.member?.displayName}`);

  const dEmail = `dev.newcomer-${run}@3xdezine.test`;
  const t0 = Date.now();
  const invD = await call('invite-member', { projectId, email: dEmail, role: 'VIEW' }, A);
  const dMail = await latestMail(dEmail, t0);
  check('Inviting an unknown email stores a pending invite + sends invite email', invD.status === 200 && !invD.json.member && !invD.json.invite?.acceptedAt && Boolean(dMail),
    dMail ? `Mailpit: "${dMail.Subject}"` : 'no email captured');

  const strangerInvite = await call('invite-member', { projectId, email: C.email, role: 'FULL' }, B);
  check('A member who is not the owner cannot invite', strangerInvite.status === 403 && strangerInvite.json.code === 'FORBIDDEN');

  // 4. Reads under RLS.
  const bRead = await rest(`projects?id=eq.${projectId}&select=id,version`, B);
  const cRead = await rest(`projects?id=eq.${projectId}&select=id`, C);
  check('RLS: member B can read the project, stranger C cannot', bRead.json?.length === 1 && Array.isArray(cRead.json) && cRead.json.length === 0);

  const bPatch = await rest(`projects?id=eq.${projectId}`, B, { method: 'PATCH', body: JSON.stringify({ name: 'hijacked' }) });
  check('RLS: B cannot update the projects table directly', bPatch.status >= 400 || (Array.isArray(bPatch.json) && bPatch.json.length === 0), `HTTP ${bPatch.status}`);

  const cSave = await call('save-project', { projectId, data: sample(), baseVersion: 1 }, C);
  check('Stranger C saving gets NOT_FOUND', cSave.status === 404 && cSave.json.code === 'NOT_FOUND');

  // 5. FINISHES enforcement.
  const stored = (await rest(`projects?id=eq.${projectId}&select=data,version`, B)).json[0];
  const moved = await call('save-project', { projectId, data: moveInt3(stored.data, 5.2), baseVersion: stored.version }, B);
  check('B (FINISHES) moving a wall → FORBIDDEN with violations', moved.status === 403 && moved.json.code === 'FORBIDDEN' && moved.json.violations?.length > 0,
    moved.json?.message);

  const fin = clone(stored.data) as Project;
  room(fin, 'room-bedroom').floorMaterialId = 'carpet-loop-beige';
  const finSave = await call('save-project', { projectId, data: fin, baseVersion: stored.version }, B);
  check('B (FINISHES) changing a floor material → saved', finSave.status === 200 && finSave.json.version === 2, `version ${finSave.json?.version}, total ${finSave.json?.summary?.bufferedTotal}`);

  // 6. Optimistic concurrency.
  const stale = await call('save-project', { projectId, data: sample(), baseVersion: 1 }, A);
  check('Stale baseVersion → CONFLICT with currentVersion', stale.status === 409 && stale.json.code === 'CONFLICT' && stale.json.currentVersion === 2);

  // 7. Proposal by B, accepted by A.
  const prop = await call('submit-proposal', {
    projectId,
    baseVersion: 2,
    note: 'Bigger bathroom',
    author: 'Mallory (spoofed)',
    edits: [
      { kind: 'MOVE_CORNER', from: { x: 5.5, z: 8 }, to: { x: 5.2, z: 8 } },
      { kind: 'MOVE_CORNER', from: { x: 5.5, z: 5 }, to: { x: 5.2, z: 5 } },
    ],
  }, B);
  check('B submits a proposal; author is B’s profile name, not the client’s', prop.status === 200 && prop.json.proposal.author === bName && prop.json.version === 3,
    `author "${prop.json?.proposal?.author}", costDelta ${prop.json?.proposal?.costDelta}`);

  const bReview = await call('review-proposal', { projectId, proposalId: prop.json.proposal.id, decision: 'ACCEPT', baseVersion: 3 }, B);
  check('B cannot review proposals (FINISHES)', bReview.status === 403);

  const accept = await call('review-proposal', { projectId, proposalId: prop.json.proposal.id, decision: 'ACCEPT', baseVersion: 3 }, A);
  const acceptedWall = accept.json?.data ? wall(accept.json.data, 'int-3') : undefined;
  check('A accepts the proposal → edits applied, version 4', accept.status === 200 && accept.json.version === 4 && acceptedWall?.start.x === 5.2 &&
    accept.json.data.proposals?.[0]?.status === 'ACCEPTED');

  const versions = await rest(`project_versions?project_id=eq.${projectId}&select=id,version,reason,author_id&order=created_at.asc`, A);
  const reasons = (versions.json as { reason: string }[]).map((v) => v.reason);
  check('Version history: CREATE, SAVE, PROPOSAL_ACCEPTED snapshots', JSON.stringify(reasons) === JSON.stringify(['CREATE', 'SAVE', 'PROPOSAL_ACCEPTED']), reasons.join(' → '));

  const bVersions = await rest(`project_versions?project_id=eq.${projectId}&select=id`, B);
  check('Member B can read version history too', bVersions.json?.length === 3);

  // 8. Restore the original.
  const createVersion = (versions.json as { id: string; reason: string }[]).find((v) => v.reason === 'CREATE')!;
  const restored = await call('restore-version', { projectId, versionId: createVersion.id, baseVersion: 4 }, A);
  check('A restores the CREATE version → new version 5 with old geometry/finish, proposals kept',
    restored.status === 200 && restored.json.version === 5 && wall(restored.json.data, 'int-3').start.x === 5.5 &&
      room(restored.json.data, 'room-bedroom').floorMaterialId === 'oak-hardwood' && restored.json.data.proposals?.length === 1);

  // 9. LAYOUT enforcement.
  const promote = await call('set-member-role', { projectId, userId: B.userId, role: 'LAYOUT' }, A);
  check('A promotes B to LAYOUT', promote.status === 200 && promote.json.member.role === 'LAYOUT');
  let cur = restored.json.data as Project;
  let ver = 5;

  const ext = clone(cur);
  wall(ext, 'ext-n').start.z = -0.5;
  const extSave = await call('save-project', { projectId, data: ext, baseVersion: ver }, B);
  check('B (LAYOUT) moving an exterior wall → FORBIDDEN', extSave.status === 403, extSave.json?.message);

  const offEnvelope = clone(cur);
  wall(offEnvelope, 'int-3').end.z = 7.5;
  for (const v of room(offEnvelope, 'room-bedroom').polygon) if (v.x === 5.5 && v.z === 8) v.z = 7.5;
  for (const v of room(offEnvelope, 'room-bathroom').polygon) if (v.x === 5.5 && v.z === 8) v.z = 7.5;
  const offSave = await call('save-project', { projectId, data: offEnvelope, baseVersion: ver }, B);
  check('B (LAYOUT) pulling a corner off the envelope → FORBIDDEN', offSave.status === 403, offSave.json?.message);

  const slide = moveInt3(cur, 5.0);
  const slideSave = await call('save-project', { projectId, data: slide, baseVersion: ver }, B);
  check('B (LAYOUT) moving an interior wall (sliding along the envelope) → saved', slideSave.status === 200 && slideSave.json.version === 6, slideSave.json?.message ?? '');
  if (slideSave.status === 200) { cur = slide; ver = 6; }

  const countBefore = (await rest(`project_versions?project_id=eq.${projectId}&select=id`, A)).json.length;
  const again = clone(cur);
  room(again, 'room-hall').floorMaterialId = 'polished-concrete';
  const againSave = await call('save-project', { projectId, data: again, baseVersion: ver }, B);
  const afterAgain = (await rest(`project_versions?project_id=eq.${projectId}&select=id,version,reason&order=created_at.desc`, A)).json;
  check('Consecutive saves by the same author coalesce into one snapshot',
    againSave.status === 200 && afterAgain.length === countBefore && afterAgain[0].reason === 'SAVE' && afterAgain[0].version === againSave.json.version,
    `${afterAgain.length} snapshots, latest v${afterAgain[0]?.version}`);
  if (againSave.status === 200) { cur = again; ver = againSave.json.version; }

  const broken = clone(cur);
  floor0(broken).openings.find((o) => o.id === 'op-kitchen-pass')!.widthM = 7;
  const brokenSave = await call('save-project', { projectId, data: broken, baseVersion: ver }, B);
  check('A save that adds a rule ERROR → FORBIDDEN with the rules engine’s violations',
    brokenSave.status === 403 && brokenSave.json.violations?.some((v: any) => v.severity === 'ERROR' && !String(v.ruleId).startsWith('access.')),
    brokenSave.json?.violations?.[0]?.ruleId);

  const policyChange = clone(cur);
  policyChange.policy = { level: 'FULL', lockedWallIds: [], requireReview: false };
  const policySave = await call('save-project', { projectId, data: policyChange, baseVersion: ver }, B);
  check('Only the owner may change the policy', policySave.status === 403);

  // 10. Emails only visible to the owner.
  const asOwner = await rest(`project_member_profiles?project_id=eq.${projectId}&select=user_id,email,role`, A);
  const asMember = await rest(`project_member_profiles?project_id=eq.${projectId}&select=user_id,email,role`, B);
  check('project_member_profiles: owner sees emails, members do not',
    asOwner.json?.[0]?.email === B.email && asMember.json?.length === 1 && asMember.json[0].email === null);

  const mine = await rest(`my_projects?select=id,role,owner_name`, B);
  check('my_projects lists the project for B with role LAYOUT and owner name', mine.json?.some((p: any) => p.id === projectId && p.role === 'LAYOUT' && /^Anita Owner/.test(p.owner_name)));

  // 11. Share links.
  const bLink = await call('create-share-link', { projectId, role: 'VIEW' }, B);
  check('Only the owner can create share links', bLink.status === 403);

  const fullLink = await call('create-share-link', { projectId, role: 'FULL' }, A);
  check('Share links are capped at FINISHES', fullLink.status === 400);

  const link = await call('create-share-link', { projectId, role: 'VIEW', expiresInDays: 7 }, A);
  const token: string = link.json?.link?.token;
  check('A creates a VIEW share link (≥128-bit token)', link.status === 200 && token?.length >= 43, `${token?.length} chars`);

  const anon = await call('open-share-link', { token });
  check('Share link opens signed out at VIEW with the project', anon.status === 200 && anon.json.role === 'VIEW' && anon.json.project.role === 'VIEW' && anon.json.project.id === projectId && Boolean(anon.json.project.data?.floors));

  const anonJoin = await call('open-share-link', { token, join: true });
  check('Joining via a link needs sign-in', anonJoin.status === 401);

  const cJoin = await call('open-share-link', { token, join: true }, C);
  const cRead2 = await rest(`projects?id=eq.${projectId}&select=id`, C);
  const cSave2 = await call('save-project', { projectId, data: cur, baseVersion: ver }, C);
  check('C joins via the link as VIEW: can read, cannot save', cJoin.status === 200 && cRead2.json?.length === 1 && cSave2.status === 403);

  const cLinks = await rest(`share_links?project_id=eq.${projectId}&select=token`, C);
  check('Share-link tokens are not readable by non-owners', Array.isArray(cLinks.json) && cLinks.json.length === 0);

  const revoke = await call('revoke-share-link', { projectId, token }, A);
  const afterRevoke = await call('open-share-link', { token });
  check('Revoked link no longer opens', revoke.status === 200 && afterRevoke.status === 404 && afterRevoke.json.code === 'NOT_FOUND');

  // 12. Pending invite -> sign in -> my_invites -> accept-invite.
  const D = await signInWithMagicLink(dEmail);
  const dInvites = await rest(`my_invites?select=id,project_id,project_name,invited_by_name,role`, D);
  const dInvite = dInvites.json?.find((i: any) => i.project_id === projectId);
  check('Invitee sees the pending invite in my_invites (project + inviter names)', Boolean(dInvite) && dInvite.project_name === 'Maple Street (e2e)' && /^Anita Owner/.test(dInvite.invited_by_name), dInvite ? `${dInvite.project_name} from ${dInvite.invited_by_name}` : JSON.stringify(dInvites.json));
  const cInvites = await rest(`my_invites?select=id`, C);
  const cSteal = await call('accept-invite', { inviteId: dInvite?.id }, C);
  check('Someone else cannot see or accept that invite', cInvites.json?.length === 0 && cSteal.status === 404);
  const dAccept = await call('accept-invite', { inviteId: dInvite?.id }, D);
  const dRead = await rest(`projects?id=eq.${projectId}&select=id`, D);
  check('Invitee accepts → member at the invited role, can read', dAccept.status === 200 && dAccept.json.role === 'VIEW' && dRead.json?.length === 1);

  // 13. Leaving and deleting.
  const leave = await call('remove-member', { projectId, userId: C.userId }, C);
  check('A member can leave a project', leave.status === 200);
  const bDelete = await call('delete-project', { projectId }, B);
  check('Only the owner can delete', bDelete.status === 403);

  const del = await call('delete-project', { projectId }, A);
  const gone = await rest(`projects?id=eq.${projectId}&select=id`, A);
  check('Owner deletes the project', del.status === 200 && gone.json?.length === 0);
}

main()
  .catch((err) => check('Scenario ran to completion', false, String(err?.stack ?? err)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    const w = Math.max(...results.map((r) => r.name.length));
    console.log(`\n${'Check'.padEnd(w)}  Result`);
    console.log(`${'-'.repeat(w)}  ------`);
    for (const r of results) console.log(`${r.name.padEnd(w)}  ${r.ok ? 'PASS' : 'FAIL'}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED` : ''}.`);
    process.exit(failed.length ? 1 : 0);
  });
