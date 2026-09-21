import * as THREE from 'three/webgpu';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Room } from '@shared/types';
import { useStore } from '../store';
import { planBounds, polygonArea } from '../lib/geometry';
import { loadTextureManifest, type TextureManifest } from '../lib/materials';
import { Building, Ground } from './Building';
import { Hdri, Sun } from './Lighting';
import { PostFX } from './PostFX';

// R3F needs the WebGPU flavour of the namespace so node materials and the
// WebGPU-specific classes are constructible from JSX.
extend(THREE as unknown as Parameters<typeof extend>[0]);

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

// ---------------------------------------------------------------------------
// Camera rigs
// ---------------------------------------------------------------------------

function OrbitRig() {
  const project = useStore((s) => s.project);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const bounds = useMemo(() => planBounds(project.floors[0]?.rooms ?? []), [project]);

  useEffect(() => {
    controls.current?.target.set(bounds.centre.x, 1.2, bounds.centre.z);
    controls.current?.update();
  }, [bounds]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1.5}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}

const EYE_HEIGHT = 1.65;

/**
 * First-person walk at eye height: WASD to move, drag to look.
 *
 * Deliberately not `PointerLockControls` — the Pointer Lock API is unavailable
 * in embedded and cross-document contexts, where it throws a
 * `WrongDocumentError` and leaves the user stuck. Drag-to-look works anywhere.
 */
function WalkRig() {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: 0, pitch: 0 });
  const project = useStore((s) => s.project);

  useEffect(() => {
    // Start standing in the biggest room, at its south end, looking north
    // across it — the view that actually shows the space off.
    const rooms = project.floors[0]?.rooms ?? [];
    const biggest = rooms.reduce<Room | undefined>(
      (best, room) =>
        !best || polygonArea(room.polygon) > polygonArea(best.polygon) ? room : best,
      undefined,
    );
    const target = biggest ? planBounds([biggest]) : planBounds(rooms);
    camera.position.set(target.centre.x, EYE_HEIGHT, target.max.z - 0.9);
    camera.rotation.order = 'YXZ';
    // Yaw 0 looks along -Z.
    look.current = { yaw: 0, pitch: 0 };
    // Only on entering walk mode; later plan edits must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => (keys.current[event.code] = true);
    const up = (event: KeyboardEvent) => (keys.current[event.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;

    const start = (event: PointerEvent) => {
      dragging = true;
      travelled = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      domElement.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      travelled += Math.abs(dx) + Math.abs(dy);
      look.current.yaw -= dx * 0.0038;
      look.current.pitch -= dy * 0.0038;
      look.current.pitch = Math.max(-1.35, Math.min(1.35, look.current.pitch));
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const end = () => {
      dragging = false;
      domElement.style.cursor = 'grab';
    };
    // A look-drag must not also select whatever happened to be under the
    // cursor. R3F derives its click from a bubbling pointerup on the canvas,
    // so swallowing that one event in the capture phase is enough.
    const swallowDragAsClick = (event: PointerEvent) => {
      if (travelled > 4) event.stopPropagation();
    };

    domElement.style.cursor = 'grab';
    domElement.addEventListener('pointerdown', start);
    domElement.addEventListener('pointerup', swallowDragAsClick, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      domElement.style.cursor = '';
      domElement.removeEventListener('pointerdown', start);
      domElement.removeEventListener('pointerup', swallowDragAsClick, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [domElement]);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ');

    const speed = (keys.current.ShiftLeft ? 3.4 : 1.6) * delta;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up).normalize();

    if (keys.current.KeyW || keys.current.ArrowUp)
      camera.position.addScaledVector(forward.current, speed);
    if (keys.current.KeyS || keys.current.ArrowDown)
      camera.position.addScaledVector(forward.current, -speed);
    if (keys.current.KeyD || keys.current.ArrowRight)
      camera.position.addScaledVector(right.current, speed);
    if (keys.current.KeyA || keys.current.ArrowLeft)
      camera.position.addScaledVector(right.current, -speed);
    camera.position.y = EYE_HEIGHT;
  });

  return null;
}

/**
 * A one-metre site grid. drei's `<Grid>` is a raw `ShaderMaterial`, which the
 * WebGPU node pipeline rejects outright ("Material ShaderMaterial is not
 * compatible"), so this uses a plain GridHelper whose LineBasicMaterial the
 * node library converts automatically.
 */
function SiteGrid() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(200, 200, 0x4a515c, 0x2c313a);
    helper.position.y = -0.012;
    const material = helper.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.55;
    material.depthWrite = false;
    return helper;
  }, []);

  useEffect(
    () => () => {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    },
    [grid],
  );

  return <primitive object={grid} />;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function SceneContent({ manifest }: { manifest: TextureManifest }) {
  const render = useStore((s) => s.render);
  const cameraMode = useStore((s) => s.cameraMode);
  const gl = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
  const setBackend = useStore((s) => s.setBackend);

  useEffect(() => {
    gl.shadowMap.enabled = true;
    const backend = gl.backend as unknown as { isWebGPUBackend?: boolean } | undefined;
    setBackend(backend?.isWebGPUBackend ? 'webgpu' : 'webgl');
  }, [gl, setBackend]);

  return (
    <>
      {/* The HDRI gets its own boundary: suspending here would otherwise throw
          away the rest of the tree on first render and rebuild — and recompile
          — the whole post-processing pipeline a second time. */}
      <Suspense fallback={null}>
        <Hdri url={render.hdri} intensity={render.envIntensity} />
      </Suspense>
      <Sun intensity={render.sunIntensity} />
      <Ground />
      {render.showGrid && <SiteGrid />}
      <Building manifest={manifest} />
      {cameraMode === 'orbit' ? <OrbitRig /> : <WalkRig />}
      <PostFX
        quality={render.quality}
        toneMapping={render.toneMapping}
        exposure={render.exposure}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

function ViewportFallback({ label }: { label: string }) {
  return (
    <div className="viewport-fallback">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Viewport() {
  const [manifest, setManifest] = useState<TextureManifest | null>(null);
  const rendererReady = useStore((s) => s.rendererReady);

  useEffect(() => {
    let live = true;
    loadTextureManifest().then((m) => live && setManifest(m));
    return () => {
      live = false;
    };
  }, []);

  if (!manifest) return <ViewportFallback label="Loading materials…" />;

  return (
    <>
      <Canvas
        // r186 removed PCFSoftShadowMap from WebGPURenderer, and R3F's plain
        // `shadows` boolean sets exactly that, warning on every frame budget.
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        camera={{ fov: 52, near: 0.05, far: 400, position: [16, 11, 18] }}
        // `WebGPURenderer.init()` is async, which is why the scene lives behind a
        // <Suspense> boundary. WebGL2 is the degradation tier, not a second
        // codebase — the same node materials compile to GLSL.
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({
            ...(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]),
            forceWebGL: !hasWebGPU,
            // MSAA must stay off: the post stack copies the pass depth buffer,
            // and a 4-sample depth texture cannot be copied into a 1-sample one.
            // TRAA is the anti-aliasing.
            antialias: false,
            samples: 0,
            alpha: false,
          });
          await renderer.init();
          return renderer as never;
        }}
        onPointerMissed={() => useStore.getState().select(null, null)}
      >
        <Suspense fallback={null}>
          <SceneContent manifest={manifest} />
        </Suspense>
      </Canvas>
      {/* The WebGPU device plus the whole TSL effect stack takes a few seconds
          to compile on a cold start. Say so rather than showing a black box. */}
      {!rendererReady && <ViewportFallback label="Compiling shaders…" />}
    </>
  );
}
