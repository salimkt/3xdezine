import {
  createClient,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  CLOUD_FUNCTIONS,
  type AccessRole,
  type CloudError,
  type CloudProject,
  type CloudProjectSummary,
  type CreateProjectResponse,
  type CreateShareLinkResponse,
  type InviteMemberResponse,
  type LinkRole,
  type MemberRole,
  type OpenShareLinkResponse,
  type Profile,
  type ProjectInvite,
  type ProjectMember,
  type ProjectVersion,
  type ReviewProposalResponse,
  type RestoreVersionResponse,
  type SaveProjectResponse,
  type SetMemberRoleResponse,
  type ShareLink,
  type SubmitProposalResponse,
  type UserPreferences,
  type AcceptInviteResponse,
} from '@shared/cloud';
import type { EditPolicy, EditProposal, PlanEdit, Project } from '@shared/types';
import { effectivePolicy } from '@shared/rules';
import { useStore } from '../store';
import { loadSavedProject } from '../lib/persist';
import {
  AUTH_STORAGE_KEY,
  CLOUD_ANON_KEY,
  CLOUD_URL,
  RETURN_KEY,
  appUrl,
  cloudHooks,
  flash,
  minLevel,
  shareTokenFromUrl,
  useCloud,
  type ActiveCloud,
  type SaveStatus,
} from './state';

/**
 * Everything that talks to Supabase. Loaded lazily (see `loadEngine` in
 * ./state) — this module and `@supabase/supabase-js` are one chunk that the
 * first paint never carries.
 *
 * Reads go through PostgREST under row-level security; every write goes
 * through an Edge Function, which re-checks the caller's role with the same
 * rules engine the editor runs.
 */

let sb: SupabaseClient;

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** A CloudError, or a request that never reached the server. */
export type CallError = CloudError | { ok: false; code: 'NETWORK'; message: string };
type Ok<T> = T & { ok: true };

type FnName = keyof typeof CLOUD_FUNCTIONS;

async function call<T extends { ok: true }>(fn: FnName, body: object): Promise<T | CallError> {
  try {
    const { data, error } = await sb.functions.invoke(CLOUD_FUNCTIONS[fn], { body });
    if (!error) {
      if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === false) return data as CloudError;
      return data as T;
    }
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      try {
        const payload = await res.json();
        if (payload && payload.ok === false) return payload as CloudError;
      } catch {
        /* not JSON */
      }
      return {
        ok: false,
        code: res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : 'INTERNAL',
        message: `The server answered ${res.status}.`,
      };
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      return { ok: false, code: 'NETWORK', message: 'Can’t reach the cloud right now.' };
    }
    return { ok: false, code: 'INTERNAL', message: (error as Error).message || 'Something went wrong.' };
  } catch (error) {
    return { ok: false, code: 'NETWORK', message: (error as Error).message || 'Can’t reach the cloud right now.' };
  }
}

const failed = (r: { ok: boolean }): r is CallError => r.ok === false;

/** For UI actions: returns the payload or throws an Error with the server's plain message. */
async function must<T extends { ok: true }>(fn: FnName, body: object): Promise<Ok<T>> {
  const r = await call<T>(fn, body);
  if (failed(r)) throw Object.assign(new Error(r.message), { code: r.code, violations: (r as CloudError).violations });
  return r as Ok<T>;
}

// ---------------------------------------------------------------------------
// Row mapping (snake_case columns -> the camelCase contract)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d);

function toSummary(r: Row): CloudProjectSummary {
  return {
    id: s(r.id),
    name: s(r.name, 'Untitled'),
    ownerId: s(r.owner_id),
    ownerName: s(r.owner_name, 'Unknown'),
    role: s(r.role, 'VIEW') as AccessRole,
    ...(r.template_id ? { templateId: s(r.template_id) } : {}),
    version: n(r.version, 1),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    builtUpSqm: n(r.built_up_sqm),
    rooms: n(r.rooms),
    bufferedTotal: n(r.buffered_total),
    currency: s(r.currency, 'INR'),
    pendingProposals: n(r.pending_proposals),
  };
}

