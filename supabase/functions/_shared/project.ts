/**
 * Project rows: loading, access resolution, summaries and the atomic commit.
 */
import catalogData from './domain/catalog.ts';
import { estimateCost, polygonArea } from './domain/cost.ts';
import { effectivePolicy } from './domain/rules.ts';
import type { AccessRole, CloudProjectSummary, MemberRole, ProjectMember, ProjectInvite, ShareLink, VersionReason } from './domain/cloud.ts';
import type { Catalog, EditLevel, Project } from './domain/types.ts';
import { admin, type Caller } from './auth.ts';
import { Fail, conflict, forbidden, invalid, notFound } from './http.ts';

export const catalog: Catalog = catalogData;

export const LEVELS: readonly EditLevel[] = ['VIEW', 'FINISHES', 'LAYOUT', 'FULL'];
export const rank = (l: EditLevel) => LEVELS.indexOf(l);
export const minLevel = (a: EditLevel, b: EditLevel): EditLevel => (rank(a) <= rank(b) ? a : b);
export const maxLevel = (a: EditLevel, b: EditLevel): EditLevel => (rank(a) >= rank(b) ? a : b);

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  data: Project;
  template_id: string | null;
  version: number;
  built_up_sqm: number;
  rooms: number;
  buffered_total: number;
  currency: string;
  pending_proposals: number;
  created_at: string;
  updated_at: string;
}

export interface Access {
  project: ProjectRow;
  role: AccessRole;
  /** OWNER -> FULL; member -> min(role, project policy level). */
  level: EditLevel;
  isOwner: boolean;
}

export async function loadProject(id: string): Promise<ProjectRow | undefined> {
  const { data, error } = await admin().from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) ?? undefined;
}

export async function memberRole(projectId: string, userId: string): Promise<MemberRole | undefined> {
  const { data, error } = await admin()
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role as MemberRole | undefined) ?? undefined;
}

export function levelFor(role: AccessRole, project: Project): EditLevel {
  if (role === 'OWNER') return 'FULL';
  return minLevel(role, effectivePolicy(project).level);
}

/**
 * Resolves the caller's access. Strangers get NOT_FOUND (not FORBIDDEN), so
 * project ids can't be probed for existence.
 */
export async function access(projectId: string, caller: Caller): Promise<Access> {
  const project = await loadProject(projectId);
  if (!project) throw notFound();
  if (project.owner_id === caller.id) return { project, role: 'OWNER', level: 'FULL', isOwner: true };
  const role = await memberRole(projectId, caller.id);
  if (!role) throw notFound();
  return { project, role, level: levelFor(role, project.data), isOwner: false };
}

export function requireOwner(a: Access, what: string): void {
  if (!a.isOwner) throw forbidden(`Only the project owner can ${what}.`);
}

export function requireReviewer(a: Access, what: string): void {
  if (!(a.isOwner || a.role === 'FULL')) throw forbidden(`Only the owner or someone with Full access can ${what}.`);
}

export function checkBase(a: Access, baseVersion: number): void {
  if (a.project.version !== baseVersion) throw conflict(a.project.version);
}

// ---------------------------------------------------------------------------
// Validation of an incoming Project document (shape only; rules come later)
// ---------------------------------------------------------------------------

const MAX_DOC_BYTES = 2_000_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => isObj(v) && isNum(v.x) && isNum(v.z);

