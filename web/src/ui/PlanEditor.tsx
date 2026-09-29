import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Opening, Room, Vec2, Wall } from '@shared/types';
import { useStore } from '../store';
import { polygonArea, polygonCentroid, planBounds, wallLength } from '../lib/geometry';
import { area as fmtArea, metres } from '../lib/format';
import { DUR, TweenSlot, easeOutCubic, lerp, prefersReducedMotion } from '../lib/motion';
import { ZoomCluster } from './ZoomCluster';

const SNAP_M = 0.1;
const PADDING_M = 2.2;

/** Rounds a scale-bar length to something a draughtsman would actually print. */
const NICE_M = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
function niceLength(metres: number): number {
  return NICE_M.find((n) => n >= metres) ?? NICE_M[NICE_M.length - 1];
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function wallQuad(wall: Wall): string {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (wall.thicknessM / 2);
  const nz = (dx / len) * (wall.thicknessM / 2);
  const points: Vec2[] = [
    { x: wall.start.x + nx, z: wall.start.z + nz },
    { x: wall.end.x + nx, z: wall.end.z + nz },
    { x: wall.end.x - nx, z: wall.end.z - nz },
    { x: wall.start.x - nx, z: wall.start.z - nz },
  ];
  return points.map((p) => `${p.x},${p.z}`).join(' ');
}

function openingRect(wall: Wall, opening: Opening) {
  const len = wallLength(wall) || 1;
  const dx = (wall.end.x - wall.start.x) / len;
  const dz = (wall.end.z - wall.start.z) / len;
  const cx = wall.start.x + dx * opening.t * len;
  const cz = wall.start.z + dz * opening.t * len;
  const half = opening.widthM / 2;
  const nx = (-dz * wall.thicknessM) / 2;
  const nz = (dx * wall.thicknessM) / 2;
  return {
    cx,
    cz,
    a: { x: cx - dx * half + nx, z: cz - dz * half + nz },
    b: { x: cx + dx * half + nx, z: cz + dz * half + nz },
    c: { x: cx + dx * half - nx, z: cz + dz * half - nz },
    d: { x: cx - dx * half - nx, z: cz - dz * half - nz },
    dx,
    dz,
    half,
    isDoor: opening.sillM < 0.05,
  };
}

/**
 * Zoom is expressed against a real drawing scale: 100% is 1:100 on a 96-dpi
 * screen (1 m = 1 cm = 37.8 px), so the readout means something to anyone who
 * has held a scale rule, and 100% is not merely "whatever Fit happened to be".
 */
const PX_PER_M_AT_100 = 96 / 2.54;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = Math.SQRT2;
/** Pointer travel (px) before a press on a room or wall becomes a pan. */
const DRAG_SLOP = 4;
/** Bottom strip kept clear by Fit for the zoom cluster and scale bar. */
const FIT_RESERVE_PX = 44;
/** Time constant of the wheel smoothing: enough to hide notchy wheels, too short to feel like lag. */
const WHEEL_TAU_MS = 55;

/** The plan camera: the world point at the centre of the stage, and the zoom factor. */
interface Cam {
  cx: number;
  cy: number;
  k: number;
}

interface Size {
  w: number;
  h: number;
}

type HitTarget =
  | { kind: 'room'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'handle'; wallId: string; which: 'start' | 'end' }
  | { kind: 'bg' };

type Gesture =
  | { type: 'none' }
  | { type: 'press'; id: number; x: number; y: number; target: HitTarget; cam: Cam }
  | { type: 'pan'; id: number; x: number; y: number; cam: Cam }
  | { type: 'corner'; id: number; wallId: string; which: 'start' | 'end' }
  | { type: 'pinch'; ids: [number, number]; dist: number; world: Vec2; k: number };

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
const EPS_ZOOM = 1e-3;

function hitTarget(node: EventTarget | null): HitTarget {
  const el = (node as Element | null)?.closest?.('[data-hit]');
  if (!el) return { kind: 'bg' };
  const kind = el.getAttribute('data-hit');
  if (kind === 'handle') {
    return {
      kind: 'handle',
      wallId: el.getAttribute('data-wall') ?? '',
      which: el.getAttribute('data-which') === 'end' ? 'end' : 'start',
    };
  }
  if (kind === 'room') return { kind: 'room', id: el.getAttribute('data-id') ?? '' };
  if (kind === 'wall') return { kind: 'wall', id: el.getAttribute('data-id') ?? '' };
  return { kind: 'bg' };
}

function isTextEntry(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type);
}

