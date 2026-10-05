import { useStore } from '../store';
import { polygonArea, wallLength } from '../lib/planMath';
import { area as fmtArea, metres } from '../lib/format';
import { canEditWall, effectivePolicy } from '@shared/rules';
import { IconLock } from './icons';

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const catalog = useStore((s) => s.catalog);
  const setWallHeight = useStore((s) => s.setWallHeight);
  const setWallThickness = useStore((s) => s.setWallThickness);
  const select = useStore((s) => s.select);
  const setPolicy = useStore((s) => s.setPolicy);

  const floor = project.floors[0];
  const name = (id?: string) => catalog.materials.find((m) => m.id === id)?.name ?? '— none —';

  if (!floor) return null;

  if (selection.kind === 'room') {
    const room = floor.rooms.find((r) => r.id === selection.id);
    if (!room) return <Empty onRoof={() => select('roof', 'roof')} />;
    return (
      <div className="panel inspector">
        <header className="panel-header panel-title">
          <h2>{room.name}</h2>
          <span className="badge badge-quiet">room</span>
        </header>
        <dl className="facts">
          <Fact label="Floor area" value={fmtArea(polygonArea(room.polygon))} numeric />
          <Fact label="Ceiling height" value={metres(room.ceilingHeightM)} numeric />
          <Fact label="Floor finish" value={name(room.floorMaterialId)} />
          <Fact label="Ceiling finish" value={name(room.ceilingMaterialId)} />
        </dl>
      </div>
    );
  }

  if (selection.kind === 'wall') {
    const wall = floor.walls.find((w) => w.id === selection.id);
    if (!wall) return <Empty onRoof={() => select('roof', 'roof')} />;
    const policy = effectivePolicy(project);
    const editable = canEditWall(project, wall.id, policy);
    // Height and thickness are not PlanEdits, so they cannot be proposed:
    // under review they wait for someone with the plan open at Full.
    const geometryReason = !editable.allowed
      ? editable.reason
      : policy.requireReview
        ? 'Review is on — height and thickness changes cannot be proposed yet.'
        : undefined;
    const locked = policy.lockedWallIds.includes(wall.id);
    const toggleLock = () =>
      setPolicy({
        lockedWallIds: locked
          ? policy.lockedWallIds.filter((id) => id !== wall.id)
          : [...policy.lockedWallIds, wall.id],
      });
    return (
      <div className="panel inspector">
        <header className="panel-header panel-title">
          <h2>{wall.exterior ? 'Exterior wall' : 'Interior wall'}</h2>
          <span className="badge badge-quiet mono">{wall.id}</span>
        </header>
        {(locked || !editable.allowed) && (
          <p className="lock-note">
            <IconLock size={12} />
            <span>{editable.reason ?? 'Locked as load-bearing — only Full level can move it.'}</span>
          </p>
        )}
        <dl className="facts">
          <Fact label="Length" value={metres(wallLength(wall))} numeric />
          <Fact label="Gross face" value={fmtArea(wallLength(wall) * wall.heightM)} numeric />
          <Fact label="Inside finish" value={name(wall.interiorMaterialId)} />
          {wall.exterior && <Fact label="Facade" value={name(wall.exteriorMaterialId)} />}
        </dl>
        <label className="slider-row">
          <span>
            Height <b className="mono">{wall.heightM.toFixed(2)} m</b>
          </span>
          <input
            type="range"
            min={2.1}
            max={4}
            step={0.05}
            value={wall.heightM}
            disabled={Boolean(geometryReason)}
            title={geometryReason}
            onChange={(event) => setWallHeight(wall.id, Number(event.target.value))}
          />
        </label>
        <label className="slider-row">
          <span>
            Thickness <b className="mono">{(wall.thicknessM * 100).toFixed(0)} cm</b>
          </span>
          <input
            type="range"
            min={0.06}
            max={0.45}
            step={0.01}
            value={wall.thicknessM}
            disabled={Boolean(geometryReason)}
            title={geometryReason}
            onChange={(event) => setWallThickness(wall.id, Number(event.target.value))}
          />
        </label>
        {policy.level === 'FULL' && (
          <button className={`chip lock-chip ${locked ? 'chip-on' : ''}`} onClick={toggleLock} aria-pressed={locked}>
            <IconLock size={11} />
            {locked ? 'Locked as load-bearing' : 'Lock as load-bearing'}
          </button>
        )}
      </div>
    );
  }

  if (selection.kind === 'roof' && project.roof) {
    return (
      <div className="panel inspector">
        <header className="panel-header panel-title">
          <h2>Roof</h2>
          <span className="badge badge-quiet">{project.roof.kind.toLowerCase()}</span>
        </header>
        <dl className="facts">
          <Fact label="Pitch" value={`${project.roof.pitchDeg}°`} numeric />
          <Fact label="Overhang" value={metres(project.roof.overhangM)} numeric />
          <Fact label="Covering" value={name(project.roof.materialId)} />
        </dl>
      </div>
    );
  }

  return <Empty onRoof={() => select('roof', 'roof')} />;
}

function Empty({ onRoof }: { onRoof: () => void }) {
  return (
    <div className="panel inspector">
      <header className="panel-header panel-title">
        <h2 style={{ color: 'var(--text-3)' }}>Nothing selected</h2>
      </header>
      <p className="hint">
        Click a room or a wall — in the plan or in 3D — to inspect it and apply finishes. Drag the
        round corner handles in the plan to move walls, hold <kbd>Alt</kbd> to ignore the snap.
      </p>
      <button className="btn btn-small" onClick={onRoof} style={{ alignSelf: 'flex-start' }}>
        Select the roof
      </button>
    </div>
  );
}

function Fact({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className={`fact ${numeric ? 'fact-num' : ''}`} title={value}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