const DEFAULT_PREFS: UserPreferences = { showSqft: true, defaultHour: 15.5 };

function toProfile(r: Row): Profile {
  const prefs = (r.preferences && typeof r.preferences === 'object' ? r.preferences : {}) as Partial<UserPreferences>;
  return {
    id: s(r.id),
    displayName: s(r.display_name),
    avatarColor: s(r.avatar_color, '#3C7BA8'),
    preferences: { ...DEFAULT_PREFS, ...prefs },
    createdAt: s(r.created_at),
  };
}

function toMember(r: Row): ProjectMember {
  return {
    userId: s(r.user_id),
    displayName: s(r.display_name, 'Unknown'),
    avatarColor: s(r.avatar_color, '#6B6460'),
    ...(r.email ? { email: s(r.email) } : {}),
    role: s(r.role, 'VIEW') as MemberRole,
    addedAt: s(r.added_at),
  };
}

function toInvite(r: Row): ProjectInvite {
  return {
    id: s(r.id),
    email: s(r.email),
    role: s(r.role, 'VIEW') as MemberRole,
    createdAt: s(r.created_at),
    expiresAt: s(r.expires_at),
    ...(r.accepted_at ? { acceptedAt: s(r.accepted_at) } : {}),
  };
}

function toLink(r: Row): ShareLink {
  return {
    token: s(r.token),
    role: s(r.role, 'VIEW') as LinkRole,
    createdAt: s(r.created_at),
    ...(r.expires_at ? { expiresAt: s(r.expires_at) } : {}),
    revoked: Boolean(r.revoked),
  };
}

// ---------------------------------------------------------------------------
// Boot, auth and profile
// ---------------------------------------------------------------------------

let booted = false;

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  useCloud.setState({ status: 'loading' });

  const urlError = readAuthError();

  sb = createClient(CLOUD_URL, CLOUD_ANON_KEY, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  installHooks();
  installSync();

  // getSession waits for initialisation, which exchanges a `?code=` from a
  // magic link (or Google) for a session before resolving.
  let session: Session | null = null;
  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
  } catch (error) {
    flash(`Sign-in didn’t complete: ${(error as Error).message}`, 'warn');
  }
  cleanAuthParams();
  if (urlError) flash(urlError, 'warn');

  await applySession(session);

  sb.auth.onAuthStateChange((event, next) => {
    // Never await Supabase calls inside this callback: it runs under the auth lock.
    if (event === 'INITIAL_SESSION') return;
    window.setTimeout(() => void applySession(next), 0);
  });

  window.addEventListener('hashchange', () => {
    const token = shareTokenFromUrl();
    if (token) void openShareToken(token);
  });

  const fromUrl = shareTokenFromUrl();
  let returnTo: string | null = null;
  try {
    returnTo = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
  } catch {
    /* storage blocked */
  }
  const token = fromUrl ?? (session ? returnTo : null);
  if (token) await openShareToken(token);
}

function readAuthError(): string | null {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const msg = q.get('error_description') ?? h.get('error_description');
  return msg ? `Sign-in failed: ${msg.replace(/\+/g, ' ')}` : null;
}

