import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Opening, Room, Vec2, Wall } from '@shared/types';
import { useStore } from '../store';
import { polygonArea, polygonCentroid, planBounds, wallLength } from '../lib/geometry';
import { area as fmtArea, metres } from '../lib/format';

const SNAP_M = 0.1;
const PADDING_M = 2.2;

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

export function PlanEditor() {
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const selection = useStore((s) => s.select);
  const selected = useStore((s) => s.selection);
  const setSurfaceTarget = useStore((s) => s.setSurfaceTarget);
  const moveWallEndpoint = useStore((s) => s.moveWallEndpoint);

  const floor = project.floors[0];
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const [drag, setDrag] = useState<{ wallId: string; which: 'start' | 'end' } | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [snap, setSnap] = useState(true);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [pixelWidth, setPixelWidth] = useState(800);

  // Handles and hairlines are authored in metres (the SVG user unit), so they
  // need the current pixels-per-metre to stay a constant size on screen. This
  // is a callback ref rather than an effect because the <svg> is not mounted
  // on the first render.
  const observer = useRef<ResizeObserver | null>(null);
  const attachSvg = useCallback((node: SVGSVGElement | null) => {
    svgRef.current = node;
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new ResizeObserver(([entry]) => {
      setPixelWidth(entry.contentRect.width || 800);
    });
    observer.current.observe(node);
    setPixelWidth(node.getBoundingClientRect().width || 800);
  }, []);

  const bounds = useMemo(() => planBounds(floor?.rooms ?? []), [floor]);

  // Frame the plan once; afterwards the user owns the view.
  useEffect(() => {
    if (view) return;
    setView({
      x: bounds.min.x - PADDING_M,
      y: bounds.min.z - PADDING_M,
      w: bounds.size.x + PADDING_M * 2,
      h: bounds.size.z + PADDING_M * 2,
    });
  }, [bounds, view]);

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, z: point.y };
  }, []);

  const materialColor = useCallback(
    (id?: string) => catalog.materials.find((m) => m.id === id)?.color.hex ?? '#6B7177',
    [catalog],
  );

  // --- interaction --------------------------------------------------------

  useEffect(() => {
    if (!drag && !pan) return;
    const move = (event: PointerEvent) => {
      if (drag) {
        const world = toWorld(event);
        if (!world) return;
        const useSnap = snap && !event.altKey;
        const to = useSnap
          ? { x: Math.round(world.x / SNAP_M) * SNAP_M, z: Math.round(world.z / SNAP_M) * SNAP_M }
          : world;
        moveWallEndpoint(drag.wallId, drag.which, {
          x: Math.round(to.x * 1000) / 1000,
          z: Math.round(to.z * 1000) / 1000,
        });
      } else if (pan && view && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const scale = view.w / rect.width;
        setView({
          ...view,
          x: pan.vx - (event.clientX - pan.x) * scale,
          y: pan.vy - (event.clientY - pan.y) * scale,
        });
      }
    };
    const up = () => {
      setDrag(null);
      setPan(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, pan, view, toWorld, moveWallEndpoint, snap]);

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!view) return;
    const world = toWorld(event);
    if (!world) return;
    const factor = Math.exp(event.deltaY * 0.0012);
    const w = Math.max(2, Math.min(200, view.w * factor));
    const h = (w / view.w) * view.h;
    setView({
      x: world.x - ((world.x - view.x) * w) / view.w,
      y: world.z - ((world.z - view.y) * h) / view.h,
      w,
      h,
    });
  };

  if (!floor || !view) return <div className="plan-empty">No floor plan</div>;

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
  const pxPerM = pixelWidth / view.w;
  const px = (pixels: number) => pixels / pxPerM;
  const hair = px(1);

  return (
    <div className="plan-root">
      <div className="plan-toolbar">
        <span className="plan-title">Ground Floor</span>
        <button
          className={`chip ${snap ? 'chip-on' : ''}`}
          onClick={() => setSnap((s) => !s)}
          title="Hold Alt while dragging to bypass"
        >
          Snap {SNAP_M * 100} cm
        </button>
        <button
          className="chip"
          onClick={() =>
            setView({
              x: bounds.min.x - PADDING_M,
              y: bounds.min.z - PADDING_M,
              w: bounds.size.x + PADDING_M * 2,
              h: bounds.size.z + PADDING_M * 2,
            })
          }
        >
          Fit
        </button>
        <span className="plan-readout">
          {cursor ? `${cursor.x.toFixed(2)}, ${cursor.z.toFixed(2)} m` : 'drag corners to edit'}
        </span>
      </div>

      <svg
        ref={attachSvg}
        className="plan-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={onWheel}
        onPointerMove={(event) => setCursor(toWorld(event))}
        onPointerLeave={() => setCursor(null)}
        onPointerDown={(event) => {
          if (event.target === svgRef.current || (event.target as Element).id === 'plan-bg') {
            selection(null, null);
            setPan({ x: event.clientX, y: event.clientY, vx: view.x, vy: view.y });
          }
        }}
      >
        <defs>
          <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#242830" strokeWidth={hair} />
          </pattern>
          <pattern id="plan-grid-5" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="url(#plan-grid)" />
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#2F3540" strokeWidth={hair * 1.6} />
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
          return (
            <g key={room.id} className="plan-room">
              <polygon
                points={room.polygon.map((p) => `${p.x},${p.z}`).join(' ')}
                fill={materialColor(room.floorMaterialId)}
                fillOpacity={isSelected ? 0.45 : 0.24}
                stroke={isSelected ? '#6EE7F2' : 'transparent'}
                strokeWidth={hair * 2.5}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selection('room', room.id);
                  setSurfaceTarget('FLOOR');
                }}
              />
              <text
                x={centroid.x}
                y={centroid.z - 0.18}
                className="plan-room-name"
                style={{ fontSize: Math.min(0.42, view.w / 34) }}
              >
                {room.name}
              </text>
              <text
                x={centroid.x}
                y={centroid.z + 0.42}
                className="plan-room-area"
                style={{ fontSize: Math.min(0.34, view.w / 44) }}
              >
                {fmtArea(polygonArea(room.polygon))}
              </text>
            </g>
          );
        })}

        {/* Walls */}
        {floor.walls.map((wall) => {
          const isSelected = selected.kind === 'wall' && selected.id === wall.id;
          return (
            <polygon
              key={wall.id}
              points={wallQuad(wall)}
              fill={isSelected ? '#6EE7F2' : wall.exterior ? '#CED4DA' : '#8C949D'}
              stroke={isSelected ? '#A8F1F8' : '#1A1D23'}
              strokeWidth={hair}
              className="plan-wall"
              onPointerDown={(event) => {
                event.stopPropagation();
                selection('wall', wall.id);
              }}
            />
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
                fill="#171A20"
              />
              {r.isDoor ? (
                <path
                  d={`M ${r.a.x - (r.a.x - r.d.x) / 2},${r.a.z - (r.a.z - r.d.z) / 2}
                      L ${r.b.x - (r.b.x - r.c.x) / 2},${r.b.z - (r.b.z - r.c.z) / 2}`}
                  stroke="#6EE7F2"
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

        {/* Selected wall dimension */}
        {selectedWall && (
          <text
            x={(selectedWall.start.x + selectedWall.end.x) / 2}
            y={(selectedWall.start.z + selectedWall.end.z) / 2 - 0.35}
            className="plan-dim"
            style={{ fontSize: Math.min(0.36, view.w / 42) }}
          >
            {metres(wallLength(selectedWall))}
          </text>
        )}

        {/* Draggable corners */}
        {endpoints.map((endpoint) => {
          const grab = (event: React.PointerEvent) => {
            event.stopPropagation();
            setDrag({ wallId: endpoint.wallId, which: endpoint.which });
            selection('wall', endpoint.wallId);
          };
          return (
            <g key={endpoint.key} onPointerDown={grab}>
              {/* An invisible, comfortably sized grab target around the dot. */}
              <circle cx={endpoint.p.x} cy={endpoint.p.z} r={px(11)} fill="transparent" />
              <circle
                cx={endpoint.p.x}
                cy={endpoint.p.z}
                r={px(4.5)}
                strokeWidth={px(1.8)}
                className={`plan-handle ${
                  drag?.wallId === endpoint.wallId ? 'plan-handle-active' : ''
                }`}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
