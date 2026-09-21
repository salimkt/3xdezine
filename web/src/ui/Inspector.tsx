import { useStore } from '../store';
import { polygonArea, wallLength } from '../lib/geometry';
import { area as fmtArea, metres } from '../lib/format';

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const catalog = useStore((s) => s.catalog);
  const setWallHeight = useStore((s) => s.setWallHeight);
  const setWallThickness = useStore((s) => s.setWallThickness);
  const select = useStore((s) => s.select);

  const floor = project.floors[0];
  const name = (id?: string) => catalog.materials.find((m) => m.id === id)?.name ?? '— none —';

  if (!floor) return null;

  if (selection.kind === 'room') {
    const room = floor.rooms.find((r) => r.id === selection.id);
    if (!room) return <Empty onRoof={() => select('roof', 'roof')} />;
    return (
      <div className="panel inspector">
        <header className="panel-header">
          <h2>{room.name}</h2>
          <span className="badge badge-quiet">room</span>
        </header>
        <dl className="facts">
          <Fact label="Floor area" value={fmtArea(polygonArea(room.polygon))} />
          <Fact label="Ceiling height" value={metres(room.ceilingHeightM)} />
          <Fact label="Floor finish" value={name(room.floorMaterialId)} />
          <Fact label="Ceiling finish" value={name(room.ceilingMaterialId)} />
        </dl>
      </div>
    );
  }

  if (selection.kind === 'wall') {
    const wall = floor.walls.find((w) => w.id === selection.id);
    if (!wall) return <Empty onRoof={() => select('roof', 'roof')} />;
    return (
      <div className="panel inspector">
        <header className="panel-header">
          <h2>{wall.exterior ? 'Exterior wall' : 'Interior wall'}</h2>
          <span className="badge badge-quiet mono">{wall.id}</span>
        </header>
        <dl className="facts">
          <Fact label="Length" value={metres(wallLength(wall))} />
          <Fact label="Gross face" value={fmtArea(wallLength(wall) * wall.heightM)} />
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
            onChange={(event) => setWallThickness(wall.id, Number(event.target.value))}
          />
        </label>
      </div>
    );
  }

  if (selection.kind === 'roof' && project.roof) {
    return (
      <div className="panel inspector">
        <header className="panel-header">
          <h2>Roof</h2>
          <span className="badge badge-quiet">{project.roof.kind}</span>
        </header>
        <dl className="facts">
          <Fact label="Pitch" value={`${project.roof.pitchDeg}°`} />
          <Fact label="Overhang" value={metres(project.roof.overhangM)} />
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
      <header className="panel-header">
        <h2>Nothing selected</h2>
      </header>
      <p className="hint">
        Click a room or a wall — in the plan or in 3D — to inspect it and apply finishes. Drag the
        round corner handles in the plan to move walls.
      </p>
      <button className="btn btn-ghost btn-small" onClick={onRoof}>
        Select the roof
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
