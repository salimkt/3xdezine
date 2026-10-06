import * as THREE from 'three/webgpu';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Room } from '@shared/types';
import { useStore } from '../store';
import { planBounds, polygonArea } from '../lib/geometry';
import { loadTextureManifest, type TextureManifest } from '../lib/materials';
import { Building, Ground } from './Building';
import { Hdri, Sun } from './Lighting';
import { PostFX } from './PostFX';
import {
  DUR,
  TweenSlot,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  prefersReducedMotion,
  type Easing,
} from '../lib/motion';
import {
  beginIntro,
  introPending,
  introRemainingMs,
  introSeq,
  introStarted,
  onIntroSkip,
  requestIntro,
  skipIntro,
} from '../lib/intro';
import { ZoomCluster } from '../ui/ZoomCluster';
import { SunControl } from '../ui/SunControl';
import { usePreviewProposal } from '../lib/checks';

// R3F needs the WebGPU flavour of the namespace so node materials and the
// WebGPU-specific classes are constructible from JSX.
extend(THREE as unknown as Parameters<typeof extend>[0]);

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

// Each plan opened from the home screen gets the build-up — unless the 3D pane
// is not on screen, in which case there is nobody to play it to.
if (useStore.getState().openedAt > 0 && useStore.getState().view !== '2d') requestIntro();
useStore.subscribe((state, prev) => {
  if (state.openedAt !== prev.openedAt && state.view !== '2d') requestIntro();
});

// ---------------------------------------------------------------------------
// Camera rigs
// ---------------------------------------------------------------------------

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

/** What the HTML zoom cluster can ask of whichever rig is live. */
export interface RigApi {
  zoomIn: () => void;
  zoomOut: () => void;
  frame: () => void;
  /** Walk mode only: back to the default field of view. */
  resetZoom?: () => void;
}

export interface ZoomUi {
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** Walk mode reports its field of view; orbit mode has no meaningful readout. */
  fov?: number;
}

interface RigProps {
  rig: React.RefObject<RigApi | null>;
  onZoomUi: (ui: ZoomUi) => void;
}

interface OrbitPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const DEFAULT_FOV = 52;
const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 80;
const DOLLY_STEP = 1.35;
const WALK_FOV_MIN = 35;
const WALK_FOV_MAX = 75;
const WALK_FOV_STEP = 1.2;
const EYE_HEIGHT = 1.65;

/**
 * The plan-fitted three-quarter view, from the plan's own extents. Used on
 * first mount and by "Frame".
 *
 * The elevation is what makes the interior readable. Walls are full storey
 * height (~2.9 m) and there is no roof, so from an elevation e every wall hides
 * h / tan(e) of floor behind it: at the old ~18° that is ~8.7 m — more than any
 * room is deep — so each room read as a pale "lid" of white interior wall faces
 * converging on its centre, with the oak floor entirely occluded. At 50° a wall
 * hides ~2.4 m, so most of every floor and the furniture on it are in view.
 */
const FRAMED_ELEVATION = (50 * Math.PI) / 180;

function framedPose(bounds: ReturnType<typeof planBounds>): OrbitPose {
  const span = Math.max(bounds.size.x, bounds.size.z, 6);
  const target = new THREE.Vector3(bounds.centre.x, 0.6, bounds.centre.z);
  // Same south-east three-quarter azimuth as before, so the sun still rakes the facade.
  const azimuth = Math.atan2(1.34, 1.1);
  const radius = span * 1.85;
  const ground = radius * Math.cos(FRAMED_ELEVATION);
  return {
    position: new THREE.Vector3(
      target.x + ground * Math.cos(azimuth),
      target.y + radius * Math.sin(FRAMED_ELEVATION),
      target.z + ground * Math.sin(azimuth),
    ),
    target,
  };
}

/** Where the intro camera starts: higher, further out, swung round a quarter. */
function introPose(bounds: ReturnType<typeof planBounds>): OrbitPose {
  const end = framedPose(bounds);
  const sph = new THREE.Spherical().setFromVector3(end.position.clone().sub(end.target));
  sph.radius *= 1.55;
  sph.phi *= 0.6;
  sph.theta -= 0.7;
  return { position: new THREE.Vector3().setFromSpherical(sph).add(end.target), target: end.target };
}

/**
 * Survives the rigs unmounting (Orbit ↔ Walk) and the viewport unmounting
 * (Plan-only view), so coming back to orbit returns to where the user was.
 */
const cameraMemory: { orbit: OrbitPose | null; frameNext: boolean } = {
  orbit: null,
  frameNext: false,
};
/** Cameras that have been placed once. A fresh Canvas snaps; a live one flies. */
const placedCameras = new WeakSet<THREE.Camera>();

