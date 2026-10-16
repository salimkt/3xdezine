import { memo, useMemo } from 'react';
import type { ModularItem } from '@shared/business';
import type { Project } from '@shared/types';
import { priceModular } from '@shared/modular';
import { roomWallRuns } from '@shared/trades';
import type { WallPick } from '../workspace';

/**
 * Modular runs drawn on the plan: each module's footprint as a rectangle
 * along its wall (base and tall solid, wall units and lofts dashed, since
 * they hang above), and — while picking walls for a new run — the room's
 * candidate walls highlighted. Lazy: only loaded once a plan has modular
 * items or a pick is in progress.
 */
export default memo(function PlanModular({ project, items, pick, px, editingId }: {
  project: Project;
  items: ModularItem[];
  pick: WallPick | null;
  px: (pixels: number) => number;
  editingId: string | null;
}) {
  const boxes = useMemo(
    () =>
      items.flatMap((item) => {
        try {
          return priceModular(item, undefined, project).boxes.map((b) => ({ ...b, itemId: item.id }));
        } catch {
          return [];
        }
      }),
    [items, project],
  );

  const candidates = useMemo(() => {
    if (!pick) return [];
    for (const floor of project.floors) {
      const room = floor.rooms.find((r) => r.id === pick.roomId);
      if (room) return roomWallRuns(floor, room);
    }
    return [];
  }, [pick, project]);

  // Lower zones first so base footprints sit under the dashed wall-unit outlines.
  const order = { BASE: 0, TALL: 1, WALL: 2, LOFT: 3 } as const;
  const sorted = [...boxes].sort((a, b) => order[a.zone] - order[b.zone]);

  return (
    <g className="plan-modular" pointerEvents="none">
      {sorted.map((b) => {
        const deg = (-b.rotationY * 180) / Math.PI;
        const above = b.zone === 'WALL' || b.zone === 'LOFT';
        const counter = b.moduleId.endsWith('-countertop');
        const on = b.itemId === editingId;
        return (
          <g key={`${b.itemId}:${b.moduleId}`} transform={`translate(${b.center.x} ${b.center.z}) rotate(${deg})`}>
            <rect
              x={-b.size.x / 2}
              y={-b.size.z / 2}
              width={b.size.x}
              height={b.size.z}
              fill={counter ? 'none' : above ? 'none' : b.colorHex}
              fillOpacity={0.55}
              stroke={counter ? '#9aa3af' : on ? '#6EE7F2' : above ? '#c9b98f' : '#3c3a35'}
              strokeWidth={px(above ? 1 : 1.2)}
              strokeDasharray={above ? `${px(4)} ${px(3)}` : counter ? `${px(1.5)} ${px(2.5)}` : undefined}
            />
          </g>
        );
      })}
      {candidates.map((r, i) => {
        const w = r.wall;
        const L = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1;
        const ux = (w.end.x - w.start.x) / L;
        const uz = (w.end.z - w.start.z) / L;
        const picked = pick!.wallIds.includes(w.id);
        return (
          <line
            key={`${w.id}-${i}`}
            x1={w.start.x + ux * r.from}
            y1={w.start.z + uz * r.from}
            x2={w.start.x + ux * r.to}
            y2={w.start.z + uz * r.to}
            stroke={picked ? '#e0bd80' : '#5bd3e3'}
            strokeOpacity={picked ? 0.95 : 0.5}
            strokeWidth={Math.max(w.thicknessM, px(6))}
            strokeLinecap="butt"
          />
        );
      })}
    </g>
  );
});
