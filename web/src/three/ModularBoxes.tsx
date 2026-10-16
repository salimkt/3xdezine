import * as THREE from 'three/webgpu';
import { useMemo } from 'react';
import type { ModularItem } from '@shared/business';
import type { Material, Project } from '@shared/types';
import { priceModular, specFor } from '@shared/modular';
import { getMaterial, getSimpleMaterial, type TextureManifest } from '../lib/materials';

/**
 * Modular kitchens and wardrobes in the scene: one simple box per module from
 * the engine's `ModularBreakdown.boxes`, in the shutter colour. Wood finishes
 * borrow the catalogue's walnut panel texture; the countertop reads as stone.
 * No new assets, and nothing here touches the post pipeline.
 */

/** Catalogue material whose texture stands in for a veneer shutter. */
export const VENEER_MATERIAL_ID = 'wood-panel-walnut';

const ROUGHNESS: Record<string, number> = {
  LAMINATE_MATTE: 0.72,
  LAMINATE_GLOSS: 0.28,
  MEMBRANE: 0.5,
  ACRYLIC: 0.12,
  PU_MATTE: 0.6,
  PU_GLOSS: 0.18,
  VENEER: 0.55,
  GLASS_PROFILE: 0.08,
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);

export function ModularBoxes({
  items,
  project,
  materials,
  manifest,
}: {
  items: ModularItem[];
  project: Project;
  materials: Map<string, Material>;
  manifest: TextureManifest;
}) {
  const boxes = useMemo(
    () =>
      items.flatMap((item) => {
        try {
          return priceModular(item, undefined, project).boxes.map((b) => ({ b, item }));
        } catch {
          return [];
        }
      }),
    [items, project],
  );

  if (!boxes.length) return null;
  return (
    <group name="modular">
      {boxes.map(({ b, item }) => {
        const counter = b.moduleId.endsWith('-countertop');
        const finish = specFor(item, b.zone).shutter.finish;
        const filler = b.colorHex.toUpperCase() === '#BDB6A8';
        const material =
          !counter && !filler && finish === 'VENEER'
            ? getMaterial(materials.get(VENEER_MATERIAL_ID), manifest)
            : getSimpleMaterial(b.colorHex, counter ? 0.32 : (ROUGHNESS[finish] ?? 0.6), 0);
        // A hair inset so adjacent modules read as separate boxes rather than one slab.
        const gap = counter ? 0 : 0.004;
        return (
          <mesh
            key={`${item.id}:${b.moduleId}`}
            geometry={unitBox}
            material={material}
            position={[b.center.x, b.center.y, b.center.z]}
            rotation={[0, b.rotationY, 0]}
            scale={[Math.max(0.001, b.size.x - gap), Math.max(0.001, b.size.y - gap), Math.max(0.001, b.size.z - gap)]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}