/** Drops `?code=` / `?error=` (and an implicit-flow hash) so a reload doesn't replay them. */
function cleanAuthParams() {
  const url = new URL(location.href);
  let changed = false;
  for (const k of ['code', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  if (/(^#|&)(access_token|error_description|error)=/.test(url.hash)) {
    url.hash = '';
    changed = true;
  }
  if (changed) history.replaceState(history.state, '', url.toString());
}

let currentUserId: string | null = null;

async function applySession(session: Session | null) {
  const user = session?.user ?? null;
  if (!user) {
    const wasSignedIn = currentUserId !== null;
    currentUserId = null;
    useCloud.setState({ status: 'signedOut', user: null, profile: null });
    if (wasSignedIn) leaveMembershipProject();
    return;
  }
  if (user.id === currentUserId) {
    useCloud.setState({ user: { id: user.id, email: user.email ?? '' } });
    return;
  }
  currentUserId = user.id;
  useCloud.setState({ status: 'signedIn', user: { id: user.id, email: user.email ?? '' } });
  await loadProfile(user.id);
  useCloud.setState((st) => ({ listRev: st.listRev + 1 }));
}

/** After sign-out a member's project can't be read any more; fall back to the local plan. */
function leaveMembershipProject() {
  const active = useCloud.getState().active;
  if (!active || active.link) return;
  useCloud.setState({ active: null });
  const saved = loadSavedProject();
  if (saved) useStore.setState({ project: saved.project, screen: 'home', versionPreview: null, previewProposalId: null });
  else {
    useStore.getState().resetProject();
    useStore.getState().goHome();
  }
}

async function loadProfile(userId: string) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error || !data) return;
  let profile = toProfile(data);
  // The name people already typed for proposals becomes their profile name,
  // unless they have set one deliberately (the trigger's default is derived from the email).
  const local = useStore.getState().author.trim();
  const email = useCloud.getState().user?.email ?? '';
  const derived = email.split('@')[0]?.replace(/[._+-]+/g, ' ').toLowerCase() ?? '';
  if (local && local !== profile.displayName && profile.displayName.toLowerCase() === derived) {
    const next = await updateProfile({ displayName: local });
    if (next) profile = next;
  }
  useCloud.setState({ profile });
  useStore.setState({ author: profile.displayName });
}

export async function signInWithEmail(email: string): Promise<void> {
  rememberReturn();
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: appUrl(), shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function signInWithGoogle(): Promise<void> {
  rememberReturn();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
  if (error) throw error;
}

/** A share link opened signed out should still be open after the magic link lands. */
function rememberReturn() {
  const token = useCloud.getState().active?.link?.token ?? shareTokenFromUrl();
  try {
    if (token) localStorage.setItem(RETURN_KEY, token);
  } catch {
    /* fine: they can reopen the link */
  }
}

export async function signOut(): Promise<void> {
  await flushNow();
  await sb.auth.signOut();
  // The proposal name belonged to the account; the next person on this browser starts fresh.
  useStore.getState().setAuthor('');
}

export async function updateProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatarColor' | 'preferences'>>): Promise<Profile | null> {
  const user = useCloud.getState().user;
  if (!user) return null;
  const row: Row = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim().slice(0, 80) || 'Designer';
  if (patch.avatarColor !== undefined) row.avatar_color = patch.avatarColor.toUpperCase();
  if (patch.preferences !== undefined) row.preferences = patch.preferences;
  const { data, error } = await sb.from('profiles').update(row).eq('id', user.id).select('*').single();
  if (error) throw new Error(error.message);
  const profile = toProfile(data);
  useCloud.setState({ profile });
  if (patch.displayName !== undefined) useStore.setState({ author: profile.displayName });
  return profile;
}

// ---------------------------------------------------------------------------
// Projects: list, create, open, rename, duplicate, delete
// ---------------------------------------------------------------------------

export interface ProjectTile extends CloudProjectSummary {
  data?: Project;
}

export async function listProjects(): Promise<ProjectTile[]> {
  const { data, error } = await sb.from('my_projects').select('*').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const list = (data ?? []).map(toSummary);
  if (!list.length) return [];
  const { data: docs } = await sb.from('projects').select('id,data').in('id', list.map((p) => p.id));
  const byId = new Map((docs ?? []).map((d) => [s(d.id), d.data as Project]));
  return list.map((p) => ({ ...p, data: byId.get(p.id) }));
}

export interface PendingInvite {
  id: string;
  projectId: string;
  projectName: string;
  invitedByName: string;
  role: MemberRole;
  expiresAt: string;
}

export async function listMyInvites(): Promise<PendingInvite[]> {
  const { data, error } = await sb.from('my_invites').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: s(r.id),
    projectId: s(r.project_id),
    projectName: s(r.project_name, 'A project'),
    invitedByName: s(r.invited_by_name, 'Someone'),
    role: s(r.role, 'VIEW') as MemberRole,
    expiresAt: s(r.expires_at),
  }));
}