function setFov(camera: THREE.PerspectiveCamera, fov: number) {
  if (Math.abs(camera.fov - fov) < 1e-4) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function OrbitRig({ rig, onZoomUi }: RigProps) {
  const project = useStore((s) => s.project);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((state) => state.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const bounds = useMemo(() => planBounds(project.floors[0]?.rooms ?? []), [project]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const slot = useRef(new TweenSlot());
  const goalDistance = useRef<number | null>(null);
  const lastUi = useRef('');

  const report = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    const d = goalDistance.current ?? camera.position.distanceTo(c.target);
    const ui = { canZoomIn: d > MIN_DISTANCE + 0.01, canZoomOut: d < MAX_DISTANCE - 0.01 };
    const key = `${ui.canZoomIn}${ui.canZoomOut}`;
    if (key !== lastUi.current) {
      lastUi.current = key;
      onZoomUi(ui);
    }
  }, [camera, onZoomUi]);

  /**
   * Eased flight to a pose, in spherical coordinates about a moving target:
   * the camera swings around the building rather than cutting through it.
   * Drives the controls' own target/position and lets `update()` apply them,
   * so damping is never fought.
   */
  const fly = useCallback(
    (to: OrbitPose, duration: number = DUR.flight, ease: Easing = easeInOutCubic) => {
      const c = controls.current;
      if (!c) return;
      goalDistance.current = null;
      const fromTarget = c.target.clone();
      const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(fromTarget));
      const s1 = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
      let dTheta = s1.theta - s0.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
      const r0 = Math.log(Math.max(1e-3, s0.radius));
      const r1 = Math.log(Math.max(1e-3, s1.radius));
      const fov0 = camera.fov;
      const target = new THREE.Vector3();
      const sph = new THREE.Spherical();
      slot.current.run({
        duration,
        ease,
        onUpdate: (t) => {
          target.lerpVectors(fromTarget, to.target, t);
          sph.set(Math.exp(lerp(r0, r1, t)), lerp(s0.phi, s1.phi, t), s0.theta + dTheta * t);
          camera.position.setFromSpherical(sph).add(target);
          c.target.copy(target);
          setFov(camera, lerp(fov0, DEFAULT_FOV, t));
          c.update();
          invalidate();
        },
        onComplete: report,
      });
    },
    [camera, invalidate, report],
  );

  /** Animated dolly along the view direction; the target stays put. */
  const dolly = useCallback(
    (factor: number) => {
      const c = controls.current;
      if (!c) return;
      const from = camera.position.distanceTo(c.target);
      const base = goalDistance.current ?? from;
      const to = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, base * factor));
      goalDistance.current = to;
      report();
      const offset = new THREE.Vector3();
      slot.current.run({
        duration: DUR.med,
        ease: easeOutCubic,
        onUpdate: (t) => {
          // Direction re-read every frame, so a still-damping orbit carries on.
          offset.copy(camera.position).sub(c.target).normalize();
          const d = Math.exp(lerp(Math.log(from), Math.log(to), t));
          camera.position.copy(c.target).addScaledVector(offset, d);
          c.update();
          invalidate();
        },
        onComplete: () => {
          goalDistance.current = null;
          report();
        },
      });
    },
    [camera, invalidate, report],
  );

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const destination =
      cameraMemory.frameNext || !cameraMemory.orbit ? framedPose(boundsRef.current) : cameraMemory.orbit;
    cameraMemory.frameNext = false;

    if (introPending()) {
      // The build-up owns the camera: start high and wide, fly in once it plays.
      placedCameras.add(camera);
      placeIntro();
    } else if (!placedCameras.has(camera)) {
      // A fresh canvas: no motion to continue from, and the boot overlay is up.
      placedCameras.add(camera);
      camera.position.copy(destination.position);
      c.target.copy(destination.target);
      setFov(camera, DEFAULT_FOV);
      c.update();
    } else {
      // Arriving from walk mode: start with the target straight ahead of the
      // walker, so frame one is exactly the view the user was looking at.
      const ahead = camera.getWorldDirection(new THREE.Vector3());
      const reach = Math.min(20, Math.max(2, camera.position.distanceTo(destination.target) * 0.5));
      c.target.copy(camera.position).addScaledVector(ahead, reach);
      fly(destination);
    }
    report();

    // The user grabbing the camera always wins over an animation.
    const takeOver = () => {
      slot.current.cancel();
      goalDistance.current = null;
    };
    c.addEventListener('start', takeOver);
    c.addEventListener('change', report);
    const tween = slot.current;
    return () => {
      c.removeEventListener('start', takeOver);
      c.removeEventListener('change', report);
      tween.cancel();
      cameraMemory.orbit = { position: camera.position.clone(), target: c.target.clone() };
    };
    // Mount only; plan edits re-centre the target below without moving the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- build-up intro -----------------------------------------------------
  const flownSeq = useRef(-1);
  const openedAt = useStore((s) => s.openedAt);
  const placeIntro = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    slot.current.cancel();
    const pose = introPose(boundsRef.current);
    camera.position.copy(pose.position);
    c.target.copy(pose.target);
    setFov(camera, DEFAULT_FOV);
    c.update();
    invalidate();
  }, [camera, invalidate]);

  // A new plan opened while the canvas is warm: same intro, no new pipeline.
  const firstOpen = useRef(openedAt);
  useEffect(() => {
    if (openedAt === firstOpen.current) return;
    firstOpen.current = openedAt;
    if (introPending()) placeIntro();
    else fly(framedPose(boundsRef.current));
  }, [openedAt, placeIntro, fly]);

  useFrame(() => {
    if (!introStarted() || flownSeq.current === introSeq()) return;
    flownSeq.current = introSeq();
    // Settles slightly after the walls finish, so the last motion is the camera's.
    fly(framedPose(boundsRef.current), introRemainingMs(performance.now()) + 260, easeOutCubic);
  });

  useEffect(
    () =>
      onIntroSkip((source) => {
        flownSeq.current = introSeq();
        // A grab on the canvas hands the camera to the user (OrbitControls'
        // own start event stops the flight); anything else lands it quickly.
        if (source !== 'canvas') fly(framedPose(boundsRef.current), DUR.med, easeOutCubic);
      }),
    [fly],
  );

  // Keep orbiting about the building as the plan is edited.
  const firstBounds = useRef(true);
  useEffect(() => {
    if (firstBounds.current) {
      firstBounds.current = false;
      return;
    }
    if (slot.current.running) return;
    controls.current?.target.set(bounds.centre.x, 1.2, bounds.centre.z);
    controls.current?.update();
  }, [bounds]);

  useEffect(() => {
    const api: RigApi = {
      zoomIn: () => dolly(1 / DOLLY_STEP),
      zoomOut: () => dolly(DOLLY_STEP),
      frame: () => fly(framedPose(boundsRef.current)),
    };
    rig.current = api;
    return () => {
      if (rig.current === api) rig.current = null;
    };
  }, [rig, dolly, fly]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}