export function PlanEditor() {
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const selection = useStore((s) => s.select);
  const selected = useStore((s) => s.selection);
  const setSurfaceTarget = useStore((s) => s.setSurfaceTarget);
  const moveWallEndpoint = useStore((s) => s.moveWallEndpoint);
  const lastApplied = useStore((s) => s.lastApplied);

  const floor = project.floors[0];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [cam, setCamState] = useState<Cam | null>(null);
  const [drag, setDrag] = useState<{ wallId: string; which: 'start' | 'end' } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [snap, setSnap] = useState(true);
  const [cursor, setCursor] = useState<Vec2 | null>(null);

  // Everything the native listeners read lives in refs, so they are bound
  // once and never see a stale closure.
  const camRef = useRef<Cam | null>(null);
  const sizeRef = useRef<Size | null>(null);
  /** Where the running animation will land — successive clicks compound from here. */
  const goalRef = useRef<Cam | null>(null);
  const tweenSlot = useRef(new TweenSlot());
  const wheelAnim = useRef<{
    frame: number;
    targetK: number;
    world: Vec2;
    sx: number;
    sy: number;
    last: number;
  } | null>(null);
  const gesture = useRef<Gesture>({ type: 'none' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const hovering = useRef(false);
  const spaceRef = useRef(false);
  /** True while the view is "the whole plan": a resize re-fits instead of cropping. */
  const fitted = useRef(true);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // Mark only materials applied while this editor is on screen; a stale
  // application must not flash again when the pane remounts.
  const mountedAt = useRef(useStore.getState().lastApplied?.at ?? 0);

  const bounds = useMemo(() => planBounds(floor?.rooms ?? []), [floor]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const commit = useCallback((next: Cam) => {
    camRef.current = next;
    setCamState(next);
  }, []);

  const fitCam = useCallback((): Cam | null => {
    const sz = sizeRef.current;
    if (!sz) return null;
    const b = boundsRef.current;
    // Fit into the stage above the zoom cluster, not behind it.
    const h = Math.max(1, sz.h - FIT_RESERVE_PX);
    const k = clampZoom(
      Math.min(sz.w / (b.size.x + PADDING_M * 2), h / (b.size.z + PADDING_M * 2)) /
        PX_PER_M_AT_100,
    );
    const ppm = k * PX_PER_M_AT_100;
    return { cx: b.centre.x, cy: b.centre.z + FIT_RESERVE_PX / 2 / ppm, k };
  }, []);

  const stopWheel = useCallback(() => {
    if (wheelAnim.current) cancelAnimationFrame(wheelAnim.current.frame);
    wheelAnim.current = null;
  }, []);

  /** Halts any zoom animation where it stands, e.g. because the user grabbed the plan. */
  const stopAnimations = useCallback(() => {
    tweenSlot.current.cancel();
    stopWheel();
    goalRef.current = null;
  }, [stopWheel]);

  /** Eased flight to a camera; log-space zoom so every doubling takes the same time. */
  const animateTo = useCallback(
    (target: Cam) => {
      const from = camRef.current;
      if (!from) return;
      stopWheel();
      goalRef.current = target;
      const logFrom = Math.log(from.k);
      const logTo = Math.log(target.k);
      tweenSlot.current.run({
        duration: DUR.med,
        ease: easeOutCubic,
        onUpdate: (t) =>
          commit(
            t >= 1
              ? target
              : {
                  cx: lerp(from.cx, target.cx, t),
                  cy: lerp(from.cy, target.cy, t),
                  k: Math.exp(lerp(logFrom, logTo, t)),
                },
          ),
        onComplete: () => {
          goalRef.current = null;
        },
      });
    },
    [commit, stopWheel],
  );

  /** Zoom by a factor about the centre of the stage (buttons, keyboard). */
  const zoomBy = useCallback(
    (factor: number) => {
      const base = goalRef.current ?? camRef.current;
      if (!base) return;
      fitted.current = false;
      animateTo({ ...base, k: clampZoom(base.k * factor) });
    },
    [animateTo],
  );

  const resetZoom = useCallback(() => {
    const base = goalRef.current ?? camRef.current;
    fitted.current = false;
    if (base) animateTo({ ...base, k: 1 });
  }, [animateTo]);

  const fit = useCallback(() => {
    const target = fitCam();
    fitted.current = true;
    if (target) animateTo(target);
  }, [animateTo, fitCam]);

  /** Screen offset (px) of a client point from the stage centre. */
  const fromCentre = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { sx: clientX - (rect.left + rect.width / 2), sy: clientY - (rect.top + rect.height / 2) };
  }, []);

  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Vec2 | null => {
      const c = camRef.current;
      if (!svgRef.current || !c) return null;
      const { sx, sy } = fromCentre(event.clientX, event.clientY);
      const ppm = c.k * PX_PER_M_AT_100;
      return { x: c.cx + sx / ppm, z: c.cy + sy / ppm };
    },
    [fromCentre],
  );

  /** The camera that puts `world` under screen offset (sx, sy) at zoom k. */
  const anchored = (world: Vec2, sx: number, sy: number, k: number): Cam => {
    const ppm = k * PX_PER_M_AT_100;
    return { cx: world.x - sx / ppm, cy: world.z - sy / ppm, k };
  };

  // --- wheel & trackpad ---------------------------------------------------

  const onWheel = useCallback(
    (event: WheelEvent) => {
      const c = camRef.current;
      if (!c || !svgRef.current) return;
      // Non-passive and always cancelled: otherwise a trackpad pinch
      // (ctrl+wheel) zooms the whole page instead of the plan.
      event.preventDefault();
      tweenSlot.current.cancel();
      goalRef.current = null;
      fitted.current = false;

      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (sizeRef.current?.h ?? 800) : 1;
      let dx = event.deltaX * unit;
      let dy = event.deltaY * unit;
      const { sx, sy } = fromCentre(event.clientX, event.clientY);

      if (!event.ctrlKey && (event.shiftKey || Math.abs(dx) > Math.abs(dy))) {
        // Horizontal swipe, or Shift+wheel: pan rather than zoom.
        if (event.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        stopWheel();
        const ppm = c.k * PX_PER_M_AT_100;
        commit({ ...c, cx: c.cx + dx / ppm, cy: c.cy + dy / ppm });
        return;
      }

      const ppm = c.k * PX_PER_M_AT_100;
      const world = { x: c.cx + sx / ppm, z: c.cy + sy / ppm };

      if (event.ctrlKey) {
        // Trackpad pinch arrives as a dense stream of small ctrl+wheel deltas
        // and is already smooth: apply it directly, or it feels rubbery.
        stopWheel();
        const factor = Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01);
        commit(anchored(world, sx, sy, clampZoom(c.k * factor)));
        return;
      }

      // A wheel notch is ~100px; a trackpad swipe is many small deltas plus
      // momentum. Capping each event keeps the second from racing away.
      const factor = Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0022);
      const base = wheelAnim.current?.targetK ?? c.k;
      const targetK = clampZoom(base * factor);

      if (prefersReducedMotion()) {
        commit(anchored(world, sx, sy, targetK));
        return;
      }

      if (wheelAnim.current) {
        Object.assign(wheelAnim.current, { targetK, world, sx, sy });
        return;
      }
      const state = { frame: 0, targetK, world, sx, sy, last: performance.now() };
      wheelAnim.current = state;
      const step = (now: number) => {
        const cur = camRef.current;
        if (!cur || wheelAnim.current !== state) return;
        const dt = Math.min(64, now - state.last);
        state.last = now;
        const alpha = 1 - Math.exp(-dt / WHEEL_TAU_MS);
        const logK = lerp(Math.log(cur.k), Math.log(state.targetK), alpha);
        const done = Math.abs(logK - Math.log(state.targetK)) < 0.002;
        commit(anchored(state.world, state.sx, state.sy, done ? state.targetK : Math.exp(logK)));
        if (done) wheelAnim.current = null;
        else state.frame = requestAnimationFrame(step);
      };
      state.frame = requestAnimationFrame(step);
    },
    [commit, fromCentre, stopWheel],
  );

  // Handles and hairlines are authored in metres (the SVG user unit), so the
  // stage size is needed to derive pixels-per-metre. This is a callback ref
  // rather than an effect because the <svg> is not mounted on the first render.
  const observer = useRef<ResizeObserver | null>(null);
  const attachSvg = useCallback(
    (node: SVGSVGElement | null) => {
      const previous = svgRef.current;
      previous?.removeEventListener('wheel', onWheel);
      svgRef.current = node;
      observer.current?.disconnect();
      if (!node) return;
      node.addEventListener('wheel', onWheel, { passive: false });
      const measure = (w: number, h: number) => {
        if (w < 1 || h < 1) return;
        const next = { w, h };
        sizeRef.current = next;
        setSize(next);
        // Frame the plan; once the user zooms or pans, the view is theirs
        // and a resize keeps its centre and scale instead.
        if (!camRef.current || (fitted.current && !tweenSlot.current.running)) {
          const initial = fitCam();
          if (initial) commit(initial);
        }
      };
      observer.current = new ResizeObserver(([entry]) =>
        measure(entry.contentRect.width, entry.contentRect.height),
      );
      observer.current.observe(node);
      const rect = node.getBoundingClientRect();
      measure(rect.width, rect.height);
    },
    [onWheel, fitCam, commit],
  );

  useEffect(
    () => () => {
      tweenSlot.current.cancel();
      stopWheel();
      observer.current?.disconnect();
    },
    [stopWheel],
  );

  const materialColor = useCallback(
    (id?: string) => catalog.materials.find((m) => m.id === id)?.color.hex ?? '#6B7177',
    [catalog],
  );

  // --- pointers: corner drags, pans, pinches -------------------------------

  const beginPinch = useCallback(() => {
    const ids = [...pointers.current.keys()].slice(0, 2) as [number, number];
    const a = pointers.current.get(ids[0])!;
    const b = pointers.current.get(ids[1])!;
    const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
    const world = toWorld(mid);
    const c = camRef.current;
    if (!world || !c) return;
    gesture.current = {
      type: 'pinch',
      ids,
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      world,
      k: c.k,
    };
    fitted.current = false;
    setPanning(true);
  }, [toWorld]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    const c = camRef.current;
    if (!c) return;
    stopAnimations();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }

    const g = gesture.current;
    if (pointers.current.size === 2 && g.type !== 'corner') {
      beginPinch();
      return;
    }
    if (pointers.current.size > 1) return;

    const target = hitTarget(event.target);
    const at = { id: event.pointerId, x: event.clientX, y: event.clientY, cam: c };
    if (event.button === 1 || spaceRef.current) {
      event.preventDefault();
      gesture.current = { type: 'pan', ...at };
      fitted.current = false;
      setPanning(true);
    } else if (target.kind === 'handle') {
      gesture.current = { type: 'corner', id: event.pointerId, wallId: target.wallId, which: target.which };
      setDrag({ wallId: target.wallId, which: target.which });
      selection('wall', target.wallId);
    } else {
      gesture.current = { type: 'press', target, ...at };
    }
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const g = gesture.current;

      if (g.type === 'corner' && g.id === event.pointerId) {
        const world = toWorld(event);
        if (!world) return;
        const useSnap = snapRef.current && !event.altKey;
        const to = useSnap
          ? { x: Math.round(world.x / SNAP_M) * SNAP_M, z: Math.round(world.z / SNAP_M) * SNAP_M }
          : world;
        moveWallEndpoint(g.wallId, g.which, {
          x: Math.round(to.x * 1000) / 1000,
          z: Math.round(to.z * 1000) / 1000,
        });
      } else if (g.type === 'press' && g.id === event.pointerId) {
        if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > DRAG_SLOP) {
          gesture.current = { type: 'pan', id: g.id, x: g.x, y: g.y, cam: g.cam };
          fitted.current = false;
          setPanning(true);
          move(event);
        }
      } else if (g.type === 'pan' && g.id === event.pointerId) {
        const ppm = g.cam.k * PX_PER_M_AT_100;
        commit({
          ...g.cam,
          cx: g.cam.cx - (event.clientX - g.x) / ppm,
          cy: g.cam.cy - (event.clientY - g.y) / ppm,
        });
      } else if (g.type === 'pinch') {
        const a = pointers.current.get(g.ids[0]);
        const b = pointers.current.get(g.ids[1]);
        if (!a || !b || !svgRef.current) return;
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const { sx, sy } = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
        // The world point first pinched stays under the fingers' midpoint,
        // so a pinch zooms and a two-finger drag pans in the same gesture.
        commit(anchored(g.world, sx, sy, clampZoom((g.k * dist) / g.dist)));
      }
    };

    const up = (event: PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.delete(event.pointerId);
      const g = gesture.current;

      if (g.type === 'press' && g.id === event.pointerId && event.type === 'pointerup') {
        // A click, not a drag: only now does it select.
        const t = g.target;
        if (t.kind === 'room') {
          selection('room', t.id);
          setSurfaceTarget('FLOOR');
        } else if (t.kind === 'wall') {
          selection('wall', t.id);
        } else if (t.kind === 'bg') {
          selection(null, null);
        }
      }

      if (g.type === 'pinch' && pointers.current.size === 1) {
        // Lifting one finger continues as a one-finger pan, not a jump.
        const [id, p] = [...pointers.current.entries()][0];
        const c = camRef.current;
        if (c) {
          gesture.current = { type: 'pan', id, x: p.x, y: p.y, cam: c };
          return;
        }
      }
      const ended =
        pointers.current.size === 0 || (g.type !== 'pinch' && 'id' in g && g.id === event.pointerId);
      if (ended) {
        gesture.current = { type: 'none' };
        setPanning(false);
        setDrag(null);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [toWorld, fromCentre, moveWallEndpoint, commit, selection, setSurfaceTarget]);

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (event.code === 'Space') {
        if (!hovering.current && !spaceRef.current) return;
        // Keep Space from scrolling or re-pressing a focused button.
        event.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
        }
        return;
      }
      // Cmd/Ctrl +/- belong to the browser's page zoom.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
      else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_STEP);
      else if (event.key === '0' && !event.shiftKey) resetZoom();
      else if (event.key === '1' || event.key === '!' || event.code === 'Digit1') fit();
      else return;
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space' && spaceRef.current) {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [zoomBy, resetZoom, fit]);

  const view: ViewBox | null =
    cam && size
      ? (() => {
          const ppm = cam.k * PX_PER_M_AT_100;
          const w = size.w / ppm;
          const h = size.h / ppm;
          return { x: cam.cx - w / 2, y: cam.cy - h / 2, w, h };
        })()
      : null;

  if (!floor) return <div className="plan-empty">No floor plan</div>;

  const zoom = cam?.k ?? 1;
  const goalK = goalRef.current?.k ?? wheelAnim.current?.targetK ?? zoom;
  const toolbar = (
    <div className="plan-toolbar">
      <span className="plan-title">Ground Floor</span>
      <button
        className={`chip ${snap ? 'chip-on' : ''}`}
        onClick={() => setSnap((s) => !s)}
        title="Hold Alt while dragging to bypass"
      >
        Snap {SNAP_M * 100} cm
      </button>
      <span className="plan-readout">
        {cursor ? (
          <>
            x <b>{cursor.x.toFixed(2)}</b> &nbsp;y <b>{cursor.z.toFixed(2)}</b> m
          </>
        ) : (
          'drag corners to edit'
        )}
      </span>
    </div>
  );

  const svgClass = `plan-svg ${spaceHeld ? 'plan-svg-grab' : ''} ${panning ? 'plan-svg-panning' : ''}`;
  const svgHandlers = {
    ref: attachSvg,
    className: svgClass,
    onPointerDown,
    onPointerMove: (event: React.PointerEvent) => setCursor(toWorld(event)),
    onPointerEnter: () => (hovering.current = true),
    onPointerLeave: () => {
      hovering.current = false;
      setCursor(null);
    },
  };

  if (!view) {
    // The stage has to exist before it can be measured.
    return (
      <div className="plan-root">
        {toolbar}
        <div className="plan-stage">
          <svg {...svgHandlers} />
        </div>
      </div>
    );
  }

  const endpoints: Array<{ key: string; wallId: string; which: 'start' | 'end'; p: Vec2 }> = [];
  const seen = new Set<string>();
  for (const wall of floor.walls) {
    for (const which of ['start', 'end'] as const) {
      const p = wall[which];
      const key = `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push({ key, wallId: wall.id, which, p });
    }
  }

  const selectedWall =
    selected.kind === 'wall' ? floor.walls.find((w) => w.id === selected.id) : undefined;
  const pxPerM = zoom * PX_PER_M_AT_100;
  // Everything decorative is authored in screen pixels and converted here, so
  // hairlines, handles and labels stay the same size at every zoom level.
  const px = (pixels: number) => pixels / pxPerM;
  const hair = px(1);
  // The metre grid turns to noise when a metre is only a few pixels wide.
  const minorGrid = Math.max(0, Math.min(1, (pxPerM - 7) / 14));

  // A scale bar is the cheapest way to make a plan read as a drawing rather
  // than a diagram; it is sized to whatever round number lands near 90px, and
  // sits just above the zoom cluster.
  const scaleM = niceLength(px(90));
  const scaleX = view.x + view.w - px(18) - scaleM;
  const scaleY = view.y + view.h - px(58);

  const fresh = lastApplied && lastApplied.at > mountedAt.current ? lastApplied : null;

  return (
    <div className="plan-root">
      {toolbar}

      <div className="plan-stage">
        <svg {...svgHandlers} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
          <defs>
            <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path
                d="M 1 0 L 0 0 0 1"
                fill="none"
                stroke="#1b1f26"
                strokeOpacity={minorGrid}
                strokeWidth={hair}
              />
            </pattern>
            <pattern id="plan-grid-5" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="url(#plan-grid)" />
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#252b34" strokeWidth={hair * 1.4} />
            </pattern>
            {/* Poché for the selected room — a drafting convention that reads at
                any zoom, unlike a heavier fill. Spacing is in screen pixels. */}
            <pattern
              id="plan-hatch"
              width={px(7)}
              height={px(7)}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={px(7)}
                stroke="rgba(91,211,227,0.30)"
                strokeWidth={hair * 1.2}
              />
            </pattern>
          </defs>

          <rect
            id="plan-bg"
            x={view.x}
            y={view.y}
            width={view.w}
            height={view.h}
            fill="url(#plan-grid-5)"
          />

          {/* Rooms */}
          {floor.rooms.map((room: Room) => {
            const isSelected = selected.kind === 'room' && selected.id === room.id;
            const centroid = polygonCentroid(room.polygon);
            const points = room.polygon.map((p) => `${p.x},${p.z}`).join(' ');
            const rb = planBounds([room]);
            // Labels hold a constant screen size, so a room too small on
            // screen to carry them drops them instead of overflowing.
            const roomW = rb.size.x * pxPerM;
            const roomH = rb.size.z * pxPerM;
            const nameFits = roomW > room.name.length * 6.8 + 8 && roomH > 28;
            const areaFits = nameFits && roomH > 44;
            const pulse =
              fresh && fresh.kind === 'room' && fresh.id === room.id ? fresh.at : null;
            return (
              <g
                key={room.id}
                className={`plan-room ${isSelected ? 'plan-room-selected' : ''}`}
              >
                <polygon
                  className="plan-room-fill"
                  points={points}
                  fill={materialColor(room.floorMaterialId)}
                  fillOpacity={isSelected ? 0.5 : 0.26}
                  data-hit="room"
                  data-id={room.id}
                />
                {isSelected && (
                  <g className="plan-sel-in" pointerEvents="none">
                    <polygon points={points} fill="url(#plan-hatch)" />
                    <polygon
                      points={points}
                      fill="none"
                      stroke="#5BD3E3"
                      strokeWidth={hair * 2}
                      strokeLinejoin="round"
                    />
                  </g>
                )}
                {pulse !== null && (
                  <polygon
                    key={pulse}
                    className="plan-pulse"
                    points={points}
                    strokeWidth={px(3)}
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )}
                {nameFits && (
                  <text
                    x={centroid.x}
                    y={centroid.z - px(3)}
                    className="plan-room-name"
                    style={{ fontSize: px(12.5), strokeWidth: px(3) }}
                  >
                    {room.name}
                  </text>
                )}
                {areaFits && (
                  <text
                    x={centroid.x}
                    y={centroid.z + px(12)}
                    className="plan-room-area"
                    style={{ fontSize: px(10.5), strokeWidth: px(2.5) }}
                  >
                    {fmtArea(polygonArea(room.polygon))}
                  </text>
                )}
              </g>
            );
          })}

          {/* Walls */}
          {floor.walls.map((wall) => {
            const isSelected = selected.kind === 'wall' && selected.id === wall.id;
            const quad = wallQuad(wall);
            const pulse =
              fresh && fresh.kind === 'wall' && fresh.id === wall.id ? fresh.at : null;
            return (
              <g key={wall.id}>
                {/* A halo rather than a flood fill: the poché stays readable as
                    masonry while the selection is unmistakable at any zoom. */}
                {isSelected && (
                  <polygon
                    className="plan-sel-in"
                    points={quad}
                    fill="none"
                    stroke="#5BD3E3"
                    strokeOpacity={0.4}
                    strokeWidth={px(7)}
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )}
                <polygon
                  points={quad}
                  fill={wall.exterior ? '#D3D9E0' : '#79828F'}
                  stroke={isSelected ? '#5BD3E3' : '#0C0E12'}
                  strokeWidth={isSelected ? px(1.6) : hair}
                  strokeLinejoin="round"
                  className="plan-wall"
                  data-hit="wall"
                  data-id={wall.id}
                />
                {pulse !== null && (
                  <polygon
                    key={pulse}
                    className="plan-pulse"
                    points={quad}
                    strokeWidth={px(5)}
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}

          {/* Openings punched through the wall fill */}
          {floor.openings.map((opening) => {
            const wall = floor.walls.find((w) => w.id === opening.wallId);
            if (!wall) return null;
            const r = openingRect(wall, opening);
            return (
              <g key={opening.id} className="plan-opening" pointerEvents="none">
                <polygon
                  points={`${r.a.x},${r.a.z} ${r.b.x},${r.b.z} ${r.c.x},${r.c.z} ${r.d.x},${r.d.z}`}
                  fill="#0F1217"
                />
                {r.isDoor ? (
                  <path
                    d={`M ${r.a.x - (r.a.x - r.d.x) / 2},${r.a.z - (r.a.z - r.d.z) / 2}
                        L ${r.b.x - (r.b.x - r.c.x) / 2},${r.b.z - (r.b.z - r.c.z) / 2}`}
                    stroke="#5BD3E3"
                    strokeWidth={hair * 2}
                    fill="none"
                  />
                ) : (
                  <line
                    x1={r.cx - r.dx * r.half}
                    y1={r.cz - r.dz * r.half}
                    x2={r.cx + r.dx * r.half}
                    y2={r.cz + r.dz * r.half}
                    stroke="#9BD8FF"
                    strokeWidth={hair * 2.5}
                  />
                )}
              </g>
            );
          })}

          {/* Selected wall dimension, on a plate so it survives any background */}
          {selectedWall &&
            (() => {
              const label = metres(wallLength(selectedWall));
              const size = px(11);
              const cx = (selectedWall.start.x + selectedWall.end.x) / 2;
              const cy = (selectedWall.start.z + selectedWall.end.z) / 2 - px(14);
              const w = label.length * size * 0.62 + size * 0.7;
              return (
                <g pointerEvents="none" className="plan-sel-in">
                  <rect
                    x={cx - w / 2}
                    y={cy - size * 0.86}
                    width={w}
                    height={size * 1.22}
                    rx={size * 0.3}
                    fill="#5BD3E3"
                  />
                  <text x={cx} y={cy} className="plan-dim" style={{ fontSize: size }}>
                    {label}
                  </text>
                </g>
              );
            })()}

          {/* Draggable corners */}
          {endpoints.map((endpoint) => {
            const active = drag?.wallId === endpoint.wallId;
            return (
              <g key={endpoint.key}>
                {/* An invisible, comfortably sized grab target around the dot. */}
                <circle
                  cx={endpoint.p.x}
                  cy={endpoint.p.z}
                  r={px(11)}
                  fill="transparent"
                  className="plan-handle-hit"
                  data-hit="handle"
                  data-wall={endpoint.wallId}
                  data-which={endpoint.which}
                />
                <circle
                  cx={endpoint.p.x}
                  cy={endpoint.p.z}
                  r={px(4.5)}
                  strokeWidth={px(1.8)}
                  className={`plan-handle ${active ? 'plan-handle-active' : ''}`}
                />
              </g>
            );
          })}

          {/* Scale bar */}
          <g pointerEvents="none" className="plan-scale">
            <line
              x1={scaleX}
              y1={scaleY}
              x2={scaleX + scaleM}
              y2={scaleY}
              stroke="#4A5260"
              strokeWidth={px(1.5)}
            />
            <line
              x1={scaleX}
              y1={scaleY - px(3.5)}
              x2={scaleX}
              y2={scaleY + px(3.5)}
              stroke="#4A5260"
              strokeWidth={px(1.5)}
            />
            <line
              x1={scaleX + scaleM}
              y1={scaleY - px(3.5)}
              x2={scaleX + scaleM}
              y2={scaleY + px(3.5)}
              stroke="#4A5260"
              strokeWidth={px(1.5)}
            />
            <text
              x={scaleX + scaleM / 2}
              y={scaleY - px(6)}
              className="plan-scale-text"
              style={{ fontSize: px(10) }}
            >
              {scaleM < 1 ? `${Math.round(scaleM * 100)} cm` : `${scaleM} m`}
            </text>
          </g>
        </svg>

        <div className="plan-legend">
          <span>
            <i style={{ background: '#D3D9E0' }} />
            exterior
          </span>
          <span>
            <i style={{ background: '#79828F' }} />
            interior
          </span>
          <span>
            <i style={{ background: '#9BD8FF' }} />
            glazing
          </span>
        </div>

        <ZoomCluster
          className="plan-zoom"
          onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          canZoomOut={goalK > MIN_ZOOM + EPS_ZOOM}
          canZoomIn={goalK < MAX_ZOOM - EPS_ZOOM}
          zoomOutTitle="Zoom out (−)"
          zoomInTitle="Zoom in (+)"
          readout={{
            label: `${Math.round(zoom * 100)}%`,
            title: 'Reset to 100% — 1:100 at 96 dpi (0)',
            onClick: resetZoom,
          }}
          onFit={fit}
          fitLabel="Fit"
          fitTitle="Frame the whole plan (1)"
        />
      </div>
    </div>
  );
}
