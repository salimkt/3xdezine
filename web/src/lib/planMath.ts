import type { Room, Vec2, Wall } from '@shared/types';

/**
 * The three.js-free half of the plan geometry: pure measurements on the shared
 * data model. Kept apart from `geometry.ts` so the home screen and the plan
 * editor can use it without pulling the renderer into their chunk.
 */

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
}

/**
 * Rotation about +Y that maps the wall's local +X onto its world direction.
 * Ry(θ) sends (1,0,0) to (cosθ, 0, -sinθ), hence the negated z.
 */
export function wallAngle(wall: Wall): number {
  return Math.atan2(-(wall.end.z - wall.start.z), wall.end.x - wall.start.x);
}

/** Unit normal pointing along the wall's local +Z, in world XZ. */
export function wallNormal(wall: Wall): Vec2 {
  const len = wallLength(wall) || 1;
  return { x: -(wall.end.z - wall.start.z) / len, z: (wall.end.x - wall.start.x) / len };
}

export function wallMidpoint(wall: Wall): Vec2 {
  return { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 };
}

export function polygonArea(polygon: Vec2[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of polygon) {
    x += p.x;
    z += p.z;
  }
  return { x: x / polygon.length, z: z / polygon.length };
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * True when the wall's local +Z side faces into a room. Used to decide which
 * extruded cap gets the interior finish and which gets the facade.
 */
export function interiorOnPositiveSide(wall: Wall, rooms: Room[]): boolean {
  const mid = wallMidpoint(wall);
  const n = wallNormal(wall);
  const probe = Math.max(0.25, wall.thicknessM);
  const plus = { x: mid.x + n.x * probe, z: mid.z + n.z * probe };
  const minus = { x: mid.x - n.x * probe, z: mid.z - n.z * probe };
  const inPlus = rooms.some((r) => pointInPolygon(plus, r.polygon));
  const inMinus = rooms.some((r) => pointInPolygon(minus, r.polygon));
  if (inPlus === inMinus) return true; // ambiguous (interior wall): either cap is "inside"
  return inPlus;
}

/** Axis-aligned bounds of the whole floor plate, used to frame the camera. */
export function planBounds(rooms: Room[]): {
  min: Vec2;
  max: Vec2;
  centre: Vec2;
  size: Vec2;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    for (const p of room.polygon) {
      minX = Math.min(minX, p.x);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 10;
    maxZ = 8;
  }
  return {
    min: { x: minX, z: minZ },
    max: { x: maxX, z: maxZ },
    centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, z: maxZ - minZ },
  };
}

/** Walls with an endpoint at `p` (1 cm tolerance, matching MOVE_CORNER). */
export function wallsAtCorner(walls: Wall[], p: Vec2): Wall[] {
  const near = (q: Vec2) => Math.abs(q.x - p.x) < 0.01 && Math.abs(q.z - p.z) < 0.01;
  return walls.filter((w) => near(w.start) || near(w.end));
}