/**
 * First-person walk at eye height: WASD to move, drag to look.
 *
 * Deliberately not `PointerLockControls` — the Pointer Lock API is unavailable
 * in embedded and cross-document contexts, where it throws a
 * `WrongDocumentError` and leaves the user stuck. Drag-to-look works anywhere.
 *
 * Zoom here is a field-of-view change, never a dolly: moving the eye forward
 * would walk it through walls.
 */
function WalkRig({ rig, onZoomUi }: RigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: 0, pitch: 0 });
  const project = useStore((s) => s.project);
  const flight = useRef(new TweenSlot());
  const flying = useRef(false);
  const finishFlight = useRef<() => void>(() => undefined);
  const fovGoal = useRef(DEFAULT_FOV);

  const report = useCallback(() => {
    const goal = fovGoal.current;
    onZoomUi({
      canZoomIn: goal > WALK_FOV_MIN + 0.01,
      canZoomOut: goal < WALK_FOV_MAX - 0.01,
      fov: goal,
    });
  }, [onZoomUi]);

  const setFovGoal = useCallback(
    (fov: number) => {
      fovGoal.current = Math.min(WALK_FOV_MAX, Math.max(WALK_FOV_MIN, fov));
      if (prefersReducedMotion()) setFov(camera, fovGoal.current);
      report();
      invalidate();
    },
    [camera, invalidate, report],
  );

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
    const eye = new THREE.Vector3(target.centre.x, EYE_HEIGHT, target.max.z - 0.9);
    // Yaw 0 looks along -Z.
    const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ'));
    look.current = { yaw: 0, pitch: 0 };
    fovGoal.current = DEFAULT_FOV;
    report();

    const land = () => {
      camera.position.copy(eye);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(0, 0, 0, 'YXZ');
      setFov(camera, DEFAULT_FOV);
      flying.current = false;
    };
    finishFlight.current = () => {
      flight.current.cancel();
      land();
    };

    if (!placedCameras.has(camera)) {
      placedCameras.add(camera);
      land();
    } else {
      // Glide from the orbit view down to eye height instead of cutting.
      const p0 = camera.position.clone();
      const q0 = camera.quaternion.clone();
      const fov0 = camera.fov;
      flying.current = true;
      flight.current.run({
        duration: DUR.flight,
        ease: easeInOutCubic,
        onUpdate: (t) => {
          camera.position.lerpVectors(p0, eye, t);
          camera.quaternion.slerpQuaternions(q0, facing, t);
          setFov(camera, lerp(fov0, DEFAULT_FOV, t));
          invalidate();
        },
        onComplete: land,
      });
    }
    const tween = flight.current;
    return () => tween.cancel();
    // Only on entering walk mode; later plan edits must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const api: RigApi = {
      zoomIn: () => setFovGoal(fovGoal.current / WALK_FOV_STEP),
      zoomOut: () => setFovGoal(fovGoal.current * WALK_FOV_STEP),
      resetZoom: () => setFovGoal(DEFAULT_FOV),
      frame: () => {
        cameraMemory.frameNext = true;
        useStore.getState().setCameraMode('orbit');
      },
    };
    rig.current = api;
    return () => {
      if (rig.current === api) rig.current = null;
    };
  }, [rig, setFovGoal]);

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
      // Grabbing the view mid-flight lands the flight rather than fighting it.
      if (flying.current) finishFlight.current();
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
      // Narrower field of view, finer look: the scene should track the cursor.
      const gain = 0.0038 * (camera.fov / DEFAULT_FOV);
      look.current.yaw -= dx * gain;
      look.current.pitch -= dy * gain;
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
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dy = Math.max(-100, Math.min(100, event.deltaY * unit));
      setFovGoal(fovGoal.current * Math.exp(dy * (event.ctrlKey ? 0.01 : 0.0018)));
    };

    domElement.style.cursor = 'grab';
    domElement.addEventListener('pointerdown', start);
    domElement.addEventListener('pointerup', swallowDragAsClick, true);
    domElement.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      domElement.style.cursor = '';
      domElement.removeEventListener('pointerdown', start);
      domElement.removeEventListener('pointerup', swallowDragAsClick, true);
      domElement.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [domElement, camera, setFovGoal]);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (flying.current) return;

    // FOV eases toward its goal: exponential, so a burst of wheel ticks or
    // clicks retargets smoothly and nothing ever queues.
    const goal = fovGoal.current;
    if (Math.abs(camera.fov - goal) > 0.01) {
      const alpha = 1 - Math.exp(-Math.min(delta, 0.064) / 0.055);
      setFov(camera, Math.abs(camera.fov - goal) < 0.05 ? goal : lerp(camera.fov, goal, alpha));
    }

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

