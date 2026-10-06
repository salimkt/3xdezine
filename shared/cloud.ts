/**
 * 3xDezine — cloud contract.
 *
 * Shapes exchanged between the clients (web, later Android) and the Supabase
 * backend in `supabase/`. Types only, no runtime code, so importing this file
 * never pulls the Supabase SDK into a bundle.
 *
 * Security model, in one paragraph: clients may READ through PostgREST, where
 * row-level security limits them to projects they own or are a member of.
 * Clients may NOT insert or update `projects` rows directly. Every write goes
 * through an Edge Function listed in `CLOUD_FUNCTIONS`, which authenticates
 * the caller, resolves their role on the project, and runs the same
 * `shared/rules.ts` engine the editor uses. So a FINISHES collaborator calling
 * the API by hand still cannot move a wall.
 */

import type { EditLevel, EditProposal, Project, RuleViolation } from './types.ts';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserPreferences {
  /** Show areas in sq ft alongside m² (Indian trade convention). */
  showSqft: boolean;
  /** Default time of day for the sun, 6–19. */
  defaultHour: number;
}

export interface Profile {
  id: string;
  displayName: string;
  /** Hex colour for the avatar initial chip; no image uploads. */
  avatarColor: string;
  preferences: UserPreferences;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Projects and access
// ---------------------------------------------------------------------------

/**
 * A member's role IS an EditLevel, so the existing policy UI and rules engine
 * apply unchanged. The owner is implicitly FULL. A member's effective level is
 * min(role, project.policy.level) — the owner can tighten a whole project.
 */
export type MemberRole = EditLevel;
export type AccessRole = MemberRole | 'OWNER';

export interface CloudProjectSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  /** The caller's access to this project. */
  role: AccessRole;
  templateId?: string;
  /** Monotonic; incremented on every successful save. Used for conflict detection. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Denormalised for the projects grid, computed server-side on save. */
  builtUpSqm: number;
  rooms: number;
  bufferedTotal: number;
  currency: string;
  pendingProposals: number;
}

export interface CloudProject extends CloudProjectSummary {
  data: Project;
}

export interface ProjectMember {
  userId: string;
  displayName: string;
  avatarColor: string;
  /** Present only when the caller is the owner. */
  email?: string;
  role: MemberRole;
  addedAt: string;
}

export interface ProjectInvite {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  /** Present on rows read from `my_invites` (the invitee can't read the project yet). */
  projectId?: string;
  projectName?: string;
  invitedByName?: string;
}

/** Link sharing is deliberately capped at FINISHES: geometry needs a named member. */
export type LinkRole = 'VIEW' | 'FINISHES';

export interface ShareLink {
  token: string;
  role: LinkRole;
  createdAt: string;
  expiresAt?: string;
  revoked: boolean;
}

export type VersionReason = 'CREATE' | 'SAVE' | 'PROPOSAL_ACCEPTED' | 'RESTORE';

export interface ProjectVersion {
  id: string;
  version: number;
  authorId: string;
  authorName: string;
  reason: VersionReason;
  createdAt: string;
  summary: { rooms: number; builtUpSqm: number; bufferedTotal: number };
}

// ---------------------------------------------------------------------------
// Edge Functions — POST JSON with `Authorization: Bearer <access token>`
// (except openShareLink, which also works signed out).
// ---------------------------------------------------------------------------

export const CLOUD_FUNCTIONS = {
  createProject: 'create-project',
  saveProject: 'save-project',
  deleteProject: 'delete-project',
  submitProposal: 'submit-proposal',
  reviewProposal: 'review-proposal',
  inviteMember: 'invite-member',
  acceptInvite: 'accept-invite',
  setMemberRole: 'set-member-role',
  removeMember: 'remove-member',
  createShareLink: 'create-share-link',
  revokeShareLink: 'revoke-share-link',
  openShareLink: 'open-share-link',
  restoreVersion: 'restore-version',
} as const;

/**
 * Every function returns either its success payload or this. Errors are sent
 * with a matching HTTP status (UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND
 * 404, CONFLICT 409, INVALID 400, INTERNAL 500) and this JSON body — with
 * supabase-js `functions.invoke`, read it from `await error.context.json()`.
 */
