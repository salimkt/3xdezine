import { create } from 'zustand';
import type { AccessRole, LinkRole, Profile, ProjectMember, ProjectVersion } from '@shared/cloud';
import type { EditLevel, EditPolicy, EditProposal, PlanEdit, Project, RuleViolation } from '@shared/types';

/**
 * Cloud state that the shell needs before (and without) the Supabase SDK.
 *
 * Everything here is plain data and a tiny zustand store: `@supabase/supabase-js`
 * lives in `./engine`, which is only ever reached through `loadEngine()` — a
 * dynamic import — and only when cloud is configured AND there is a reason to
 * talk to it (a stored session, an auth redirect, a share link, or a click).
 * With `VITE_SUPABASE_URL` unset none of that happens and the app is the same
 * fully local studio it always was.
 */

const env = import.meta.env as Record<string, string | undefined>;

export const CLOUD_URL = env.VITE_SUPABASE_URL ?? '';
export const CLOUD_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? '';
export const CLOUD_ENABLED = Boolean(CLOUD_URL && CLOUD_ANON_KEY);
export const GOOGLE_ENABLED = CLOUD_ENABLED && env.VITE_SUPABASE_GOOGLE === '1';

/** supabase-js `storageKey`; fixed so the shell can see a session without the SDK. */
export const AUTH_STORAGE_KEY = 'dezine.auth';
/** Where to go back to after a magic link lands, e.g. a share link opened signed out. */
export const RETURN_KEY = 'dezine.return';

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const RANK: Record<EditLevel, number> = { VIEW: 0, FINISHES: 1, LAYOUT: 2, FULL: 3 };

export function minLevel(a: EditLevel, b: EditLevel): EditLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export function atLeast(level: EditLevel, floor: EditLevel): boolean {
  return RANK[level] >= RANK[floor];
}

export const ROLE_LABEL: Record<AccessRole, string> = {
  OWNER: 'Owner',
  FULL: 'Full',
  LAYOUT: 'Layout',
  FINISHES: 'Finishes',
  VIEW: 'View',
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface CloudUser {
  id: string;
  email: string;
}

/** The cloud project open in the studio, if any. */
export interface ActiveCloud {
  id: string;
  name: string;
  ownerId: string;
  role: AccessRole;
  /** Set when the project was opened through a share link rather than membership. */
  link?: { token: string; role: LinkRole; joined: boolean };
  /** min(role, stored policy level); OWNER keeps the stored level. */
  cap: EditLevel;
  /** The policy as stored on the server — what a non-owner's save must send back. */
  serverPolicy?: EditPolicy;
  version: number;
}

export type SaveState = 'idle' | 'saved' | 'saving' | 'offline' | 'conflict' | 'forbidden' | 'readonly';

export interface SaveStatus {
  state: SaveState;
  message?: string;
  violations?: RuleViolation[];
  currentVersion?: number;
  at: number;
}

export type CloudDialog = 'account' | 'share' | 'signin' | null;

/** The studio's version-history panel. */
export const useHistoryPanel = create<{ open: boolean }>(() => ({ open: false }));

export interface VersionPreview {
  version: ProjectVersion;
  project: Project;
}

interface CloudState {
  /** 'off' = not configured; 'idle' = configured, SDK not loaded (signed out as far as we know). */
  status: 'off' | 'idle' | 'loading' | 'signedOut' | 'signedIn';
  user: CloudUser | null;
  profile: Profile | null;
  active: ActiveCloud | null;
  save: SaveStatus;
  dialog: CloudDialog;
  /** Bumped whenever the projects list should be re-read. */
  listRev: number;
  /** A share token from the URL, waiting to be opened. */
  shareToken: string | null;
  members: ProjectMember[] | null;
  /** One-line message for the home screen (sign-in sent, link failed...). */
  flash: { text: string; tone: 'info' | 'warn'; at: number } | null;
}

export const useCloud = create<CloudState>(() => ({
  status: CLOUD_ENABLED ? 'idle' : 'off',
  user: null,
  profile: null,
  active: null,
  save: { state: 'idle', at: 0 },
  dialog: null,
  listRev: 0,
  shareToken: null,
  members: null,
  flash: null,
}));

let flashSeq = 0;
export function flash(text: string, tone: 'info' | 'warn' = 'info') {
  useCloud.setState({ flash: { text, tone, at: ++flashSeq } });
}

// ---------------------------------------------------------------------------
// Hooks the editor store calls when a cloud project is open
// ---------------------------------------------------------------------------

export interface CloudHooks {
  propose: (edits: PlanEdit[], note?: string) => void;
  review: (proposal: EditProposal, decision: 'ACCEPT' | 'REJECT') => void;
  author: (name: string) => void;
}

/** Filled in by the engine once it has loaded; empty means "fully local". */
export const cloudHooks: Partial<CloudHooks> = {};

// ---------------------------------------------------------------------------
// URL and storage signals the shell can read without the SDK
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasStoredSession(): boolean {
  try {
    return Boolean(storage()?.getItem(AUTH_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** A PKCE `?code=`, an implicit-flow `#access_token=`, or an auth error coming back from Supabase. */
export function authInUrl(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('code') || q.has('error_description')) return true;
  return /(^|[#&])(access_token|error_description)=/.test(location.hash);
}

/** `#/share/<token>` — a hash route, so it survives the Pages base path untouched. */
export function shareTokenFromUrl(): string | null {
  const m = /^#\/share\/([A-Za-z0-9_-]{6,})/.exec(location.hash);
  return m ? m[1] : null;
}

export function shareUrl(token: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/share/${token}`;
}

/** Where auth redirects return: the deployed app root, base path included. */
export function appUrl(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

export type Engine = typeof import('./engine');

let enginePromise: Promise<Engine> | null = null;

/** The only door to `@supabase/supabase-js`. */
export function loadEngine(): Promise<Engine> {
  if (!CLOUD_ENABLED) return Promise.reject(new Error('Cloud sync is not configured.'));
  enginePromise ??= import('./engine').then(async (engine) => {
    await engine.boot();
    return engine;
  });
  enginePromise.catch(() => (enginePromise = null));
  return enginePromise;
}

/** Should the SDK load at startup? Only with something to restore or complete. */
export function wantsEngineAtStart(): boolean {
  return CLOUD_ENABLED && (hasStoredSession() || authInUrl() || shareTokenFromUrl() !== null);
}
