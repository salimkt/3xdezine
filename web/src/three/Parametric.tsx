import * as THREE from 'three/webgpu';
import { useMemo } from 'react';
import type { ComponentProduct, Opening } from '@shared/types';
import { getGlassMaterial, getSimpleMaterial } from '../lib/materials';

/**
 * Parametric stand-ins for catalog components, dispatched on `modelKind`.
 * Authored glTF is the roadmap; a boxy sofa that is the right size in the right
 * place reads far better than an empty room.
 */

const FRAME = 0.06;

function Box(props: {
  size: [number, number, number];
  position?: [number, number, number];
  material: THREE.Material;
  rotation?: [number, number, number];
}) {
  return (
    <mesh
      position={props.position}
      rotation={props.rotation}
      material={props.material}
      castShadow
      receiveShadow
    >
      <boxGeometry args={props.size} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

function DoorSlab({
  width,
  height,
  depth,
  hex,
  panelled,
}: {
  width: number;
  height: number;
  depth: number;
  hex: string;
  panelled: boolean;
}) {
  const leaf = getSimpleMaterial(hex, 0.45, 0);
  const hardware = getSimpleMaterial('#B9A88A', 0.28, 0.85);
  // Hinged slightly ajar so the eye reads it as a door, not a filled hole.
  const swing = -0.26;
  return (
    <group position={[-width / 2, 0, 0]} rotation={[0, swing, 0]}>
      <group position={[width / 2, 0, 0]}>
        <Box size={[width, height, depth]} material={leaf} />
        {panelled && (
          <>
            <Box
              size={[width * 0.62, height * 0.3, depth * 0.4]}
              position={[0, height * 0.24, depth * 0.6]}
              material={getSimpleMaterial(hex, 0.5, 0)}
            />
            <Box
              size={[width * 0.62, height * 0.34, depth * 0.4]}
              position={[0, -height * 0.18, depth * 0.6]}
              material={getSimpleMaterial(hex, 0.5, 0)}
            />
          </>
        )}
        <mesh position={[width * 0.38, 0, depth * 1.2]} material={hardware} castShadow>
          <sphereGeometry args={[0.035, 16, 12]} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function WindowUnit({
  width,
  height,
  depth,
  hex,
  mullionsX,
  mullionsY,
}: {
  width: number;
  height: number;
  depth: number;
  hex: string;
  mullionsX: number;
  mullionsY: number;
}) {
  const frame = getSimpleMaterial(hex, 0.4, 0.05);
  const glass = getGlassMaterial();
  const bars = useMemo(() => {
    const out: Array<{ size: [number, number, number]; position: [number, number, number] }> = [];
    for (let i = 1; i <= mullionsX; i++) {
      const x = -width / 2 + (width * i) / (mullionsX + 1);
      out.push({ size: [FRAME * 0.6, height - FRAME * 2, depth * 0.7], position: [x, 0, 0] });
    }
    for (let i = 1; i <= mullionsY; i++) {
      const y = -height / 2 + (height * i) / (mullionsY + 1);
      out.push({ size: [width - FRAME * 2, FRAME * 0.6, depth * 0.7], position: [0, y, 0] });
    }
    return out;
  }, [width, height, depth, mullionsX, mullionsY]);

  return (
    <group>
      <Box size={[width, FRAME, depth]} position={[0, height / 2 - FRAME / 2, 0]} material={frame} />
      <Box
        size={[width, FRAME, depth]}
        position={[0, -height / 2 + FRAME / 2, 0]}
        material={frame}
      />
      <Box
        size={[FRAME, height - FRAME * 2, depth]}
        position={[-width / 2 + FRAME / 2, 0, 0]}
        material={frame}
      />
      <Box
        size={[FRAME, height - FRAME * 2, depth]}
        position={[width / 2 - FRAME / 2, 0, 0]}
        material={frame}
      />
      {bars.map((bar, i) => (
        <Box key={i} size={bar.size} position={bar.position} material={frame} />
      ))}
      <mesh material={glass}>
        <planeGeometry args={[width - FRAME * 2, height - FRAME * 2]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Furniture and lighting
// ---------------------------------------------------------------------------

function Sofa({ width, height, depth, hex }: { width: number; height: number; depth: number; hex: string }) {
  const body = getSimpleMaterial(hex, 0.92, 0);
  const cushion = getSimpleMaterial(hex, 0.98, 0);
  const leg = getSimpleMaterial('#3A2F27', 0.5, 0);
  const seatH = height * 0.42;
  const seats = 3;
  return (
    <group>
      <Box size={[width, seatH, depth]} position={[0, seatH / 2 + 0.12, 0]} material={body} />
      <Box
        size={[width, height * 0.72, depth * 0.22]}
        position={[0, height * 0.36 + 0.12, -depth / 2 + depth * 0.11]}
        material={body}
      />
      <Box
        size={[depth * 0.18, height * 0.55, depth]}
        position={[-width / 2 + depth * 0.09, height * 0.28 + 0.12, 0]}
        material={body}
      />
      <Box
        size={[depth * 0.18, height * 0.55, depth]}
        position={[width / 2 - depth * 0.09, height * 0.28 + 0.12, 0]}
        material={body}
      />
      {Array.from({ length: seats }, (_, i) => {
        const inner = width - depth * 0.36;
        const w = inner / seats - 0.02;
        const x = -inner / 2 + w / 2 + i * (inner / seats);
        return (
          <Box
            key={i}
            size={[w, 0.12, depth * 0.72]}
            position={[x, seatH + 0.18, depth * 0.06]}
            material={cushion}
          />
        );
      })}
      {[
        [-width / 2 + 0.12, depth / 2 - 0.12],
        [width / 2 - 0.12, depth / 2 - 0.12],
        [-width / 2 + 0.12, -depth / 2 + 0.12],
        [width / 2 - 0.12, -depth / 2 + 0.12],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.06, 0.12, 0.06]} position={[x, 0.06, z]} material={leg} />
      ))}
    </group>
  );
}

function Pendant({
  width,
  height,
  ceilingHeight,
  hex,
}: {
  width: number;
  height: number;
  ceilingHeight: number;
  hex: string;
}) {
  const shade = getSimpleMaterial(hex, 0.35, 0.6);
  const cordLength = Math.max(0.2, ceilingHeight - 1.95);
  const bulb = useMemo(() => {
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.color = new THREE.Color('#FFE3B8');
    m.emissive = new THREE.Color('#FFD9A0');
    m.emissiveIntensity = 6;
    m.roughness = 0.4;
    return m;
  }, []);
  return (
    <group position={[0, ceilingHeight, 0]}>
      <mesh position={[0, -cordLength / 2, 0]} material={shade}>
        <cylinderGeometry args={[0.008, 0.008, cordLength, 8]} />
      </mesh>
      <mesh position={[0, -cordLength - height / 2, 0]} material={shade} castShadow>
        <coneGeometry args={[width / 2, height, 24, 1, true]} />
      </mesh>
      <mesh position={[0, -cordLength - height * 0.85, 0]} material={bulb}>
        <sphereGeometry args={[0.045, 16, 12]} />
      </mesh>
      <pointLight
        position={[0, -cordLength - height, 0]}
        intensity={6}
        distance={7}
        decay={2}
        color="#FFD9A8"
        castShadow
        shadow-bias={-0.0008}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function OpeningFill({
  component,
  opening,
}: {
  component: ComponentProduct | undefined;
  opening: Opening;
}) {
  if (!component) return null;
  const w = opening.widthM;
  const h = opening.heightM;

  switch (component.modelKind) {
    case 'door-flush':
      return <DoorSlab width={w} height={h} depth={0.045} hex={component.color.hex} panelled={false} />;
    case 'door-panel':
      return <DoorSlab width={w} height={h} depth={0.045} hex={component.color.hex} panelled />;
    case 'door-pivot':
      return <DoorSlab width={w} height={h} depth={0.08} hex={component.color.hex} panelled={false} />;
    case 'window-casement':
      return (
        <WindowUnit width={w} height={h} depth={0.1} hex={component.color.hex} mullionsX={1} mullionsY={0} />
      );
    case 'window-sash':
      return (
        <WindowUnit width={w} height={h} depth={0.1} hex={component.color.hex} mullionsX={0} mullionsY={1} />
      );
    case 'window-picture':
      return (
        <WindowUnit width={w} height={h} depth={0.1} hex={component.color.hex} mullionsX={0} mullionsY={0} />
      );
    default:
      return null;
  }
}

export function PlacedGeometry({
  component,
  ceilingHeight,
}: {
  component: ComponentProduct;
  ceilingHeight: number;
}) {
  switch (component.modelKind) {
    case 'sofa':
      return (
        <Sofa
          width={component.widthM}
          height={component.heightM}
          depth={component.depthM}
          hex={component.color.hex}
        />
      );
    case 'pendant':
      return (
        <Pendant
          width={component.widthM}
          height={component.heightM}
          ceilingHeight={ceilingHeight}
          hex={component.color.hex}
        />
      );
    default:
      return (
        <Box
          size={[component.widthM, component.heightM, component.depthM]}
          position={[0, component.heightM / 2, 0]}
          material={getSimpleMaterial(component.color.hex, 0.75, 0)}
        />
      );
  }
}