export interface CloudError {
  ok: false;
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'INTERNAL';
  /** Plain-language, safe to show to the user. */
  message: string;
  /** For FORBIDDEN edits: the rules engine's reasons. */
  violations?: RuleViolation[];
  /** For CONFLICT: the version now stored, so the client can reload or merge. */
  currentVersion?: number;
}

export interface CreateProjectRequest { name: string; data: Project; templateId?: string }
export interface CreateProjectResponse { ok: true; project: CloudProjectSummary }

/**
 * Optimistic concurrency: rejected with CONFLICT unless `baseVersion` equals
 * the stored version. The server diffs `data` against the stored document and
 * refuses changes beyond the caller's effective level:
 *   VIEW      nothing
 *   FINISHES  material/component ids only — any geometry change is FORBIDDEN
 *   LAYOUT    as the rules engine's checkEdit at LAYOUT (envelope + locked walls fixed)
 *   FULL/OWNER anything, including policy; only OWNER may change `policy`
 * Saves that introduce new rule ERRORs are refused; WARNINGs are allowed.
 */
export interface SaveProjectRequest { projectId: string; data: Project; baseVersion: number; name?: string }
export interface SaveProjectResponse { ok: true; version: number; summary: CloudProjectSummary }

export interface DeleteProjectRequest { projectId: string }
export interface DeleteProjectResponse { ok: true }

/** Any member at FINISHES or above may propose; the author is the caller, never a client-supplied name. */
export interface SubmitProposalRequest { projectId: string; edits: EditProposal['edits']; note?: string; baseVersion: number }
export interface SubmitProposalResponse { ok: true; proposal: EditProposal; version: number }

/** OWNER or FULL only. Accepting applies the edits, re-validates and snapshots a version. */
export interface ReviewProposalRequest { projectId: string; proposalId: string; decision: 'ACCEPT' | 'REJECT'; baseVersion: number }
export interface ReviewProposalResponse { ok: true; version: number; data: Project }

export interface InviteMemberRequest { projectId: string; email: string; role: MemberRole }
export interface InviteMemberResponse { ok: true; invite: ProjectInvite; /** Present when the email already has an account and was added directly. */ member?: ProjectMember }

export interface AcceptInviteRequest { inviteId: string }
export interface AcceptInviteResponse { ok: true; projectId: string; role: MemberRole }

export interface SetMemberRoleRequest { projectId: string; userId: string; role: MemberRole }
export interface SetMemberRoleResponse { ok: true; member: ProjectMember }

export interface RemoveMemberRequest { projectId: string; userId: string }
export interface RemoveMemberResponse { ok: true }

export interface CreateShareLinkRequest { projectId: string; role: LinkRole; expiresInDays?: number }
export interface CreateShareLinkResponse { ok: true; link: ShareLink }

export interface RevokeShareLinkRequest { projectId: string; token: string }
export interface RevokeShareLinkResponse { ok: true }

/** Works signed out. Signed-in callers get the link's role recorded as a membership if they choose to join. */
export interface OpenShareLinkRequest { token: string; join?: boolean }
export interface OpenShareLinkResponse { ok: true; project: CloudProject; role: LinkRole }

/** OWNER or FULL. Restoring creates a new version rather than rewriting history. */
export interface RestoreVersionRequest { projectId: string; versionId: string; baseVersion: number }
export interface RestoreVersionResponse { ok: true; version: number; data: Project }

// ---------------------------------------------------------------------------
// Reads — PostgREST, row-level security applies
// ---------------------------------------------------------------------------

/**
 * Views/tables clients read directly (snake_case columns in SQL; clients map
 * them to the camelCase interfaces above):
 *   profiles              own row read/write; others' display_name/avatar via project_member_profiles
 *   my_projects           CloudProjectSummary for every project the caller owns or belongs to
 *   projects              full row incl. data, readable by owner and members
 *   project_member_profiles  ProjectMember rows for projects the caller can read
 *   project_invites       owner only
 *   share_links           owner only
 *   project_versions      ProjectVersion rows (+ data on demand) for readable projects
 *   my_invites            pending invites addressed to the caller's email
 */
export const CLOUD_READS = [
  'profiles',
  'my_projects',
  'projects',
  'project_member_profiles',
  'project_invites',
  'share_links',
  'project_versions',
  'my_invites',
] as const;
