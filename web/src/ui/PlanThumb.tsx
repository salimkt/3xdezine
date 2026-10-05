import { memo } from 'react';
import type { Catalog, Project } from '@shared/types';
import { planBounds, wallLength } from '../lib/planMath';

/**
 * A plan drawn straight from the project JSON: rooms filled with their floor
 * finish's catalogue colour, walls stroked at their real thickness, openings
 * left as gaps (glazing as a hairline). No image, so a template costs only its
 * own few KB of JSON.
 */
export const PlanThumb = memo(function PlanThumb({
  project,
  catalog,
  className,
}: {
  project: Project;
  catalog: Catalog;
  className?: string;
}) {
  const floor = project.floors[0];
  if (!floor) return null;
  const b = planBounds(floor.rooms);
  const pad = Math.max(b.size.x, b.size.z) * 0.08 + 0.4;
  const colour = new Map(catalog.materials.map((m) => [m.id, m.color.hex]));

  const segments: Array<{ key: string; x1: number; z1: number; x2: number; z2: number; w: number; ext: boolean }> = [];
  const glazing: Array<{ key: string; x1: number; z1: number; x2: number; z2: number }> = [];
  for (const wall of floor.walls) {
    const len = wallLength(wall) || 1;
    const at = (t: number) => ({
      x: wall.start.x + (wall.end.x - wall.start.x) * t,
      z: wall.start.z + (wall.end.z - wall.start.z) * t,
    });
    const holes = floor.openings
      .filter((o) => o.wallId === wall.id)
      .map((o) => ({
        a: Math.max(0, o.t - o.widthM / 2 / len),
        b: Math.min(1, o.t + o.widthM / 2 / len),
        glass: o.sillM > 0.05,
        id: o.id,
      }))
      .sort((p, q) => p.a - q.a);
    let cursor = 0;
    const push = (from: number, to: number, i: number) => {
      if (to - from < 1e-3) return;
      const p = at(from);
      const q = at(to);
      segments.push({ key: `${wall.id}-${i}`, x1: p.x, z1: p.z, x2: q.x, z2: q.z, w: wall.thicknessM, ext: wall.exterior });
    };
    holes.forEach((hole, i) => {
      push(cursor, hole.a, i);
      if (hole.glass) {
        const p = at(hole.a);
        const q = at(hole.b);
        glazing.push({ key: hole.id, x1: p.x, z1: p.z, x2: q.x, z2: q.z });
      }
      cursor = Math.max(cursor, hole.b);
    });
    push(cursor, 1, holes.length);
  }

  return (
    <svg
      className={className}
      viewBox={`${b.min.x - pad} ${b.min.z - pad} ${b.size.x + pad * 2} ${b.size.z + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {floor.rooms.map((room) => (
        <polygon
          key={room.id}
          points={room.polygon.map((p) => `${p.x},${p.z}`).join(' ')}
          fill={colour.get(room.floorMaterialId ?? '') ?? '#59606b'}
          fillOpacity={0.62}
        />
      ))}
      {segments.map((s) => (
        <line
          key={s.key}
          x1={s.x1}
          y1={s.z1}
          x2={s.x2}
          y2={s.z2}
          stroke={s.ext ? '#dfe4ea' : '#9aa3af'}
          strokeWidth={s.w}
          strokeLinecap="square"
        />
      ))}
      {glazing.map((g) => (
        <line key={g.key} x1={g.x1} y1={g.z1} x2={g.x2} y2={g.z2} stroke="#9BD8FF" strokeWidth={0.06} />
      ))}
    </svg>
  );
});