export async function acceptInvite(inviteId: string): Promise<string> {
  const r = await must<AcceptInviteResponse>('acceptInvite', { inviteId });
  bumpList();
  return r.projectId;
}

function bumpList() {
  useCloud.setState((st) => ({ listRev: st.listRev + 1 }));
}

export async function createProject(name: string, data: Project, templateId?: string): Promise<CloudProjectSummary> {
  const doc = structuredClone(data);
  delete doc.proposals;
  const r = await must<CreateProjectResponse>('createProject', {
    name: name.trim() || data.name || 'Untitled',
    data: doc,
    ...(templateId ? { templateId } : {}),
  });
  bumpList();
  return r.project;
}

/** Saves the plan open right now (a local one) as a new cloud project and switches to it. */
export async function saveCurrentToCloud(): Promise<void> {
  const { project } = useStore.getState();
  const summary = await createProject(project.name, project, project.templateId);
  await openCloudProject(summary.id, { inPlace: useStore.getState().screen === 'studio' });
  flash('Saved to the cloud.', 'info');
  useStore.getState().notify('Saved to your cloud projects.', 'info');
}

async function fetchProject(id: string): Promise<CloudProject> {
  const [{ data: summary, error: e1 }, { data: row, error: e2 }] = await Promise.all([
    sb.from('my_projects').select('*').eq('id', id).maybeSingle(),
    sb.from('projects').select('id,data,version,name').eq('id', id).maybeSingle(),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  if (!summary || !row) throw new Error('That project doesn’t exist or isn’t shared with you.');
  return { ...toSummary(summary), version: n(row.version, 1), data: row.data as Project };
}

export async function openCloudProject(id: string, opts: { inPlace?: boolean } = {}): Promise<void> {
  await flushNow();
  const p = await fetchProject(id);
  openDoc(p, p.role, undefined, opts.inPlace);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const active = useCloud.getState().active;
  if (active?.id === id) {
    useStore.setState({ project: { ...useStore.getState().project, name } });
    useCloud.setState({ active: { ...active, name } });
    await flushNow();
    bumpList();
    return;
  }
  const p = await fetchProject(id);
  await must<SaveProjectResponse>('saveProject', { projectId: id, data: { ...p.data, name }, baseVersion: p.version, name });
  bumpList();
}

export async function duplicateProject(id: string): Promise<void> {
  const p = await fetchProject(id);
  await createProject(`${p.name} (copy)`, { ...p.data, name: `${p.name} (copy)` }, p.templateId);
}

export async function deleteProject(id: string): Promise<void> {
  await must('deleteProject', { projectId: id });
  if (useCloud.getState().active?.id === id) leaveMembershipProject();
  bumpList();
}

// ---------------------------------------------------------------------------
// The open document: role cap, view policy and autosave
// ---------------------------------------------------------------------------

/** The last document the server confirmed, exactly as it stores it. */
let serverDoc: Project | null = null;
let serverJson = '';
/** True while the engine itself writes into the store (server data), so it isn't echoed back as an edit. */
let applying = false;
let paused = false;
let timer = 0;
let chain: Promise<unknown> = Promise.resolve();

function capFor(role: AccessRole, policy: EditPolicy, link?: ActiveCloud['link']): ActiveCloud['cap'] {
  if (link && !link.joined && role === link.role) return 'VIEW';
  if (role === 'OWNER') return policy.level;
  return minLevel(role, policy.level);
}

/**
 * What the editor sees. The owner sees the stored policy and edits it. Anyone
 * else gets it capped at their role; at Finishes the plan is drawn in review
 * mode, so geometry drags become proposals instead of edits.
 */
function toView(doc: Project, a: ActiveCloud): Project {
  if (a.role === 'OWNER') return structuredClone(doc);
  const p = effectivePolicy(doc);
  let policy: EditPolicy;
  if (a.cap === 'VIEW') policy = { ...p, level: 'VIEW' };
  else if (a.cap === 'FINISHES') policy = { ...p, level: 'LAYOUT', requireReview: true };
  else policy = { ...p, level: a.cap, requireReview: a.role === 'FULL' ? false : p.requireReview };
  return { ...structuredClone(doc), policy };
}

/** What gets saved: the stored policy and proposals go back untouched. */
function toServer(project: Project, a: ActiveCloud): Project {
  const doc = structuredClone(project);
  if (a.role !== 'OWNER') {
    if (a.serverPolicy) doc.policy = structuredClone(a.serverPolicy);
    else delete doc.policy;
  }
  if (serverDoc?.proposals) doc.proposals = structuredClone(serverDoc.proposals);
  else delete doc.proposals;
  return doc;
}

function stable(project: Project) {
  return JSON.stringify(project);
}

function setSave(state: SaveStatus['state'], extra: Partial<SaveStatus> = {}) {
  useCloud.setState({ save: { state, ...extra, at: Date.now() } });
}

function canWrite(a: ActiveCloud) {
  return a.cap !== 'VIEW' && !(a.link && !a.link.joined && a.role === a.link.role);
}

/** Opens (or re-opens) a cloud document in the editor. */
function openDoc(p: CloudProject, role: AccessRole, link?: ActiveCloud['link'], inPlace = false) {
  const stored = p.data.policy ? structuredClone(p.data.policy) : undefined;
  const active: ActiveCloud = {
    id: p.id,
    name: p.name,
    ownerId: p.ownerId,
    role,
    ...(link ? { link } : {}),
    cap: capFor(role, effectivePolicy(p.data), link),
    ...(stored ? { serverPolicy: stored } : {}),
    version: p.version,
  };
  setServer(p.data);
  paused = false;
  window.clearTimeout(timer);
  applying = true;
  try {
    const view = toView(p.data, active);
    if (inPlace) {
      // Same plan, now in the cloud: no build-up replay, selection kept.
      useCloud.setState({ active, members: null });
      useStore.setState({ project: view, previewProposalId: null, versionPreview: null });
    } else useStore.getState().openProject(view, active);
  } finally {
    applying = false;
  }
  setSave(canWrite(active) ? 'saved' : 'readonly');
  applyPreferences();
}

function setServer(doc: Project) {
  serverDoc = structuredClone(doc);
  serverJson = '';
}

/** Puts a server document into the editor in place (selection and camera kept). */
function applyServer(doc: Project, version: number) {
  const a = useCloud.getState().active;
  if (!a) return;
  const policy = effectivePolicy(doc);
  const next: ActiveCloud = {
    ...a,
    version,
    cap: capFor(a.role, policy, a.link),
    ...(doc.policy ? { serverPolicy: structuredClone(doc.policy) } : {}),
  };
  if (!doc.policy) delete next.serverPolicy;
  setServer(doc);
  useCloud.setState({ active: next });
  applying = true;
  try {
    const state = useStore.getState();
    const view = toView(doc, next);
    const keepPreview = view.proposals?.some((p) => p.id === state.previewProposalId && p.status === 'PENDING');
    useStore.setState({ project: view, ...(keepPreview ? {} : { previewProposalId: null, previewIn3d: false }) });
  } finally {
    applying = false;
  }
  serverJson = stable(toServer(useStore.getState().project, next));
}

function installSync() {
  useStore.subscribe((state, prev) => {
    if (state.project === prev.project || applying) return;
    const a = useCloud.getState().active;
    if (!a || !canWrite(a) || paused) return;
    schedule();
  });
  window.addEventListener('online', () => {
    if (useCloud.getState().save.state === 'offline') schedule(0);
  });
  window.addEventListener('pagehide', () => void flushNow());
}

function schedule(delay = 900) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void enqueue(saveNow), delay);
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

/** Saves anything pending right now; resolves when the queue is idle. */
export function flushNow(): Promise<void> {
  window.clearTimeout(timer);
  return enqueue(saveNow);
}

let retry = 0;

async function saveNow(force = false): Promise<void> {
  const a = useCloud.getState().active;
  if (!a || !canWrite(a) || (paused && !force)) return;
  const project = useStore.getState().project;
  const doc = toServer(project, a);
  const json = stable(doc);
  if (!serverJson && serverDoc) serverJson = stable(toServer(toView(serverDoc, a), a));
  if (!force && json === serverJson) {
    if (useCloud.getState().save.state !== 'saved') setSave('saved');
    return;
  }
  setSave('saving');
  const nameChanged = doc.name !== a.name;
  const r = await call<SaveProjectResponse>('saveProject', {
    projectId: a.id,
    data: doc,
    baseVersion: a.version,
    ...(nameChanged ? { name: doc.name } : {}),
  });
  const still = useCloud.getState().active;
  if (!still || still.id !== a.id) return;

  if (!failed(r)) {
    retry = 0;
    serverDoc = doc;
    serverJson = json;
    const next: ActiveCloud = {
      ...still,
      version: r.version,
      name: r.summary.name,
      // An owner's own policy edits change what they themselves may do next.
      cap: capFor(still.role, effectivePolicy(doc), still.link),
    };
    if (still.role === 'OWNER') {
      if (doc.policy) next.serverPolicy = structuredClone(doc.policy);
      else delete next.serverPolicy;
    }
    useCloud.setState({ active: next });
    setSave('saved');
    if (nameChanged) bumpList();
    if (stable(toServer(useStore.getState().project, still)) !== json) schedule(400);
    return;
  }

  switch (r.code) {
    case 'CONFLICT':
      paused = true;
      setSave('conflict', { message: r.message, ...(r.currentVersion ? { currentVersion: r.currentVersion } : {}) });
      return;
    case 'FORBIDDEN':
    case 'INVALID': {
      // The server refused this edit: put the plan back as it last agreed, and say why.
      if (serverDoc) applyServer(serverDoc, still.version);
      setSave('forbidden', { message: r.message, ...(r.violations ? { violations: r.violations } : {}) });
      useStore.getState().notify(r.message, 'warn');
      return;
    }
    case 'NOT_FOUND':
      paused = true;
      setSave('readonly', { message: r.message });
      return;
    case 'UNAUTHENTICATED':
      paused = true;
      setSave('offline', { message: 'You’re signed out — sign in again to keep saving.' });
      return;
    default: {
      setSave('offline', { message: r.message });
      retry = Math.min(retry + 1, 6);
      schedule(Math.min(30000, 2000 * 2 ** retry));
    }
  }
}

/** Conflict: discard my unsaved edits and take what is stored now. */
export async function reloadTheirs(): Promise<void> {
  const a = useCloud.getState().active;
  if (!a) return;
  const p = await fetchProject(a.id);
  paused = false;
  applyServer(p.data, p.version);
  setSave('saved');
}

/** Conflict: save my document on top of the newer version, knowingly. */
export async function keepMine(): Promise<void> {
  const a = useCloud.getState().active;
  if (!a) return;
  const p = await fetchProject(a.id);
  // Server-owned parts (proposals, and the policy for non-owners) come from the newer version.
  serverDoc = p.data;
  const serverPolicy = p.data.policy ? structuredClone(p.data.policy) : undefined;
  const next: ActiveCloud = { ...a, version: p.version };
  if (a.role !== 'OWNER') {
    if (serverPolicy) next.serverPolicy = serverPolicy;
    else delete next.serverPolicy;
  }
  useCloud.setState({ active: next });
  paused = false;
  await enqueue(() => saveNow(true));
}

// ---------------------------------------------------------------------------
// Proposals and versions
// ---------------------------------------------------------------------------

function isClean(a: ActiveCloud) {
  return stable(toServer(useStore.getState().project, a)) === (serverJson || stable(toServer(toView(serverDoc!, a), a)));
}

/** Runs a versioned write; on CONFLICT with nothing unsaved locally, reloads and tries once more. */
async function versioned<T extends { ok: true }>(
  fn: FnName,
  body: (version: number) => object,
): Promise<Ok<T> | CallError> {
  await saveNow();
  let a = useCloud.getState().active!;
  let r = await call<T>(fn, body(a.version));
  if (failed(r) && r.code === 'CONFLICT' && isClean(a)) {
    await reloadTheirs();
    a = useCloud.getState().active!;
    r = await call<T>(fn, body(a.version));
  }
  return r as Ok<T> | CallError;
}

function installHooks() {
  cloudHooks.propose = (edits: PlanEdit[], note?: string) => {
    void enqueue(async () => {
      const a = useCloud.getState().active;
      if (!a) return;
      const r = await versioned<SubmitProposalResponse>('submitProposal', (baseVersion) => ({
        projectId: a.id,
        edits,
        ...(note ? { note } : {}),
        baseVersion,
      }));
      if (failed(r)) {
        if (r.code === 'CONFLICT') {
          paused = true;
          setSave('conflict', { message: r.message, ...(r.currentVersion ? { currentVersion: r.currentVersion } : {}) });
        }
        useStore.getState().notify(r.message, 'warn');
        return;
      }
      const cur = useCloud.getState().active!;
      const doc = structuredClone(serverDoc!);
      doc.proposals = [...(doc.proposals ?? []), r.proposal];
      serverDoc = doc;
      useCloud.setState({ active: { ...cur, version: r.version } });
      applying = true;
      try {
        const state = useStore.getState();
        useStore.setState({
          project: { ...state.project, proposals: [...(state.project.proposals ?? []), r.proposal] },
          previewProposalId: r.proposal.id,
        });
      } finally {
        applying = false;
      }
      serverJson = stable(toServer(toView(doc, cur), cur));
      useStore.getState().notify('Proposal sent for review.', 'info');
    });
  };

  cloudHooks.review = (proposal: EditProposal, decision: 'ACCEPT' | 'REJECT') => {
    void enqueue(async () => {
      const a = useCloud.getState().active;
      if (!a) return;
      const r = await versioned<ReviewProposalResponse>('reviewProposal', (baseVersion) => ({
        projectId: a.id,
        proposalId: proposal.id,
        decision,
        baseVersion,
      }));
      if (failed(r)) {
        useStore.getState().notify(r.message, 'warn');
        return;
      }
      applyServer(r.data, r.version);
      useStore.setState({ previewProposalId: null, previewIn3d: false });
      useStore.getState().notify(decision === 'ACCEPT' ? `Accepted ${proposal.author}’s proposal.` : 'Proposal rejected.', 'info');
      bumpList();
    });
  };

  let nameTimer = 0;
  cloudHooks.author = (name: string) => {
    if (!useCloud.getState().user) return;
    window.clearTimeout(nameTimer);
    nameTimer = window.setTimeout(() => {
      if (name.trim()) updateProfile({ displayName: name }).catch(() => undefined);
    }, 700);
  };
}

export interface VersionRow extends ProjectVersion {
  data?: Project;
}

export async function listVersions(projectId: string): Promise<VersionRow[]> {
  const { data, error } = await sb
    .from('project_versions')
    .select('id,version,author_id,reason,created_at,rooms,built_up_sqm,buffered_total')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((r) => s(r.author_id)).filter(Boolean))];
  const names = new Map<string, string>();
  const me = useCloud.getState().profile;
  await Promise.all(
    ids.map(async (id) => {
      if (me && id === me.id) return names.set(id, me.displayName);
      const { data: card } = await sb.rpc('profile_card', { p_user_id: id });
      const row = Array.isArray(card) ? card[0] : card;
      names.set(id, s(row?.display_name, 'Someone'));
    }),
  );
  return (data ?? []).map((r) => ({
    id: s(r.id),
    version: n(r.version),
    authorId: s(r.author_id),
    authorName: names.get(s(r.author_id)) ?? 'Someone',
    reason: s(r.reason, 'SAVE') as ProjectVersion['reason'],
    createdAt: s(r.created_at),
    summary: { rooms: n(r.rooms), builtUpSqm: n(r.built_up_sqm), bufferedTotal: n(r.buffered_total) },
  }));
}

