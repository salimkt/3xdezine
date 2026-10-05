import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { planBounds } from '../lib/geometry';
import { assetUrl } from '../lib/materials';
import { sunAt } from '../lib/sun';
import { useDisplayProject } from '../lib/checks';

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
 * Sun plus a cool sky fill. The sun follows the solar path for the site at the
 * chosen clock time, warming and dimming toward the horizon; the environment
 * and exposure are nudged with it so golden hour reads as golden rather than
 * merely dark. The shadow camera is fitted to the plan so the limited depth
 * range is spent where the building actually is, and the bias is scaled to
 * wall thickness — long thin geometry is where acne and peter-panning come from.
 */
export function Sun({
  intensity,
  hour,
  envIntensity,
  exposure,
}: {
  intensity: number;
  hour: number;
  envIntensity: number;
  exposure: number;
}) {
  const project = useDisplayProject();
  const floor = project.floors[0];
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
  const light = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const props = useRef({ intensity, hour, envIntensity, exposure });
  props.current = { intensity, hour, envIntensity, exposure };
  /** The hour actually lit — eases toward the slider so a drag sweeps, not jumps. */
  const shown = useRef(hour);
  const skyCool = useMemo(() => new THREE.Color('#BFD4EA'), []);
  const skyWarm = useMemo(() => new THREE.Color('#E8C9A8'), []);

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

  useFrame((_, delta) => {
    const l = light.current;
    if (!l) return;
    const p = props.current;
    const gap = p.hour - shown.current;
    shown.current =
      Math.abs(gap) < 0.002 ? p.hour : shown.current + gap * (1 - Math.exp(-Math.min(delta, 0.1) / 0.22));
    const sun = sunAt(shown.current);
    const reach = 40;
    l.position.set(centre.x + sun.dir.x * reach, sun.dir.y * reach, centre.z + sun.dir.z * reach);
    target.position.set(centre.x, 0, centre.z);
    target.updateMatrixWorld();
    l.color.set(sun.color);
    l.intensity = p.intensity * sun.strength;
    hemi.current?.color.copy(skyCool).lerp(skyWarm, sun.warmth * 0.6);
    // The probe is a clear midday sky; dim it a little at golden hour and more
    // once the sun is down, so dusk does not read as an overcast noon.
    scene.environmentIntensity = p.envIntensity * (1 - 0.24 * sun.warmth) * (1 - 0.4 * sun.twilight);
    if (scene.background instanceof THREE.Texture) scene.backgroundIntensity = 0.32 * (1 - 0.45 * sun.twilight);
    gl.toneMappingExposure = p.exposure * (1 + 0.16 * sun.warmth);
  });

  return (
    <group>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        intensity={intensity}
        color="#FFF3E0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={normalBias}
        shadow-camera-near={0.5}
        shadow-camera-far={90}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
      />
      <hemisphereLight ref={hemi} args={['#BFD4EA', '#3A322B', 0.35]} />
    </group>
  );
}
