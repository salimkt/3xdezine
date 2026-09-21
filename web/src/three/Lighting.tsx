import * as THREE from 'three/webgpu';
import { useEffect, useMemo } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { useStore } from '../store';
import { planBounds } from '../lib/geometry';
import { assetUrl } from '../lib/materials';

/**
 * Image-based lighting from an HDRI. Equirectangular environments are fine to
 * hand straight to a WebGPU scene — the renderer's EnvironmentNode does the
 * PMREM-equivalent filtering internally.
 */
export function Hdri({
  url,
  intensity,
  showSky = true,
}: {
  url: string;
  intensity: number;
  showSky?: boolean;
}) {
  // Resolved against the deployment base so HDRIs load from a Pages subpath.
  const texture = useLoader(HDRLoader, assetUrl(url));
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    scene.environmentIntensity = intensity;

    // Using the HDRI as the background, not a flat colour, is the single
    // cheapest realism win available: the glazing then reflects and transmits
    // the same environment that lights the room, and the building stops
    // floating in a void. A little blur hides the low-res seams of a 2K probe
    // without reading as fog.
    if (showSky) {
      scene.background = texture;
      // Keep this at 0. Background blur needs a PMREM-filtered source; applied
      // to a plain equirectangular probe it collapses the sky to its average
      // colour and you get a flat grey void that looks like a bug.
      scene.backgroundBlurriness = 0;
      // Dimmed relative to the environment. A clear-sky probe carries HDR values
      // far above 1.0, and AgX deliberately rolls those off towards desaturated
      // white — so at full intensity the sky renders as flat grey. Lowering only
      // the *background* keeps the blue visible without touching how the probe
      // lights the building.
      scene.backgroundIntensity = 0.32;
    } else {
      scene.background = new THREE.Color('#0f1115');
      scene.backgroundBlurriness = 0;
    }

    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [texture, scene, intensity, showSky]);

  return null;
}

/**
 * Sun plus a cool sky fill. The shadow camera is fitted to the plan so the
 * limited depth range is spent where the building actually is, and the bias is
 * scaled to wall thickness — long thin geometry is where acne and peter-panning
 * come from.
 */
export function Sun({ intensity }: { intensity: number }) {
  const project = useStore((s) => s.project);
  const floor = project.floors[0];

  const { centre, radius, normalBias } = useMemo(() => {
    const bounds = planBounds(floor?.rooms ?? []);
    const r = Math.max(bounds.size.x, bounds.size.z) * 0.95 + 6;
    const thinnest = Math.min(...(floor?.walls ?? []).map((w) => w.thicknessM), 0.3);
    return {
      centre: bounds.centre,
      radius: r,
      normalBias: Math.max(0.02, thinnest * 0.6),
    };
  }, [floor]);

  return (
    <group>
      <directionalLight
        position={[centre.x + 14, 20, centre.z - 12]}
        intensity={intensity}
        color="#FFF3E0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={normalBias}
        shadow-camera-near={0.5}
        shadow-camera-far={80}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
      />
      <hemisphereLight args={['#BFD4EA', '#3A322B', 0.35]} />
    </group>
  );
}