export function parseProject(v: unknown): Project {
  if (!isObj(v)) throw invalid('`data` must be a project document.');
  if (JSON.stringify(v).length > MAX_DOC_BYTES) throw invalid('This project is too large to save (over 2 MB).');
  if (typeof v.name !== 'string') throw invalid('The project needs a name.');
  if (!Array.isArray(v.floors)) throw invalid('The project has no floors list.');
  if (!isNum(v.contingencyBuffer ?? 0)) throw invalid('`contingencyBuffer` must be a number.');
  for (const f of v.floors) {
    if (!isObj(f) || typeof f.id !== 'string') throw invalid('Every floor needs an id.');
    for (const key of ['walls', 'rooms', 'openings', 'components']) {
      if (!Array.isArray(f[key])) throw invalid(`Floor ${f.id} is missing its ${key} list.`);
    }
    for (const w of f.walls as unknown[]) {
      if (!isObj(w) || typeof w.id !== 'string' || !isVec(w.start) || !isVec(w.end) || !isNum(w.heightM) || !isNum(w.thicknessM)) {
        throw invalid(`A wall on floor ${f.id} is malformed.`);
      }
    }
    for (const r of f.rooms as unknown[]) {
      if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.polygon) || !r.polygon.every(isVec) || !isNum(r.ceilingHeightM)) {
        throw invalid(`A room on floor ${f.id} is malformed.`);
      }
    }
    for (const o of f.openings as unknown[]) {
      if (!isObj(o) || typeof o.id !== 'string' || typeof o.wallId !== 'string' || !isNum(o.t) || !isNum(o.widthM) || !isNum(o.heightM) || !isNum(o.sillM)) {
        throw invalid(`An opening on floor ${f.id} is malformed.`);
      }
    }
    for (const c of f.components as unknown[]) {
      if (!isObj(c) || typeof c.id !== 'string' || typeof c.componentId !== 'string' || !isVec(c.position) || !isNum(c.rotationDeg)) {
        throw invalid(`A placed component on floor ${f.id} is malformed.`);
      }
    }
  }
  return v as unknown as Project;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface Summary {
  builtUpSqm: number;
  rooms: number;
  bufferedTotal: number;
  currency: string;
  pendingProposals: number;
}

export function summarize(data: Project): Summary {
  const rooms = data.floors.flatMap((f) => f.rooms);
  const cost = estimateCost(data, catalog);
  return {
    builtUpSqm: Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) * 100) / 100,
    rooms: rooms.length,
    bufferedTotal: cost.total,
    currency: cost.currency,
    pendingProposals: (data.proposals ?? []).filter((p) => p.status === 'PENDING').length,
  };
}

export async function ownerName(ownerId: string): Promise<string> {
  const { data } = await admin().from('profiles').select('display_name').eq('id', ownerId).maybeSingle();
  return data?.display_name ?? 'Unknown';
}

export function toSummary(row: ProjectRow, role: AccessRole, owner: string): CloudProjectSummary {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerName: owner,
    role,
    ...(row.template_id ? { templateId: row.template_id } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    builtUpSqm: row.built_up_sqm,
    rooms: row.rooms,
    bufferedTotal: row.buffered_total,
    currency: row.currency,
    pendingProposals: row.pending_proposals,
  };
}

/**
 * Compare-and-set write of a new document plus an optional history snapshot,
 * in one transaction (public.commit_project). Throws CONFLICT on a stale base.
 */
export async function commit(opts: {
  projectId: string;
  baseVersion: number;
  data: Project;
  name?: string;
  authorId: string;
  reason?: VersionReason;
}): Promise<{ version: number; summary: Summary }> {
  const summary = summarize(opts.data);
  const { data, error } = await admin().rpc('commit_project', {
    p_project_id: opts.projectId,
    p_base_version: opts.baseVersion,
    p_data: opts.data,
    p_name: opts.name ?? null,
    p_summary: summary,
    p_author_id: opts.authorId,
    p_reason: opts.reason ?? null,
  });
  if (error) throw error;
  if (data === null) throw notFound();
  const v = data as number;
  if (v < 0) throw conflict(-v);
  return { version: v, summary };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

export async function toMember(projectId: string, userId: string, withEmail: boolean): Promise<ProjectMember> {
  const db = admin();
  const { data: m, error } = await db
    .from('project_members')
    .select('user_id, role, added_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  const { data: p } = await db.from('profiles').select('display_name, avatar_color').eq('id', userId).single();
  let email: string | undefined;
  if (withEmail) {
    const { data: u } = await db.auth.admin.getUserById(userId);
    email = u.user?.email ?? undefined;
  }
  return {
    userId,
    displayName: p?.display_name ?? 'Unknown',
    avatarColor: p?.avatar_color ?? '#6B6460',
    ...(email ? { email } : {}),
    role: m.role as MemberRole,
    addedAt: m.added_at,
  };
}

export function toInvite(row: Record<string, unknown>): ProjectInvite {
  return {
    id: row.id as string,
    email: row.email as string,
    role: row.role as MemberRole,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    ...(row.accepted_at ? { acceptedAt: row.accepted_at as string } : {}),
  };
}

export function toShareLink(row: Record<string, unknown>): ShareLink {
  return {
    token: row.token as string,
    role: row.role as ShareLink['role'],
    createdAt: row.created_at as string,
    ...(row.expires_at ? { expiresAt: row.expires_at as string } : {}),
    revoked: row.revoked as boolean,
  };
}

export { Fail };