export async function versionData(versionId: string): Promise<Project> {
  const { data, error } = await sb.from('project_versions').select('data').eq('id', versionId).single();
  if (error) throw new Error(error.message);
  return data.data as Project;
}

export async function restoreVersion(versionId: string): Promise<void> {
  const r = await enqueue(async () => {
    const a = useCloud.getState().active;
    if (!a) throw new Error('No cloud project is open.');
    return versioned<RestoreVersionResponse>('restoreVersion', (baseVersion) => ({ projectId: a.id, versionId, baseVersion }));
  });
  if (failed(r)) throw new Error(r.message);
  applyServer(r.data, r.version);
  useStore.setState({ versionPreview: null });
  useStore.getState().notify('Version restored — saved as a new version.', 'info');
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface Sharing {
  members: ProjectMember[];
  invites: ProjectInvite[];
  links: ShareLink[];
}

export async function loadSharing(projectId: string): Promise<Sharing> {
  const [m, i, l] = await Promise.all([
    sb.from('project_member_profiles').select('*').eq('project_id', projectId).order('added_at'),
    sb.from('project_invites').select('*').eq('project_id', projectId).is('accepted_at', null).order('created_at', { ascending: false }),
    sb.from('share_links').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
  ]);
  const members = (m.data ?? []).map(toMember);
  useCloud.setState({ members });
  return {
    members,
    invites: (i.data ?? []).map(toInvite).filter((x) => new Date(x.expiresAt).getTime() > Date.now()),
    links: (l.data ?? []).map(toLink),
  };
}

export async function inviteMember(projectId: string, email: string, role: MemberRole): Promise<InviteMemberResponse> {
  return must<InviteMemberResponse>('inviteMember', { projectId, email: email.trim().toLowerCase(), role });
}

export async function setMemberRole(projectId: string, userId: string, role: MemberRole) {
  return must<SetMemberRoleResponse>('setMemberRole', { projectId, userId, role });
}

export async function removeMember(projectId: string, userId: string) {
  return must('removeMember', { projectId, userId });
}

export async function createShareLink(projectId: string, role: LinkRole, expiresInDays?: number) {
  return must<CreateShareLinkResponse>('createShareLink', { projectId, role, ...(expiresInDays ? { expiresInDays } : {}) });
}

export async function revokeShareLink(projectId: string, token: string) {
  return must('revokeShareLink', { projectId, token });
}

/** Opens `#/share/<token>`: works signed out (read-only until joined). */
export async function openShareToken(token: string, join = false): Promise<void> {
  useCloud.setState({ shareToken: token });
  const r = await call<OpenShareLinkResponse>('openShareLink', { token, ...(join ? { join: true } : {}) });
  if (failed(r)) {
    flash(r.message, 'warn');
    useStore.getState().notify(r.message, 'warn');
    clearShareHash();
    return;
  }
  const p = r.project;
  const signedIn = Boolean(useCloud.getState().user);
  // A member (or the owner) opening a link just gets their own access.
  // and once joined, the link is just how they got here: they are a member now.
  const member = signedIn && p.role !== r.role;
  const link = member || join ? undefined : { token, role: r.role, joined: false };
  await flushNow();
  openDoc(p, p.role, link);
  clearShareHash();
  if (join) {
    useStore.getState().notify(`Joined “${p.name}” with ${r.role === 'FINISHES' ? 'Finishes' : 'View'} access.`, 'info');
    bumpList();
  }
}

export async function joinShared(): Promise<void> {
  const a = useCloud.getState().active;
  if (!a?.link) return;
  await openShareToken(a.link.token, true);
}

function clearShareHash() {
  if (shareTokenFromUrl()) history.replaceState(history.state, '', location.pathname + location.search);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function applyPreferences() {
  const prefs = useCloud.getState().profile?.preferences;
  if (!prefs) return;
  const hour = Math.max(6, Math.min(19, prefs.defaultHour));
  useStore.getState().patchRender({ sunHour: hour });
}
