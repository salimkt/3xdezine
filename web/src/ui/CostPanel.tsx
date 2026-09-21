import { useMemo, useState } from 'react';
import { estimateCost } from '@shared/cost';
import type { CostBreakdown } from '@shared/types';
import { useStore } from '../store';
import { money, moneyPrecise, percent, quantity } from '../lib/format';

/**
 * The cost engine is imported from `shared/` and run locally on every edit, so
 * the panel updates with no round trip. The backend serves the identical
 * function at `POST /api/cost/estimate`, so the two can never disagree.
 */
export function useCost(): CostBreakdown {
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  return useMemo(() => estimateCost(project, catalog), [project, catalog]);
}

const SURFACE_LABEL: Record<string, string> = {
  FLOOR: 'Floors',
  WALL: 'Walls',
  CEILING: 'Ceilings',
  EXTERIOR_WALL: 'Facade',
  ROOF: 'Roof',
  COMPONENT: 'Doors, windows & fittings',
};

export function CostPanel() {
  const cost = useCost();
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const setContingency = useStore((s) => s.setContingency);
  const [expanded, setExpanded] = useState(true);

  const currency = cost.currency;
  const perSurface = Object.entries(cost.perSurface).sort((a, b) => b[1] - a[1]);
  const maxSurface = perSurface[0]?.[1] ?? 1;

  return (
    <div className="panel cost-panel">
      <header className="panel-header">
        <h2>Estimate</h2>
        <span className="badge badge-quiet">live</span>
      </header>

      {/* The three numbers must never be conflated. */}
      <div className="cost-stack">
        <div className="cost-row">
          <span className="cost-label">
            Materials subtotal
            <small>includes per-material wastage</small>
          </span>
          <span className="cost-value mono">{moneyPrecise(cost.materialsSubtotal, currency)}</span>
        </div>
        <div className="cost-row">
          <span className="cost-label">
            Contingency
            <small>project-wide commercial margin</small>
          </span>
          <span className="cost-value mono cost-value-add">
            + {moneyPrecise(cost.contingencyAmount, currency)}
          </span>
        </div>
        <div className="cost-row cost-row-total">
          <span className="cost-label">
            Buffered total
            <small>{percent(cost.contingencyBuffer)} contingency applied</small>
          </span>
          <span className="cost-total mono">{money(cost.total, currency)}</span>
        </div>
      </div>

      <label className="slider-row">
        <span>
          Contingency buffer <b className="mono">{percent(project.contingencyBuffer)}</b>
        </span>
        <input
          type="range"
          min={0}
          max={0.25}
          step={0.01}
          value={project.contingencyBuffer}
          onChange={(event) => setContingency(Number(event.target.value))}
        />
      </label>

      <p className="caveat">
        <strong>Material supply only — excludes labour.</strong> {catalog.meta.priceBasis}
      </p>

      <div className="cost-surfaces">
        {perSurface.map(([surface, value]) => (
          <div key={surface} className="cost-bar-row">
            <span className="cost-bar-label">{SURFACE_LABEL[surface] ?? surface}</span>
            <span className="cost-bar-track">
              <span className="cost-bar-fill" style={{ width: `${(value / maxSurface) * 100}%` }} />
            </span>
            <span className="cost-bar-value mono">{money(value, currency)}</span>
          </div>
        ))}
      </div>

      <button className="disclosure" onClick={() => setExpanded((e) => !e)}>
        {expanded ? '▾' : '▸'} {cost.lineItems.length} line items
      </button>

      {expanded && (
        <div className="line-items">
          <div className="line-head">
            <span>Item</span>
            <span>Measured</span>
            <span>Waste</span>
            <span>Ordered</span>
            <span>Cost</span>
          </div>
          {cost.lineItems.map((item) => (
            <div key={`${item.materialId}-${item.location}`} className="line-item">
              <span className="line-name">
                {item.materialName}
                <small>{item.location}</small>
              </span>
              <span className="mono dim">{quantity(item.rawQuantity, item.unit)}</span>
              <span className="mono waste">+{percent(item.wastageFactor)}</span>
              <span className="mono">{quantity(item.bufferedQuantity, item.unit)}</span>
              <span className="mono strong">{moneyPrecise(item.subtotal, currency)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="quantities">
        <Quantity label="Floor" value={cost.quantities.floorAreaSqm} />
        <Quantity label="Walls" value={cost.quantities.wallAreaSqm} />
        <Quantity label="Ceiling" value={cost.quantities.ceilingAreaSqm} />
        <Quantity label="Facade" value={cost.quantities.exteriorWallAreaSqm} />
        <Quantity label="Roof" value={cost.quantities.roofAreaSqm} />
        <Quantity label="Openings" value={cost.quantities.openingAreaSqm} />
      </div>
    </div>
  );
}

function Quantity({ label, value }: { label: string; value: number }) {
  return (
    <div className="quantity">
      <span className="quantity-value mono">{value.toFixed(1)}</span>
      <span className="quantity-label">{label} m²</span>
    </div>
  );
}
