/**
 * Server-side enforcement for save-project: what changed between the stored
 * document and the incoming one, and is the caller allowed to make that change?
 *
 * The client sends whole documents, not PlanEdits, so the server derives the
 * change by diffing entity by entity (floors, walls, rooms, openings and placed
 * components are matched by id) and classifies each difference by the lowest
 * EditLevel allowed to make it:
 *
 *   FINISHES  material ids on walls / rooms / roof; componentId on an opening
 *             or a placed component (swapping a product); project name and
 *             unit system
 *   LAYOUT    everything geometric that the rules engine allows at LAYOUT:
 *             interior walls, rooms (polygons, heights, names), openings,
 *             furniture positions — but never an exterior or locked wall, an
 *             opening on a locked wall, or a corner attached to a protected
 *             wall leaving it (the same refusals as checkEdit/canEditWall)
 *   FULL      the envelope (exterior walls, roof shape, floors), locked walls,
 *             currency, contingency buffer, template id, unknown fields
 *   OWNER     `policy`
 *
 * Then, at every level, the plan may not gain a rule ERROR it didn't already
 * have (validatePlan before vs after); WARNINGs and INFOs are allowed.
 */
import { canEditWall, describeWall, effectivePolicy, validatePlan, CORNER_TOLERANCE_M } from './domain/rules.ts';
import type { EditLevel, EditPolicy, Floor, Project, RuleViolation, Vec2, Wall } from './domain/types.ts';
import { forbidden } from './http.ts';
import { rank } from './project.ts';

interface Change {
  need: EditLevel;
  /** Geometry changes are what `requireReview` routes through proposals. */
  geometry: boolean;
  message: string;
  wallId?: string;
  roomId?: string;
  openingId?: string;
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** Keys of `a` or `b` (excluding `skip`) whose values differ. */
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>, skip: readonly string[] = []): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !skip.includes(k) && !same(a[k], b[k]));
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z) <= CORNER_TOLERANCE_M;

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

const LAYOUT_POLICY = (p: EditPolicy): EditPolicy => ({ ...p, level: 'LAYOUT' });

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const PROJECT_KEYS = ['id', 'name', 'currency', 'unitSystem', 'contingencyBuffer', 'floors', 'roof', 'policy', 'proposals', 'templateId', 'createdAt', 'updatedAt'];
const WALL_GEOMETRY = ['start', 'end', 'heightM', 'thicknessM', 'exterior'];
const WALL_FINISH = ['interiorMaterialId', 'exteriorMaterialId'];
const ROOM_FINISH = ['floorMaterialId', 'ceilingMaterialId'];
const OPENING_FINISH = ['componentId'];

export function diffProjects(before: Project, after: Project): { changes: Change[]; policyChanged: boolean } {
  const changes: Change[] = [];
  const policy = effectivePolicy(before);
  const add = (c: Change) => changes.push(c);

  // --- Project-level fields ---------------------------------------------------
  const policyChanged = !same(before.policy ?? null, after.policy ?? null);
  const top = changedKeys(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
    'id', 'createdAt', 'updatedAt', 'proposals', 'policy', 'floors', 'roof',
  ]);
  for (const key of top) {
    if (key === 'name' || key === 'unitSystem') add({ need: 'FINISHES', geometry: false, message: `Changing the project ${key === 'name' ? 'name' : 'units'}.` });
    else if (key === 'currency' || key === 'contingencyBuffer') {
      add({ need: 'FULL', geometry: false, message: `Only Full access can change the project ${key === 'currency' ? 'currency' : 'contingency buffer'}.` });
    } else if (key === 'templateId') add({ need: 'FULL', geometry: false, message: 'Only Full access can change the template a project came from.' });
    else if (!PROJECT_KEYS.includes(key)) add({ need: 'FULL', geometry: false, message: `Only Full access can change “${key}”.` });
  }

  // --- Roof -------------------------------------------------------------------
  if (!before.roof !== !after.roof) {
    add({ need: 'FULL', geometry: true, message: 'Adding or removing the roof changes the building envelope, which needs Full access.' });
  } else if (before.roof && after.roof) {
    const keys = changedKeys(before.roof as unknown as Record<string, unknown>, after.roof as unknown as Record<string, unknown>);
    for (const k of keys) {
      if (k === 'materialId') add({ need: 'FINISHES', geometry: false, message: 'Changing the roofing material.' });
      else add({ need: 'FULL', geometry: true, message: 'The roof shape is part of the building envelope and needs Full access to change.' });
    }
  }

  // --- Floors -----------------------------------------------------------------
  const floorsBefore = byId(before.floors);
  const floorsAfter = byId(after.floors);
  if (before.floors.length !== floorsBefore.size || after.floors.length !== floorsAfter.size) {
    add({ need: 'FULL', geometry: true, message: 'Two floors share an id.' });
  }
  for (const [id, f] of floorsBefore) {
    if (!floorsAfter.has(id)) add({ need: 'FULL', geometry: true, message: `Removing ${f.name} needs Full access.` });
  }
  for (const [id, f] of floorsAfter) {
    const b = floorsBefore.get(id);
    if (!b) {
      add({ need: 'FULL', geometry: true, message: `Adding a floor (${f.name}) needs Full access.` });
      continue;
    }
    if (b.level !== f.level) add({ need: 'FULL', geometry: true, message: `Changing which level ${b.name} is on needs Full access.` });
    if (b.name !== f.name) add({ need: 'LAYOUT', geometry: false, message: `Renaming ${b.name}.` });
    const extra = changedKeys(b as unknown as Record<string, unknown>, f as unknown as Record<string, unknown>, ['id', 'name', 'level', 'walls', 'rooms', 'openings', 'components']);
    if (extra.length) add({ need: 'FULL', geometry: true, message: `Only Full access can change “${extra[0]}” on ${b.name}.` });
    diffFloor(b, f, policy, add);
  }

  return { changes, policyChanged };
}

