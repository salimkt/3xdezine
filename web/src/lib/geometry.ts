import * as THREE from 'three/webgpu';
import type { Opening, Room, Vec2, Wall } from '@shared/types';

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

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/**
 * Builds a wall as a real extruded solid with the openings cut out as genuine
 * holes, in wall-local space: +X along the wall from `start`, +Y up, +Z the
 * wall normal. The caller rotates by `wallAngle` and translates to `start`.
 *
 * Thickness is never faked with a plane: thin geometry plus a low sun is the
 * classic source of shadow acne and peter-panning.
 *
 * Material groups come back as [ +Z cap, -Z cap, opening reveals ].
 *
 * Extrude UVs come out in metres, which is exactly what real-world texture
 * tiling wants — the material layer sets `repeat = 1 / tileSizeM`.
 */
export function buildWallGeometry(wall: Wall, openings: Opening[]): THREE.BufferGeometry {
  const len = wallLength(wall);
  const h = wall.heightM;
  const t = wall.thicknessM;

  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(len, 0),
    new THREE.Vector2(len, h),
    new THREE.Vector2(0, h),
  ]);

  for (const opening of openings) {
    const centre = opening.t * len;
    let x0 = centre - opening.widthM / 2;
    let x1 = centre + opening.widthM / 2;
    // Keep a sliver of wall at each end so the cut stays a hole and not a gap;
    // a hole touching the outline degenerates the triangulation.
    const margin = 0.01;
    x0 = Math.max(margin, Math.min(x0, len - margin));
    x1 = Math.max(margin, Math.min(x1, len - margin));
    const y0 = Math.max(margin, opening.sillM);
    const y1 = Math.min(h - margin, opening.sillM + opening.heightM);
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) continue;

    shape.holes.push(
      new THREE.Path([
        new THREE.Vector2(x0, y0),
        new THREE.Vector2(x0, y1),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x1, y0),
      ]),
    );
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -t / 2);

  // ExtrudeGeometry puts both caps in a single material group, so the two faces
  // of a wall cannot be finished differently. Re-index by the cap plane each
  // triangle sits on: +t/2, -t/2, or neither (the reveals around each opening).
  const position = geometry.getAttribute('position');
  const triangleCount = position.count / 3;
  const half = t / 2;
  const eps = 1e-4;
  const plus: number[] = [];
  const minus: number[] = [];
  const side: number[] = [];

  for (let i = 0; i < triangleCount; i++) {
    const z0 = position.getZ(i * 3);
    const z1 = position.getZ(i * 3 + 1);
    const z2 = position.getZ(i * 3 + 2);
    const onPlus =
      Math.abs(z0 - half) < eps && Math.abs(z1 - half) < eps && Math.abs(z2 - half) < eps;
    const onMinus =
      Math.abs(z0 + half) < eps && Math.abs(z1 + half) < eps && Math.abs(z2 + half) < eps;
    if (onPlus) plus.push(i);
    else if (onMinus) minus.push(i);
    else side.push(i);
  }

  const index: number[] = [];
  for (const bucket of [plus, minus, side]) {
    for (const tri of bucket) index.push(tri * 3, tri * 3 + 1, tri * 3 + 2);
  }
  geometry.setIndex(index);
  geometry.clearGroups();
  geometry.addGroup(0, plus.length * 3, 0);
  geometry.addGroup(plus.length * 3, minus.length * 3, 1);
  geometry.addGroup((plus.length + minus.length) * 3, side.length * 3, 2);
  geometry.computeVertexNormals();

  return geometry;
}

// ---------------------------------------------------------------------------
// Floors and ceilings
// ---------------------------------------------------------------------------

function shapeFromPolygon(points: THREE.Vector2[]): THREE.Shape {
  // ShapeGeometry wants a counter-clockwise outline in its own XY plane.
  let signed = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    signed += a.x * b.y - b.x * a.y;
  }
  return new THREE.Shape(signed < 0 ? [...points].reverse() : points);
}

/** Room floor slab, in world XZ at y = 0, facing up. UVs are in metres. */
export function buildFloorGeometry(room: Room): THREE.BufferGeometry {
  // Rx(-90) maps shape (x, y) to world (x, 0, -y), so feed it -z to get z back.
  const shape = shapeFromPolygon(room.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Room ceiling, at the room's ceiling height, facing down. UVs are in metres. */
export function buildCeilingGeometry(room: Room): THREE.BufferGeometry {
  // Rx(+90) maps shape (x, y) to world (x, 0, y).
  const shape = shapeFromPolygon(room.polygon.map((p) => new THREE.Vector2(p.x, p.z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, room.ceilingHeightM, 0);
  return geometry;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

export interface OpeningPlacement {
  position: THREE.Vector3;
  rotationY: number;
  wall: Wall;
}

export function placeOpening(wall: Wall, opening: Opening): OpeningPlacement {
  const len = wallLength(wall);
  const angle = wallAngle(wall);
  const u = opening.t * len;
  const dirX = (wall.end.x - wall.start.x) / (len || 1);
  const dirZ = (wall.end.z - wall.start.z) / (len || 1);
  return {
    position: new THREE.Vector3(
      wall.start.x + dirX * u,
      opening.sillM + opening.heightM / 2,
      wall.start.z + dirZ * u,
    ),
    rotationY: angle,
    wall,
  };
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
