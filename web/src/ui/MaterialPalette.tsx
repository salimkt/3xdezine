import { useMemo, useState } from 'react';
import type { Material, Surface, Tier } from '@shared/types';
import { materialsForSurface, targetsFor, useStore } from '../store';
import { moneyPrecise, unitLabel } from '../lib/format';

const SURFACE_LABEL: Record<Surface, string> = {
  FLOOR: 'Floor',
  WALL: 'Wall',
  CEILING: 'Ceiling',
  EXTERIOR_WALL: 'Facade',
  ROOF: 'Roof',
};

const TIER_ORDER: Tier[] = ['BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY'];

function currentMaterialId(): string | undefined {
  const { project, selection, surfaceTarget } = useStore.getState();
  const floor = project.floors[0];
  if (!floor) return undefined;
  if (selection.kind === 'room') {
    const room = floor.rooms.find((r) => r.id === selection.id);
    return surfaceTarget === 'CEILING' ? room?.ceilingMaterialId : room?.floorMaterialId;
  }
  if (selection.kind === 'wall') {
    const wall = floor.walls.find((w) => w.id === selection.id);
    return surfaceTarget === 'EXTERIOR_WALL' ? wall?.exteriorMaterialId : wall?.interiorMaterialId;
  }
  if (selection.kind === 'roof') return project.roof?.materialId;
  return undefined;
}

export function MaterialPalette() {
  const catalog = useStore((s) => s.catalog);
  const selection = useStore((s) => s.selection);
  const surfaceTarget = useStore((s) => s.surfaceTarget);
  const setSurfaceTarget = useStore((s) => s.setSurfaceTarget);
  const applyMaterial = useStore((s) => s.applyMaterial);
  const project = useStore((s) => s.project);

  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<Tier | 'ALL'>('ALL');

  const wall =
    selection.kind === 'wall'
      ? project.floors[0]?.walls.find((w) => w.id === selection.id)
      : undefined;
  const targets = targetsFor(selection.kind, wall);
  const applied = currentMaterialId();

  const materials = useMemo(() => {
    let list: Material[] = materialsForSurface(catalog, surfaceTarget);
    if (tier !== 'ALL') list = list.filter((m) => m.tier === tier);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.subtype.toLowerCase().includes(q) ||
          m.styleTags.some((t) => t.includes(q)),
      );
    }
    return list.sort(
      (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.pricePerUnit - b.pricePerUnit,
    );
  }, [catalog, surfaceTarget, tier, query]);

  const disabled = selection.kind === null;

  return (
    <div className="panel palette-panel">
      <header className="panel-header">
        <h2>Materials</h2>
        <span className="badge badge-quiet">{materials.length}</span>
      </header>

      {disabled ? (
        <p className="hint">Select a room, a wall or the roof to apply a finish.</p>
      ) : (
        <div className="surface-tabs">
          {targets.map((target) => (
            <button
              key={target}
              className={`tab ${surfaceTarget === target ? 'tab-on' : ''}`}
              onClick={() => setSurfaceTarget(target)}
            >
              {SURFACE_LABEL[target]}
            </button>
          ))}
        </div>
      )}

      <div className="palette-filters">
        <input
          className="input"
          placeholder="Search finishes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="input select"
          value={tier}
          onChange={(event) => setTier(event.target.value as Tier | 'ALL')}
        >
          <option value="ALL">All tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="swatch-grid">
        {materials.map((material) => (
          <button
            key={material.id}
            className={`swatch ${applied === material.id ? 'swatch-on' : ''}`}
            disabled={disabled}
            onClick={() => applyMaterial(material.id)}
            title={material.description}
          >
            <span className="swatch-chip" style={{ background: material.color.hex }}>
              <span className={`swatch-tier tier-${material.tier.toLowerCase()}`} />
            </span>
            <span className="swatch-name">{material.name}</span>
            <span className="swatch-price mono">
              {moneyPrecise(material.pricePerUnit, catalog.meta.baseCurrency)}
              <small>/{unitLabel(material.unit)}</small>
            </span>
          </button>
        ))}
        {materials.length === 0 && <p className="hint">Nothing matches that filter.</p>}
      </div>
    </div>
  );
}