function diffFloor(b: Floor, a: Floor, policy: EditPolicy, add: (c: Change) => void): void {
  const layout = LAYOUT_POLICY(policy);
  const isProtected = (w: Wall) => w.exterior || policy.lockedWallIds.includes(w.id);
  const wallReason = (w: Wall) =>
    canEditWall({ name: '', currency: '', unitSystem: 'metric', contingencyBuffer: 0, floors: [b] }, w.id, layout).reason ??
    `${describeWall(b, w)} is locked.`;

  // --- Walls ---------------------------------------------------------------
  const wb = byId(b.walls);
  const wa = byId(a.walls);
  for (const [id, w] of wb) {
    if (wa.has(id)) continue;
    if (isProtected(w)) add({ need: 'FULL', geometry: true, message: wallReason(w), wallId: id });
    else add({ need: 'LAYOUT', geometry: true, message: `Removing ${describeWall(b, w)}.`, wallId: id });
  }
  for (const [id, w] of wa) {
    const old = wb.get(id);
    if (!old) {
      if (w.exterior || policy.lockedWallIds.includes(id)) {
        add({ need: 'FULL', geometry: true, message: 'Adding an exterior wall changes the building envelope, which needs Full access.', wallId: id });
      } else add({ need: 'LAYOUT', geometry: true, message: 'Adding an interior wall.', wallId: id });
      continue;
    }
    const keys = changedKeys(old as unknown as Record<string, unknown>, w as unknown as Record<string, unknown>, ['id']);
    if (keys.some((k) => WALL_FINISH.includes(k))) add({ need: 'FINISHES', geometry: false, message: `Changing the finish on ${describeWall(b, old)}.`, wallId: id });
    const geo = keys.filter((k) => !WALL_FINISH.includes(k));
    if (geo.length === 0) continue;
    if (isProtected(old)) add({ need: 'FULL', geometry: true, message: wallReason(old), wallId: id });
    else if (w.exterior) add({ need: 'FULL', geometry: true, message: `Turning ${describeWall(b, old)} into an exterior wall changes the envelope, which needs Full access.`, wallId: id });
    else if (geo.every((k) => WALL_GEOMETRY.includes(k))) add({ need: 'LAYOUT', geometry: true, message: `Changing ${describeWall(b, old)}.`, wallId: id });
    else add({ need: 'LAYOUT', geometry: true, message: `Changing “${geo[0]}” on ${describeWall(b, old)}.`, wallId: id });
  }

  // --- Corners attached to protected walls (checkEdit's junction rule) -------
  // A point that sits on a protected wall's END is a corner of that wall and
  // may not move at all below FULL; one part-way ALONG it may slide along it
  // but not leave it.
  const prot = b.walls.filter(isProtected);
  const constraint = (p: Vec2): { wall: Wall; atEnd: boolean } | undefined => {
    for (const w of prot) if (near(p, w.start) || near(p, w.end)) return { wall: w, atEnd: true };
    for (const w of prot) if (distToSegment(p, w.start, w.end) <= CORNER_TOLERANCE_M) return { wall: w, atEnd: false };
    return undefined;
  };
  const satisfied = (c: { wall: Wall; atEnd: boolean }, from: Vec2, to: Vec2) =>
    c.atEnd ? near(from, to) : distToSegment(to, c.wall.start, c.wall.end) <= CORNER_TOLERANCE_M;
  const pointMsg = (c: { wall: Wall; atEnd: boolean }) =>
    c.atEnd
      ? `${cap(wallReason(c.wall))} Its corners can’t move either.`
      : `A corner sits on ${describeWall(b, c.wall)}, which is locked at Layout level — it can slide along that wall but not away from it.`;

  for (const [id, w] of wa) {
    const old = wb.get(id);
    if (!old || isProtected(old)) continue;
    for (const end of ['start', 'end'] as const) {
      const c = constraint(old[end]);
      if (c && !satisfied(c, old[end], w[end])) add({ need: 'FULL', geometry: true, message: pointMsg(c), wallId: c.wall.id });
    }
  }

  // --- Rooms ---------------------------------------------------------------
  const rb = byId(b.rooms);
  const ra = byId(a.rooms);
  for (const [id, r] of rb) if (!ra.has(id)) add({ need: 'LAYOUT', geometry: true, message: `Removing ${r.name}.`, roomId: id });
  for (const [id, r] of ra) {
    const old = rb.get(id);
    if (!old) {
      add({ need: 'LAYOUT', geometry: true, message: `Adding ${r.name}.`, roomId: id });
      continue;
    }
    const keys = changedKeys(old as unknown as Record<string, unknown>, r as unknown as Record<string, unknown>, ['id']);
    if (keys.some((k) => ROOM_FINISH.includes(k))) add({ need: 'FINISHES', geometry: false, message: `Changing finishes in ${old.name}.`, roomId: id });
    if (keys.includes('name')) add({ need: 'LAYOUT', geometry: false, message: `Renaming ${old.name} (room names drive the size rules).`, roomId: id });
    const geo = keys.filter((k) => !ROOM_FINISH.includes(k) && k !== 'name');
    if (geo.length) add({ need: 'LAYOUT', geometry: true, message: `Reshaping ${old.name}.`, roomId: id });
    if (!keys.includes('polygon')) continue;
    if (old.polygon.length === r.polygon.length) {
      old.polygon.forEach((p, i) => {
        const c = constraint(p);
        if (c && !satisfied(c, p, r.polygon[i])) add({ need: 'FULL', geometry: true, message: pointMsg(c), wallId: c.wall.id, roomId: id });
      });
    } else {
      for (const p of old.polygon) {
        const c = constraint(p);
        if (c && !r.polygon.some((q) => satisfied(c, p, q))) add({ need: 'FULL', geometry: true, message: pointMsg(c), wallId: c.wall.id, roomId: id });
      }
    }
  }

  // --- Openings --------------------------------------------------------------
  const lockedHost = (wallId: string) => policy.lockedWallIds.includes(wallId);
  const lockedMsg = (wallId: string) => {
    const w = wb.get(wallId) ?? wa.get(wallId);
    return `${cap(w ? describeWall(b, w) : 'That wall')} is locked as load-bearing; its doors and windows can only be changed with Full access.`;
  };
  const ob = byId(b.openings);
  const oa = byId(a.openings);
  for (const [id, o] of ob) {
    if (oa.has(id)) continue;
    if (lockedHost(o.wallId)) add({ need: 'FULL', geometry: true, message: lockedMsg(o.wallId), openingId: id });
    else add({ need: 'LAYOUT', geometry: true, message: 'Removing an opening.', openingId: id });
  }
  for (const [id, o] of oa) {
    const old = ob.get(id);
    if (!old) {
      if (lockedHost(o.wallId)) add({ need: 'FULL', geometry: true, message: lockedMsg(o.wallId), openingId: id });
      else add({ need: 'LAYOUT', geometry: true, message: 'Adding an opening.', openingId: id });
      continue;
    }
    const keys = changedKeys(old as unknown as Record<string, unknown>, o as unknown as Record<string, unknown>, ['id']);
    if (keys.some((k) => OPENING_FINISH.includes(k))) add({ need: 'FINISHES', geometry: false, message: 'Swapping a door or window product.', openingId: id });
    const geo = keys.filter((k) => !OPENING_FINISH.includes(k));
    if (!geo.length) continue;
    if (lockedHost(old.wallId) || lockedHost(o.wallId)) add({ need: 'FULL', geometry: true, message: lockedMsg(lockedHost(old.wallId) ? old.wallId : o.wallId), openingId: id });
    else add({ need: 'LAYOUT', geometry: true, message: 'Moving or resizing an opening.', openingId: id });
  }

  // --- Placed components (furniture, lights) ---------------------------------
  const cb = byId(b.components);
  const ca = byId(a.components);
  for (const id of cb.keys()) if (!ca.has(id)) add({ need: 'LAYOUT', geometry: true, message: 'Removing a placed item.' });
  for (const [id, c] of ca) {
    const old = cb.get(id);
    if (!old) {
      add({ need: 'LAYOUT', geometry: true, message: 'Placing a new item.' });
      continue;
    }
    const keys = changedKeys(old as unknown as Record<string, unknown>, c as unknown as Record<string, unknown>, ['id']);
    if (keys.includes('componentId')) add({ need: 'FINISHES', geometry: false, message: 'Swapping a placed product.' });
    if (keys.some((k) => k !== 'componentId')) add({ need: 'LAYOUT', geometry: true, message: 'Moving a placed item.' });
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Rule checks
// ---------------------------------------------------------------------------

const violationKey = (v: RuleViolation) => `${v.ruleId}|${v.roomId ?? ''}|${v.wallId ?? ''}|${v.openingId ?? ''}`;

/** ERRORs in `after` that `before` didn't have (same identity rule as the rules engine). */
export function newErrors(before: Project, after: Project): RuleViolation[] {
  const seen = new Set(validatePlan(before).map(violationKey));
  return validatePlan(after).filter((v) => v.severity === 'ERROR' && !seen.has(violationKey(v)));
}

export function refuseNewErrors(before: Project, after: Project, verb = 'save'): void {
  const errors = newErrors(before, after);
  if (errors.length) {
    throw forbidden(
      `Can’t ${verb} this: it would break ${errors.length === 1 ? 'a plan rule' : `${errors.length} plan rules`} — ${errors[0].message}`,
      errors,
    );
  }
}

// ---------------------------------------------------------------------------
// The save check
// ---------------------------------------------------------------------------

const asViolation = (c: Change): RuleViolation => ({
  /** access.requires-finishes | access.requires-layout | access.requires-full */
  ruleId: `access.requires-${c.need.toLowerCase()}`,
  severity: 'ERROR',
  message: c.message,
  ...(c.wallId ? { wallId: c.wallId } : {}),
  ...(c.roomId ? { roomId: c.roomId } : {}),
  ...(c.openingId ? { openingId: c.openingId } : {}),
});

/**
 * Throws FORBIDDEN unless the caller at `level` may turn `before` into
 * `after`. `before` is the stored document; `after` already carries the
 * stored proposals (they are server-owned).
 */
export function enforceSave(before: Project, after: Project, caller: { level: EditLevel; isOwner: boolean; isFullMember: boolean }): void {
  if (caller.level === 'VIEW') throw forbidden('You have view-only access to this project, so it can’t be saved.');

  const { changes, policyChanged } = diffProjects(before, after);
  if (policyChanged && !caller.isOwner) {
    throw forbidden('Only the project owner can change who may edit what.', [
      { ruleId: 'access.owner-only', severity: 'ERROR', message: 'Only the project owner can change the edit policy.' },
    ]);
  }

  const beyond = changes.filter((c) => rank(c.need) > rank(caller.level));
  if (beyond.length) {
    const headline =
      caller.level === 'FINISHES'
        ? 'At Finishes level only materials can change; walls, rooms and openings are locked.'
        : beyond[0].message;
    throw forbidden(headline, dedupe(beyond.map(asViolation)));
  }

  // requireReview: below Full, geometry goes through proposals.
  if (!caller.isOwner && !caller.isFullMember && effectivePolicy(before).requireReview && changes.some((c) => c.geometry)) {
    throw forbidden('Layout changes on this project need the owner’s review — submit them as a proposal instead.', [
      { ruleId: 'access.review-required', severity: 'ERROR', message: 'This project requires review for layout changes.' },
    ]);
  }

  refuseNewErrors(before, after);
}

function dedupe(list: RuleViolation[]): RuleViolation[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const k = `${v.message}|${violationKey(v)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
