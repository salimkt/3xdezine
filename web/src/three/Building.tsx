import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Catalog, Floor, Material, Opening, Room, Wall } from '@shared/types';
import {
  buildCeilingGeometry,
  buildFloorGeometry,
  buildWallGeometry,
  interiorOnPositiveSide,
  placeOpening,
  polygonCentroid,
  wallAngle,
} from '../lib/geometry';
import {
  getMaterial,
  getSimpleMaterial,
  pruneMaterialCache,
  type TextureManifest,
} from '../lib/materials';
import { useStore } from '../store';
import { useDisplayProject } from '../lib/checks';
import { introProgress, phase } from '../lib/intro';
import { OpeningFill, PlacedGeometry } from './Parametric';

type GroupRegistry = Map<string, THREE.Group>;
const register = (registry: GroupRegistry, id: string) => (group: THREE.Group | null) => {
  if (group) registry.set(id, group);
  else registry.delete(id);
};

function byId(catalog: Catalog): Map<string, Material> {
  return new Map(catalog.materials.map((m) => [m.id, m]));
}

// ---------------------------------------------------------------------------
// Selection outline
// ---------------------------------------------------------------------------

function Outline({ geometry, visible }: { geometry: THREE.BufferGeometry; visible: boolean }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 25), [geometry]);
  useEffect(() => () => edges.dispose(), [edges]);
  if (!visible) return null;
  return (
    <lineSegments geometry={edges} renderOrder={999}>
      <lineBasicMaterial color="#6EE7F2" depthTest={false} transparent opacity={0.95} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// Wall
// ---------------------------------------------------------------------------

function WallMesh({
  wall,
  openings,
  rooms,
  materials,
  manifest,
  selected,
  registry,
}: {
  wall: Wall;
  openings: Opening[];
  rooms: Room[];
  materials: Map<string, Material>;
  manifest: TextureManifest;
  selected: boolean;
  registry: GroupRegistry;
}) {
  const select = useStore((s) => s.select);

  const geometry = useMemo(() => buildWallGeometry(wall, openings), [wall, openings]);
  const interiorFirst = useMemo(() => interiorOnPositiveSide(wall, rooms), [wall, rooms]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const meshMaterials = useMemo(() => {
    const interior = getMaterial(
      wall.interiorMaterialId ? materials.get(wall.interiorMaterialId) : undefined,
      manifest,
    );
    const exterior = wall.exterior
      ? getMaterial(
          wall.exteriorMaterialId ? materials.get(wall.exteriorMaterialId) : undefined,
          manifest,
        )
      : interior;
    // The reveals around an opening are plaster returns: take the interior finish.
    const reveal = interior;
    return interiorFirst ? [interior, exterior, reveal] : [exterior, interior, reveal];
  }, [wall, materials, manifest, interiorFirst]);

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    select('wall', wall.id);
  };

  return (
    <group
      ref={register(registry, wall.id)}
      position={[wall.start.x, 0, wall.start.z]}
      rotation={[0, wallAngle(wall), 0]}
    >
      <mesh
        geometry={geometry}
        material={meshMaterials}
        castShadow
        receiveShadow
        onClick={onClick}
      />
      <Outline geometry={geometry} visible={selected} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Room slabs
// ---------------------------------------------------------------------------

function RoomMeshes({
  room,
  materials,
  manifest,
  selected,
  showCeiling,
  registry,
}: {
  room: Room;
  materials: Map<string, Material>;
  manifest: TextureManifest;
  selected: boolean;
  showCeiling: boolean;
  registry: GroupRegistry;
}) {
  const select = useStore((s) => s.select);
  const setSurfaceTarget = useStore((s) => s.setSurfaceTarget);

  const floorGeometry = useMemo(() => buildFloorGeometry(room), [room]);
  const ceilingGeometry = useMemo(() => buildCeilingGeometry(room), [room]);
  useEffect(
    () => () => {
      floorGeometry.dispose();
      ceilingGeometry.dispose();
    },
    [floorGeometry, ceilingGeometry],
  );

  const floorMaterial = getMaterial(
    room.floorMaterialId ? materials.get(room.floorMaterialId) : undefined,
    manifest,
  );
  const ceilingMaterial = getMaterial(
    room.ceilingMaterialId ? materials.get(room.ceilingMaterialId) : undefined,
    manifest,
  );

  return (
    <group ref={register(registry, room.id)}>
      <mesh
        geometry={floorGeometry}
        material={floorMaterial}
        receiveShadow
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          select('room', room.id);
          setSurfaceTarget('FLOOR');
        }}
      />
      {showCeiling && (
        <mesh
          geometry={ceilingGeometry}
          material={ceilingMaterial}
          receiveShadow
          onClick={(event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            select('room', room.id);
            setSurfaceTarget('CEILING');
          }}
        />
      )}
      {selected && <Outline geometry={floorGeometry} visible />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Whole floor
// ---------------------------------------------------------------------------

/**
 * Drives the build-up intro: slabs rise through the ground plane, walls grow
 * from the slab in a ripple outward from the plan centre, fittings follow.
 * Scales only — no material changes, so nothing recompiles mid-animation and
 * every object still writes correct velocity for TRAA.
 */
function useBuildUp(floor: Floor | undefined, walls: GroupRegistry, rooms: GroupRegistry, fixtures: React.RefObject<THREE.Group | null>) {
  const settled = useRef(true);
  const delays = useMemo(() => {
    const map = new Map<string, number>();
    if (!floor) return map;
    const xs = floor.rooms.flatMap((r) => r.polygon.map((p) => p.x));
    const zs = floor.rooms.flatMap((r) => r.polygon.map((p) => p.z));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const dist = floor.walls.map((w) => Math.hypot((w.start.x + w.end.x) / 2 - cx, (w.start.z + w.end.z) / 2 - cz));
    const max = Math.max(1e-3, ...dist);
    floor.walls.forEach((w, i) => map.set(w.id, 0.1 + (dist[i] / max) * 0.32));
    return map;
  }, [floor]);

  useFrame(() => {
    const raw = introProgress(performance.now());
    if (raw >= 1 && settled.current) return;
    settled.current = raw >= 1;
    for (const group of rooms.values()) {
      const s = phase(raw, 0, 0.32);
      group.position.y = -0.14 * (1 - s);
    }
    for (const [id, group] of walls) {
      const d = delays.get(id) ?? 0.2;
      group.scale.y = Math.max(0.001, phase(raw, d, d + 0.42));
    }
    if (fixtures.current) fixtures.current.scale.y = Math.max(0.001, phase(raw, 0.55, 1));
  });
}

export function Building({ manifest }: { manifest: TextureManifest }) {
  const project = useDisplayProject();
  const catalog = useStore((s) => s.catalog);
  const selection = useStore((s) => s.selection);
  const showCeilings = useStore((s) => s.render.showCeilings);

  const floor: Floor | undefined = project.floors[0];
  const materials = useMemo(() => byId(catalog), [catalog]);
  const components = useMemo(
    () => new Map(catalog.components.map((c) => [c.id, c])),
    [catalog],
  );

  const openingsByWall = useMemo(() => {
    const map = new Map<string, Opening[]>();
    for (const opening of floor?.openings ?? []) {
      const list = map.get(opening.wallId);
      if (list) list.push(opening);
      else map.set(opening.wallId, [opening]);
    }
    return map;
  }, [floor]);

  // Drop textures for materials no surface references any more. Texture VRAM,
  // not triangles, is what kills this app.
  useEffect(() => {
    if (!floor) return;
    const live = new Set<string>();
    for (const room of floor.rooms) {
      live.add(room.floorMaterialId ?? '__unassigned__');
      live.add(room.ceilingMaterialId ?? '__unassigned__');
    }
    for (const wall of floor.walls) {
      live.add(wall.interiorMaterialId ?? '__unassigned__');
      if (wall.exteriorMaterialId) live.add(wall.exteriorMaterialId);
    }
    if (project.roof?.materialId) live.add(project.roof.materialId);
    pruneMaterialCache(live);
  }, [floor, project.roof?.materialId]);

  const wallGroups = useRef<GroupRegistry>(new Map()).current;
  const roomGroups = useRef<GroupRegistry>(new Map()).current;
  const fixtures = useRef<THREE.Group>(null);
  useBuildUp(floor, wallGroups, roomGroups, fixtures);

  if (!floor) return null;

  const ceilingHeight = floor.rooms[0]?.ceilingHeightM ?? 2.7;

  return (
    <group>
      {floor.rooms.map((room) => (
        <RoomMeshes
          key={room.id}
          room={room}
          materials={materials}
          manifest={manifest}
          showCeiling={showCeilings}
          selected={selection.kind === 'room' && selection.id === room.id}
          registry={roomGroups}
        />
      ))}

      {floor.walls.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          openings={openingsByWall.get(wall.id) ?? []}
          rooms={floor.rooms}
          materials={materials}
          manifest={manifest}
          selected={selection.kind === 'wall' && selection.id === wall.id}
          registry={wallGroups}
        />
      ))}

      <group ref={fixtures}>
      {floor.openings.map((opening) => {
        const wall = floor.walls.find((w) => w.id === opening.wallId);
        if (!wall || !opening.componentId) return null;
        const placement = placeOpening(wall, opening);
        return (
          <group
            key={opening.id}
            position={placement.position}
            rotation={[0, placement.rotationY, 0]}
          >
            <OpeningFill component={components.get(opening.componentId)} opening={opening} />
          </group>
        );
      })}

      {floor.components.map((placed) => {
        const component = components.get(placed.componentId);
        if (!component) return null;
        const room = floor.rooms.find((r) =>
          r.polygon.length ? pointInside(placed.position, r) : false,
        );
        return (
          <group
            key={placed.id}
            position={[placed.position.x, 0, placed.position.z]}
            rotation={[0, (-placed.rotationDeg * Math.PI) / 180, 0]}
          >
            <PlacedGeometry
              component={component}
              ceilingHeight={room?.ceilingHeightM ?? ceilingHeight}
            />
          </group>
        );
      })}
      </group>
    </group>
  );
}

function pointInside(point: { x: number; z: number }, room: Room): boolean {
  const c = polygonCentroid(room.polygon);
  // Cheap containment for placement lookup; centroid distance is enough to pick
  // the owning room for a ceiling height.
  let inside = false;
  const polygon = room.polygon;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside || (Math.abs(c.x - point.x) < 0.001 && Math.abs(c.z - point.z) < 0.001);
}

/** A large matte ground plane so the building is not floating in a void. */
export function Ground() {
  const material = getSimpleMaterial('#2A2C30', 0.95, 0);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow material={material}>
      <planeGeometry args={[400, 400]} />
    </mesh>
  );
}
