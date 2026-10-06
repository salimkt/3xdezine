// create-share-link — CreateShareLinkRequest -> CreateShareLinkResponse. Owner only.
// Tokens are 32 random bytes (256 bits), base64url. Roles are capped at FINISHES.
import type { CreateShareLinkResponse } from '../_shared/domain/cloud.ts';
import { admin, requireCaller } from '../_shared/auth.ts';
import { invalid, oneOf, serve, uuid } from '../_shared/http.ts';
import { access, requireOwner, toShareLink } from '../_shared/project.ts';

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const projectId = uuid(body, 'projectId');
  const role = oneOf(body, 'role', ['VIEW', 'FINISHES'] as const);
  const days = body.expiresInDays;
  if (days !== undefined && days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365)) {
    throw invalid('`expiresInDays` must be a whole number from 1 to 365.');
  }

  const a = await access(projectId, caller);
  requireOwner(a, 'create share links');
  const { data, error } = await admin()
    .from('share_links')
    .insert({
      token: token(),
      project_id: projectId,
      role,
      created_by: caller.id,
      expires_at: typeof days === 'number' ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    })
    .select('*')
    .single();
  if (error) throw error;
  const res: Omit<CreateShareLinkResponse, 'ok'> = { link: toShareLink(data) };
  return res;
});
