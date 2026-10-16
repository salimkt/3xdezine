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
import { createHmac } from 'node:crypto';
import type { Project } from '../../shared/types.ts';
import type { QuotationDocument, RateCard, SaveQuoteDraftRequest } from '../../shared/business.ts';
import { autoLines } from '../../shared/trades.ts';
import { buildQuote, hashQuote, toQuoteLines } from '../../shared/quote.ts';
import { gstinCheckChar } from '../../shared/gst.ts';

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

// ---------------------------------------------------------------------------
// Business: studios, quotes, approvals, plans and billing
// ---------------------------------------------------------------------------

/** RAZORPAY_WEBHOOK_SECRET as the local functions see it (supabase/functions/.env). */
function webhookSecret(): string {
  if (process.env.RAZORPAY_WEBHOOK_SECRET) return process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    const env = readFileSync(join(root, 'supabase/functions/.env'), 'utf8');
    return /^RAZORPAY_WEBHOOK_SECRET=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

async function webhook(body: string, signature: string, eventId: string): Promise<{ status: number; json: any }> {
  // Exactly what Razorpay sends: no apikey, no Authorization.
  const res = await fetch(`${API}/functions/v1/razorpay-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

const rateCard = (): RateCard => JSON.parse(readFileSync(join(root, 'shared/ratecards/metro-mid-2026.json'), 'utf8'));
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
// 1×1 transparent PNG.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const MH = { line1: '12 Lane 5, Koregaon Park', city: 'Pune', pin: '411001', stateName: 'Maharashtra', stateCode: '27' };
const KA = { line1: '4 Church Street', city: 'Bengaluru', pin: '560001', stateName: 'Karnataka', stateCode: '29' };

function studioBody(over: Record<string, unknown> = {}) {
  return {
    legalName: 'Sharma Studio LLP',
    tradeName: 'Sharma Studio',
    address: MH,
    gstin: gstin('27AAPFU0939F1Z'),
    pan: 'AAPFU0939F',
    phone: '+91 98200 00000',
    email: 'hello@sharma.test',
    gstRegistration: 'REGULAR',
    turnoverAbove5Cr: false,
    logoDataUrl: TINY_PNG,
    brandColorHex: '#2F8A84',
    bank: { accountName: 'Sharma Studio LLP', accountNo: '50100012345678', ifsc: 'HDFC0001234', upiId: 'sharma@hdfcbank' },
    defaultTerms: ['50% advance'],
    defaultMilestones: [{ label: 'Booking', pct: 50 }, { label: 'Handover', pct: 50 }],
    numberPrefix: 'SS',
    ...over,
  };
}

function draftInput(project: Project, over: Partial<SaveQuoteDraftRequest['input']> = {}): SaveQuoteDraftRequest['input'] {
  return {
    recipient: { legalName: 'Ravi Kumar', address: MH, phone: '+91 99000 11111' },
    siteAddress: MH,
    lines: toQuoteLines(autoLines(project, rateCard())),
    view: 'ROOM_WISE',
    milestones: [
      { label: 'Booking', pct: 10, trigger: 'ON_SIGNING' },
      { label: 'Design sign-off', pct: 40, trigger: 'ON_APPROVAL' },
      { label: 'Handover', pct: 50, trigger: 'ON_HANDOVER' },
    ],
    makeList: [{ category: 'Board', brands: ['Century', 'Greenply'] }],
    inclusions: ['Site cleaning after work'],
    exclusions: ['Civil work not listed', 'Appliances'],
    terms: ['Valid for 15 days'],
    docType: 'QUOTATION',
    issueDate: new Date().toISOString().slice(0, 10),
    validityDays: 15,
    ...over,
  };
}

const NUM = (letters: string, seq: number) => new RegExp(`^SS/${letters}/\\d{2}-\\d{2}/${String(seq).padStart(4, '0')}$`);

async function business() {
  console.log('\n— Business: studios, quotes, approvals, plans, billing —\n');
  const run = `${Date.now().toString(36)}b`;
  const F = await signInWithMagicLink(`farah.designer-${run}@3xdezine.test`);
  const H = await signInWithMagicLink(`hari.stranger-${run}@3xdezine.test`);
  const secret = webhookSecret();

  // Studio profile validation.
  const badCheck = await call('save-studio', { studio: studioBody({ gstin: '27AAPFU0939F1ZA' === gstin('27AAPFU0939F1Z') ? '27AAPFU0939F1ZB' : '27AAPFU0939F1ZA' }) }, F);
  const badState = await call('save-studio', { studio: studioBody({ address: KA }) }, F);
  const bigLogo = await call('save-studio', { studio: studioBody({ logoDataUrl: `data:image/png;base64,${Buffer.alloc(70 * 1024, 1).toString('base64')}` }) }, F);
  check('save-studio: bad GSTIN checksum, GSTIN/address state mismatch and >64 KB logo are refused',
    badCheck.status === 400 && badState.status === 400 && /state/i.test(badState.json?.message) && bigLogo.status === 400,
    `${badCheck.json?.message} | ${badState.json?.message} | ${bigLogo.json?.message}`);
  const studio = await call('save-studio', { studio: studioBody() }, F);
  const studioId: string = studio.json?.studio?.id;
  check('save-studio creates the personal studio lazily', studio.status === 200 && Boolean(studioId) && studio.json.studio.gstin === gstin('27AAPFU0939F1Z'));

  const ent0 = await call('get-entitlements', {}, F);
  check('get-entitlements: a new account is FREE with 2 projects and quotations only',
    ent0.status === 200 && ent0.json.entitlements.plan === 'FREE' && ent0.json.entitlements.maxActiveProjects === 2 &&
      JSON.stringify(ent0.json.entitlements.docTypes) === '["QUOTATION"]');

  // Project limit.
  const p1 = await call('create-project', { name: 'Koregaon flat (e2e)', data: sample() }, F);
  const p2 = await call('create-project', { name: 'Baner villa (e2e)', data: sample() }, F);
  const p3 = await call('create-project', { name: 'Third (e2e)', data: sample() }, F);
  const P1: string = p1.json?.project?.id;
  const P2: string = p2.json?.project?.id;
  check('Free user hits the 2-project limit (FORBIDDEN, names the plan)',
    p1.status === 200 && p2.status === 200 && p3.status === 403 && p3.json.code === 'FORBIDDEN' && /Free/.test(p3.json.message) && /Solo/.test(p3.json.message),
    p3.json?.message);
  const p1Row = (await rest(`projects?id=eq.${P1}&select=studio_id,data`, F)).json?.[0];
  check('New projects quote as the owner’s studio', p1Row?.studio_id === studioId);
  const stored: Project = p1Row.data;

  const freeRates = await call('save-rate-overrides', { studioId, overrides: { baseCardId: 'metro-mid-2026', overrides: {}, added: [], disabled: [] } }, F);
  check('Free plan cannot save rate-card overrides', freeRates.status === 403, freeRates.json?.message);

  // Draft: the server recomputes every amount and total, so forged arithmetic is
  // ignored — but a rate the designer set is THEIR price and is honoured on every
  // plan. (Free gates saved rate cards, never the user's own prices.)
  const honest = draftInput(stored);
  const tampered = structuredClone(honest);
  const t0 = tampered.lines[0] as any;
  t0.amount = 1;                       // forged arithmetic
  (tampered as any).grandTotal = 100;  // forged arithmetic
  t0.materialRate = 1;                 // a genuine edit: the designer's own rate
  const d1 = await call('save-quote-draft', { projectId: P1, input: tampered }, F);
  const q1: QuotationDocument = d1.json?.quote;
  const studioSnap = { ...studio.json.studio };
  const expected = buildQuote({ ...tampered, project: stored, rateCard: rateCard(), studio: studioSnap, watermark: true });
  const atDefault = buildQuote({ ...honest, project: stored, rateCard: rateCard(), studio: studioSnap, watermark: true });
  const savedLine = q1?.sections.flatMap((x) => x.lines).find((l) => l.id === t0.id) as any;
  check('save-quote-draft: server recomputes amounts and totals (forged line amount and grand total ignored)',
    d1.status === 200 && q1.status === 'DRAFT' && q1.grandTotal === expected.grandTotal && q1.grandTotal > 100 && q1.watermark === true,
    `server ₹${(q1?.grandTotal ?? 0) / 100} vs engine ₹${expected.grandTotal / 100}`);
  check('save-quote-draft: a Free user’s own line rate is honoured, not reset to the default card',
    savedLine?.materialRate === 1 && q1.grandTotal < atDefault.grandTotal,
    `line rate ${savedLine?.materialRate}; total ₹${(q1?.grandTotal ?? 0) / 100} vs default-card ₹${atDefault.grandTotal / 100}`);

  const iss1 = await call('issue-quote', { quoteId: q1.id }, F);
  const Q1: QuotationDocument = iss1.json?.quote;
  const tok1: string = iss1.json?.shareToken;
  check('Free user issues a watermarked QUOTATION (number, hash, no logo, share path)',
    iss1.status === 200 && Q1.status === 'ISSUED' && NUM('Q', 1).test(Q1.number ?? '') && Q1.watermark === true &&
      /^[0-9a-f]{64}$/.test(Q1.hash ?? '') && !Q1.supplier.logoDataUrl && iss1.json.shareUrlPath === `#/q/${tok1}` && tok1.length >= 43,
    `${Q1?.number}, watermark ${Q1?.watermark}`);
  check('The stored hash is the shared engine’s hashQuote of the document', (await hashQuote(Q1)) === Q1.hash);

  const reissue = await call('issue-quote', { quoteId: q1.id }, F);
  check('An issued quote cannot be issued again', reissue.status === 400);

  const tiDraft = await call('save-quote-draft', { projectId: P1, input: draftInput(stored, { docType: 'TAX_INVOICE' }) }, F);
  const tiIssue = await call('issue-quote', { quoteId: tiDraft.json?.quote?.id }, F);
  check('Free user cannot issue a TAX_INVOICE (FORBIDDEN, names the plan)', tiDraft.status === 200 && tiIssue.status === 403 && /Free/.test(tiIssue.json?.message), tiIssue.json?.message);

  // The client: signed out.
  const open1 = await call('open-quote', { token: tok1 });
  check('Client opens the link signed out: quote, plan and studio name only',
    open1.status === 200 && open1.json.quote.hash === Q1.hash && Array.isArray(open1.json.project?.floors) && open1.json.project.proposals === undefined &&
      open1.json.studioName === 'Sharma Studio' && JSON.stringify(Object.keys(open1.json).sort()) === '["ok","project","quote","studioName"]');
  const bogus = await call('open-quote', { token: 'x'.repeat(43) });
  check('Unknown quote token → NOT_FOUND', bogus.status === 404 && bogus.json.code === 'NOT_FOUND');

  const stale = await call('respond-to-quote', { token: tok1, decision: 'APPROVED', byName: 'Ravi Kumar', byContact: '+91 99000 11111', documentHash: 'f'.repeat(64) });
  check('A response pinned to a stale hash is refused (CONFLICT)', stale.status === 409 && stale.json.code === 'CONFLICT', stale.json?.message);

  // Revision supersedes.
  const rev = await call('save-quote-draft', { projectId: P1, quoteId: Q1.id, input: draftInput(stored, { exclusions: ['Civil work not listed', 'Appliances', 'Loose furniture'] }) }, F);
  const iss2 = await call('issue-quote', { quoteId: rev.json?.quote?.id }, F);
  const Q2: QuotationDocument = iss2.json?.quote;
  const tok2: string = iss2.json?.shareToken;
  const oldOpen = await call('open-quote', { token: tok1 });
  const oldResp = await call('respond-to-quote', { token: tok1, decision: 'APPROVED', byName: 'Ravi', byContact: 'ravi@x.test', documentHash: Q1.hash });
  check('A revision is a new version that supersedes the old one (old link shows SUPERSEDED, refuses responses)',
    rev.status === 200 && rev.json.quote.version === 2 && rev.json.quote.supersedesId === Q1.id && iss2.status === 200 && NUM('Q', 2).test(Q2.number ?? '') &&
      oldOpen.json?.quote?.status === 'SUPERSEDED' && oldResp.status === 409,
    `${Q2?.number}; old status ${oldOpen.json?.quote?.status}`);

  const approve = await call('respond-to-quote', { token: tok2, decision: 'APPROVED', byName: 'Ravi Kumar', byContact: '+91 99000 11111', comment: 'Go ahead', documentHash: Q2.hash });
  const A2: QuotationDocument = approve.json?.quote;
  check('Client approves with the right hash → APPROVED, locked, approval recorded',
    approve.status === 200 && A2.status === 'APPROVED' && Boolean(A2.lockedAt) && A2.approvals?.[0]?.byName === 'Ravi Kumar' && A2.approvals[0].documentHash === Q2.hash);
  check('Approval does not change the document hash', (await hashQuote(A2)) === Q2.hash);
  const again = await call('respond-to-quote', { token: tok2, decision: 'CHANGES_REQUESTED', byName: 'Ravi', byContact: 'ravi@x.test', comment: 'wait', documentHash: Q2.hash });
  const editApproved = await call('save-quote-draft', { projectId: P1, quoteId: Q2.id, input: draftInput(stored) }, F);
  check('Approval locks it: no second response, no revision', again.status === 409 && editApproved.status === 403, editApproved.json?.message);
  const evidence = await rest(`quote_responses?quote_id=eq.${Q2.id}&select=decision,by_name,document_hash,user_agent`, F);
  const hEvidence = await rest(`quote_responses?quote_id=eq.${Q2.id}&select=id`, H);
  check('Evidence row readable by the designer, not by a stranger',
    evidence.json?.length === 1 && evidence.json[0].document_hash === Q2.hash && Boolean(evidence.json[0].user_agent) && hEvidence.json?.length === 0);
  const patchEvidence = await rest(`quote_responses?quote_id=eq.${Q2.id}`, F, { method: 'PATCH', body: JSON.stringify({ by_name: 'forged' }) });
  check('Evidence cannot be edited through the API', patchEvidence.status >= 400, `HTTP ${patchEvidence.status}`);

  const voFree = await call('create-variation-order', { approvedQuoteId: Q2.id, input: draftInput(stored) }, F);
  check('Free plan cannot create variation orders', voFree.status === 403, voFree.json?.message);

  // Project Pass (simulated): unlocks branding for that project only.
  const pass = await call('create-checkout', { plan: 'PROJECT_PASS', interval: 'ONE_TIME', projectId: P1 }, F);
  const beforePass = await call('get-entitlements', {}, F);
  const done = await call('create-checkout', { simulateSuccess: true, orderId: pass.json?.orderId }, F);
  const afterPass = await call('get-entitlements', {}, F);
  check('Simulated Project Pass: checkout grants nothing until completed, then lists the project',
    pass.status === 200 && pass.json.simulated === true && pass.json.amount === 49_900 && /^order_sim_/.test(pass.json.orderId) &&
      beforePass.json.entitlements.passProjectIds.length === 0 && done.status === 200 && afterPass.json.entitlements.passProjectIds.includes(P1) &&
      !afterPass.json.entitlements.passProjectIds.includes(P2));
  const pp1 = await call('save-quote-draft', { projectId: P1, input: draftInput(stored) }, F);
  const ppIss1 = await call('issue-quote', { quoteId: pp1.json?.quote?.id }, F);
  const pp2 = await call('save-quote-draft', { projectId: P2, input: draftInput(stored) }, F);
  const ppIss2 = await call('issue-quote', { quoteId: pp2.json?.quote?.id }, F);
  check('Project Pass: branded on that project, still watermarked on the other',
    ppIss1.json?.quote?.watermark === false && ppIss1.json.quote.supplier.logoDataUrl === TINY_PNG && ppIss2.json?.quote?.watermark === true && !ppIss2.json.quote.supplier.logoDataUrl,
    `P1 watermark ${ppIss1.json?.quote?.watermark}, P2 watermark ${ppIss2.json?.quote?.watermark}`);

  // Webhook: signature and idempotency.
  const order2 = await call('create-checkout', { plan: 'PROJECT_PASS', interval: 'ONE_TIME', projectId: P2 }, F);
  const payId = `pay_e2e_${run}`;
  const evtBody = JSON.stringify({
    entity: 'event', account_id: 'acc_e2e', event: 'payment.captured', contains: ['payment'],
    payload: { payment: { entity: { id: payId, entity: 'payment', amount: 49_900, currency: 'INR', status: 'captured', order_id: order2.json?.orderId, method: 'upi' } } },
    created_at: Math.floor(Date.now() / 1000),
  });
  const evtId = `evt_e2e_${run}`;
  const wh1 = await webhook(evtBody, sign(evtBody, secret), evtId);
  const wh2 = await webhook(evtBody, sign(evtBody, secret), evtId);
  const pays = await rest(`payments?razorpay_payment_id=eq.${payId}&select=id,amount`, F);
  const passes = await rest(`project_passes?project_id=eq.${P2}&select=id`, F);
  check('Webhook: a correctly signed payment.captured is accepted once; the replay is a no-op',
    wh1.status === 200 && wh1.json.handled === true && wh2.status === 200 && wh2.json.duplicate === true && pays.json?.length === 1 && passes.json?.length === 1,
    `first ${wh1.status} ${wh1.json?.note}, replay duplicate=${wh2.json?.duplicate}, ${pays.json?.length} payment row(s)`);
  const bad = await webhook(evtBody.replace('49900', '1'), sign(evtBody, secret), `evt_bad_${run}`);
  const unsigned = await webhook(evtBody, '', `evt_unsigned_${run}`);
  check('Webhook: a bad or missing signature is rejected (401)', bad.status === 401 && unsigned.status === 401);

  // Solo (simulated subscription).
  const solo = await call('create-checkout', { plan: 'SOLO', interval: 'MONTH', simulateSuccess: true }, F);
  const entSolo = await call('get-entitlements', {}, F);
  const p3b = await call('create-project', { name: 'Third, on Solo (e2e)', data: sample() }, F);
  const P3: string = p3b.json?.project?.id;
  check('Simulated Solo subscription lifts the project limit',
    solo.status === 200 && /^sub_sim_/.test(solo.json.subscriptionId) && entSolo.json.entitlements.plan === 'SOLO' &&
      entSolo.json.entitlements.maxActiveProjects === null && Boolean(entSolo.json.entitlements.currentPeriodEnd) && p3b.status === 200);

  const tiMH = await call('save-quote-draft', { projectId: P1, input: draftInput(stored, { docType: 'TAX_INVOICE', siteAddress: MH }) }, F);
  const tiMHi = await call('issue-quote', { quoteId: tiMH.json?.quote?.id }, F);
  const tiKA = await call('save-quote-draft', { projectId: P1, input: draftInput(stored, { docType: 'TAX_INVOICE', siteAddress: KA }) }, F);
  const tiKAi = await call('issue-quote', { quoteId: tiKA.json?.quote?.id }, F);
  const mh: QuotationDocument = tiMHi.json?.quote;
  const ka: QuotationDocument = tiKAi.json?.quote;
  const sum = (d: QuotationDocument, k: 'cgst' | 'sgst' | 'igst') => (d?.taxLines ?? []).reduce((s, t) => s + t[k], 0);
  check('Solo issues TAX_INVOICEs: Maharashtra site → CGST+SGST, Karnataka site → IGST',
    tiMHi.status === 200 && tiKAi.status === 200 && !mh.isInterState && sum(mh, 'cgst') > 0 && Math.abs(sum(mh, 'cgst') - sum(mh, 'sgst')) <= mh.taxLines.length && sum(mh, 'igst') === 0 &&
      ka.isInterState && sum(ka, 'igst') > 0 && sum(ka, 'cgst') === 0 && ka.placeOfSupplyStateCode === '29' && mh.totalTax === sum(mh, 'cgst') + sum(mh, 'sgst') && sum(ka, 'igst') === mh.totalTax,
    `MH CGST ₹${sum(mh, 'cgst') / 100} + SGST ₹${sum(mh, 'sgst') / 100}; KA IGST ₹${sum(ka, 'igst') / 100}`);
  check('Tax invoices number in their own series', NUM('TI', 1).test(mh?.number ?? '') && NUM('TI', 2).test(ka?.number ?? ''), `${mh?.number}, ${ka?.number}`);

  // Concurrent issues.
  const drafts = await Promise.all([0, 1, 2, 3].map(() => call('save-quote-draft', { projectId: P3, input: draftInput(stored) }, F)));
  const issued = await Promise.all(drafts.map((d) => call('issue-quote', { quoteId: d.json?.quote?.id }, F)));
  const nums = issued.map((r) => r.json?.quote?.number as string).sort();
  const all = (await rest(`quotes?studio_id=eq.${studioId}&doc_type=eq.QUOTATION&number=not.is.null&select=number&order=number.asc`, F)).json.map((r: any) => r.number);
  const seqs = all.map((n: string) => Number(n.split('/').pop()));
  check('Four parallel issues get distinct numbers; the QUOTATION series is consecutive with no gaps',
    issued.every((r) => r.status === 200) && new Set(nums).size === 4 && seqs.every((s: number, i: number) => s === i + 1),
    `${all.join(', ')}`);

  // Variation order (Solo).
  const voInput = draftInput(stored);
  (voInput.lines[0] as any).quantityDisplay = 999;
  voInput.lines = voInput.lines.filter((_, i) => i !== 1);
  const vo = await call('create-variation-order', { approvedQuoteId: Q2.id, input: voInput }, F);
  const voIss = await call('issue-quote', { quoteId: vo.json?.quote?.id }, F);
  const voBad = await call('create-variation-order', { approvedQuoteId: ppIss2.json?.quote?.id, input: voInput }, F);
  check('Variation order against the approved quote (diffQuotes summary), numbered VO; not against an unapproved quote',
    vo.status === 200 && vo.json.quote.docType === 'VARIATION_ORDER' && vo.json.quote.amendsId === Q2.id && vo.json.diff?.removed?.length === 1 &&
      voIss.status === 200 && NUM('VO', 1).test(voIss.json.quote.number) && voBad.status === 400,
    `diff: +${vo.json?.diff?.added?.length} -${vo.json?.diff?.removed?.length} ~${vo.json?.diff?.changed?.length}, Δ ₹${(vo.json?.diff?.totalDelta ?? 0) / 100}`);

  const voOpen = await call('open-quote', { token: voIss.json?.shareToken });
  check('The client’s variation-order link carries the change summary', voOpen.status === 200 && voOpen.json.diff?.removed?.length === 1 && voOpen.json.quote.amendsId === Q2.id);

  // Subscription renewal via webhook.
  const subBefore = (await rest(`subscriptions?razorpay_subscription_id=eq.${solo.json.subscriptionId}&select=current_period_end,status`, F)).json?.[0];
  const nextEnd = Math.floor(new Date(subBefore.current_period_end).getTime() / 1000) + 30 * 86400;
  const chargedBody = JSON.stringify({
    entity: 'event', account_id: 'acc_e2e', event: 'subscription.charged', contains: ['subscription', 'payment'],
    payload: {
      subscription: { entity: { id: solo.json.subscriptionId, entity: 'subscription', plan_id: 'plan_e2e', status: 'active', current_start: nextEnd - 30 * 86400, current_end: nextEnd, quantity: 1 } },
      payment: { entity: { id: `pay_renew_${run}`, entity: 'payment', amount: 79_900, currency: 'INR', status: 'captured', invoice_id: 'inv_e2e' } },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  const renew = await webhook(chargedBody, sign(chargedBody, secret), `evt_renew_${run}`);
  const subAfter = (await rest(`subscriptions?razorpay_subscription_id=eq.${solo.json.subscriptionId}&select=current_period_end,status`, F)).json?.[0];
  check('Webhook subscription.charged extends the paid period',
    renew.status === 200 && renew.json.handled === true && new Date(subAfter.current_period_end).getTime() === nextEnd * 1000 && subAfter.status === 'ACTIVE',
    `${subBefore.current_period_end} → ${subAfter.current_period_end}`);

  const soloRates = await call('save-rate-overrides', { studioId, overrides: { baseCardId: 'metro-mid-2026', overrides: { [rateCard().entries[0].id]: { labourRate: 12_345 } }, added: [], disabled: [] } }, F);
  const badRates = await call('save-rate-overrides', { studioId, overrides: { baseCardId: 'metro-mid-2026', overrides: { 'NOPE': { labourRate: 1 } }, added: [], disabled: [] } }, F);
  check('Solo saves rate-card overrides; unknown rate ids are refused', soloRates.status === 200 && badRates.status === 400);

  // Strangers.
  const hQuotes = await rest(`quotes?project_id=eq.${P1}&select=id`, H);
  const hDraft = await call('save-quote-draft', { projectId: P1, input: draftInput(stored) }, H);
  const hSubs = await rest(`subscriptions?select=id`, H);
  check('Strangers: no quotes, NOT_FOUND on the project, no billing rows', hQuotes.json?.length === 0 && hDraft.status === 404 && hSubs.json?.length === 0);

  // Issued tax invoices must be retained for 72 months (CGST Act s.36 / Rule 56).
  // P1 holds the two issued TIs from the Solo scenario, so it cannot be deleted.
  const del1 = await call('delete-project', { projectId: P1 }, F);
  const tiKept = await rest(`quotes?project_id=eq.${P1}&doc_type=eq.TAX_INVOICE&status=neq.DRAFT&select=id`, F);
  check('A project with issued tax invoices cannot be deleted (GST 72-month retention)',
    del1.status === 403 && /72 months/.test(del1.json?.message ?? '') && tiKept.json?.length === 2, del1.json?.message);

  // A quotations-only project can be deleted: its quotes and links go; payments stay.
  const p3Token: string = issued[0].json?.shareToken;
  const del3 = await call('delete-project', { projectId: P3 }, F);
  const goneLink = await call('open-quote', { token: p3Token });
  const keptEvidence = await rest(`payments?select=id`, F);
  check('Deleting a quotations-only project removes its quotes and links; the payments ledger is kept',
    del3.status === 200 && goneLink.status === 404 && keptEvidence.json?.length >= 3, `${keptEvidence.json?.length} payment rows`);
}

main()
  .then(business)
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