/**
 * Starts the intro clock on the first frame actually presented (never during
 * a cold-start compile), and lets any interaction skip it.
 */
function IntroDirector() {
  const rendererReady = useStore((s) => s.rendererReady);
  const domElement = useThree((state) => state.gl.domElement);

  useFrame(() => {
    if (rendererReady && introPending()) beginIntro(performance.now());
  });

  useEffect(() => {
    const skip = (event: Event) => {
      if (!introPending()) return;
      skipIntro(event.target === domElement ? 'canvas' : 'other');
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', skip, opts);
    window.addEventListener('wheel', skip, opts);
    window.addEventListener('keydown', skip, opts);
    return () => {
      window.removeEventListener('pointerdown', skip, opts);
      window.removeEventListener('wheel', skip, opts);
      window.removeEventListener('keydown', skip, opts);
    };
  }, [domElement]);

  return null;
}

function SceneContent({ manifest, ...rigProps }: { manifest: TextureManifest } & RigProps) {
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
      <Sun
        intensity={render.sunIntensity}
        hour={render.sunHour}
        envIntensity={render.envIntensity}
        exposure={render.exposure}
      />
      <IntroDirector />
      <Ground />
      {render.showGrid && <SiteGrid />}
      <Building manifest={manifest} />
      {cameraMode === 'orbit' ? <OrbitRig {...rigProps} /> : <WalkRig {...rigProps} />}
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

/**
 * A cold start is a real multi-second wait: the WebGPU device has to come up and
 * the whole TSL post stack has to compile. A bare spinner reads as a hang, so
 * the overlay names the stages and marks off the ones already done.
 */
function ViewportBooting({ stage }: { stage: 'assets' | 'compiling' }) {
  const steps: Array<[string, 'done' | 'active' | 'todo']> = [
    ['Loading the finish library', stage === 'assets' ? 'active' : 'done'],
    ['Starting the WebGPU device', stage === 'assets' ? 'todo' : 'done'],
    ['Compiling shaders and post-processing', stage === 'assets' ? 'todo' : 'active'],
  ];

  return (
    <div className="viewport-overlay">
      <div className="viewport-card">
        <div className="viewport-card-head">
          <div className="spinner" />
          <h3>Preparing the viewport</h3>
        </div>
        <p>
          Photoreal shading, ambient occlusion and screen-space reflections compile once per
          session. Everything else in the studio is already live.
        </p>
        <ul className="viewport-steps">
          {steps.map(([label, state]) => (
            <li key={label} className={state === 'todo' ? '' : state}>
              {label}
            </li>
          ))}
        </ul>
        <div className="progress-rail" />
      </div>
    </div>
  );
}

/** Quiet corner readout: which camera you are in, and how to drive it. */
function ViewportHud() {
  const cameraMode = useStore((s) => s.cameraMode);
  const backend = useStore((s) => s.backend);
  return (
    <div className="viewport-hud">
      <span>{cameraMode === 'orbit' ? 'Orbit' : 'Walk'}</span>
      <span className="hud-hint">
        {cameraMode === 'orbit'
          ? 'drag to rotate · scroll to zoom'
          : 'drag to look · WASD to walk · scroll to zoom'}
      </span>
      {backend !== 'pending' && <span>{backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}</span>}
    </div>
  );
}

function PreviewBadge() {
  const proposal = usePreviewProposal();
  const in3d = useStore((s) => s.previewIn3d);
  const setIn3d = useStore((s) => s.setPreviewIn3d);
  if (!proposal || !in3d || proposal.status !== 'PENDING') return null;
  return (
    <div className="viewport-preview">
      <span className="plan-diff-swatch" />
      Previewing proposal by <b>{proposal.author}</b>
      <button className="chip" onClick={() => setIn3d(false)}>
        Show current
      </button>
    </div>
  );
}

function ViewportZoom({
  rig,
  ui,
}: {
  rig: React.RefObject<RigApi | null>;
  ui: ZoomUi;
}) {
  const cameraMode = useStore((s) => s.cameraMode);
  const walk = cameraMode === 'walk';
  return (
    <ZoomCluster
      className="viewport-zoom"
      onZoomIn={() => rig.current?.zoomIn()}
      onZoomOut={() => rig.current?.zoomOut()}
      canZoomIn={ui.canZoomIn}
      canZoomOut={ui.canZoomOut}
      zoomInTitle={walk ? 'Narrow the field of view' : 'Move closer'}
      zoomOutTitle={walk ? 'Widen the field of view' : 'Move back'}
      readout={
        walk && ui.fov !== undefined
          ? {
              label: `${Math.round(ui.fov)}°`,
              title: `Field of view — reset to ${DEFAULT_FOV}°`,
              onClick: () => rig.current?.resetZoom?.(),
            }
          : undefined
      }
      onFit={() => rig.current?.frame()}
      fitLabel="Frame"
      fitTitle={walk ? 'Back to orbit, framing the whole building' : 'Frame the whole building'}
    />
  );
}

export function Viewport() {
  const [manifest, setManifest] = useState<TextureManifest | null>(null);
  const rendererReady = useStore((s) => s.rendererReady);
  // Behind the home screen the studio stays mounted but must not burn the GPU.
  const paused = useStore((s) => s.screen !== 'studio');
  const rig = useRef<RigApi | null>(null);
  const [zoomUi, setZoomUi] = useState<ZoomUi>({ canZoomIn: true, canZoomOut: true });

  useEffect(() => {
    let live = true;
    loadTextureManifest().then((m) => live && setManifest(m));
    return () => {
      live = false;
    };
  }, []);

  if (!manifest) return <ViewportBooting stage="assets" />;

  return (
    <>
      <Canvas
        // r186 removed PCFSoftShadowMap from WebGPURenderer, and R3F's plain
        // `shadows` boolean sets exactly that, warning on every frame budget.
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        frameloop={paused ? 'never' : 'always'}
        camera={{ fov: DEFAULT_FOV, near: 0.05, far: 400, position: [16, 11, 18] }}
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
          <SceneContent manifest={manifest} rig={rig} onZoomUi={setZoomUi} />
        </Suspense>
      </Canvas>
      {/* The WebGPU device plus the whole TSL effect stack takes a few seconds
          to compile on a cold start. Say so rather than showing a black box. */}
      {!rendererReady && <ViewportBooting stage="compiling" />}
      {rendererReady && <ViewportHud />}
      {rendererReady && <PreviewBadge />}
      {rendererReady && <SunControl />}
      {rendererReady && <ViewportZoom rig={rig} ui={zoomUi} />}
    </>
  );
}
