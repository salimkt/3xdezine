import { useMemo, useState } from 'react';
import { estimateCost } from '@shared/cost';
import type { CostBreakdown } from '@shared/types';
import { useStore } from '../store';
import { money, moneyPrecise, percent, quantity } from '../lib/format';
import { IconChevron } from './icons';

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

/**
 * Interior surfaces share the cool accent family, the building envelope the
 * warm one, fittings stay neutral. Colour therefore carries a second meaning —
 * inside versus outside — instead of being six arbitrary hues.
 */
const SURFACE_COLOR: Record<string, string> = {
  FLOOR: 'var(--c-floor)',
  WALL: 'var(--c-wall)',
  CEILING: 'var(--c-ceiling)',
  EXTERIOR_WALL: 'var(--c-facade)',
  ROOF: 'var(--c-roof)',
  COMPONENT: 'var(--c-component)',
};

export function CostPanel() {
  const cost = useCost();
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const setContingency = useStore((s) => s.setContingency);
  const [expanded, setExpanded] = useState(false);
  const [hot, setHot] = useState<string | null>(null);

  const currency = cost.currency;
  const perSurface = Object.entries(cost.perSurface)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const surfaceTotal = perSurface.reduce((sum, [, value]) => sum + value, 0) || 1;

  const floorArea = cost.quantities.floorAreaSqm;
  const perSqm = floorArea > 0 ? cost.total / floorArea : 0;

  return (
    <div className="panel cost-panel">
      <header className="panel-header">
        <h2>Estimate</h2>
        <span className="badge badge-ok" title="Recalculated locally on every edit">
          <i className="dot dot-live" />
          live
        </span>
      </header>

      {/* The headline number, then the arithmetic that produced it. The three
          figures must never be conflated, so each one is separately labelled. */}
      <div className="cost-hero">
        <div className="cost-hero-label">
          <span>Buffered total</span>
          <span>{percent(cost.contingencyBuffer)} buffer</span>
        </div>
        <div className="cost-hero-value">{money(cost.total, currency)}</div>
        {perSqm > 0 && (
          <div className="cost-hero-sub">
            <b className="mono">{money(perSqm, currency)}</b> per m² of floor ·{' '}
            <b className="mono">{floorArea.toFixed(1)} m²</b> measured
          </div>
        )}
      </div>

      <div className="cost-ladder">
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
        <div className="cost-row cost-row-sum">
          <span className="cost-label">Buffered total</span>
          <span className="cost-value mono cost-value-sum">{moneyPrecise(cost.total, currency)}</span>
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

      {/* Where the money actually concentrates. One bar plus a legend beats six
          bars — the comparison the user wants is share of total, not magnitude. */}
      {perSurface.length > 0 && (
        <div className="cost-chart">
          <div className="panel-header">
            <h2>Where it goes</h2>
            <span className="eyebrow">materials subtotal</span>
          </div>
          <div className="stacked-bar" onMouseLeave={() => setHot(null)}>
            {perSurface.map(([surface, value]) => (
              <span
                key={surface}
                className={`stacked-seg ${hot === surface ? 'stacked-seg-hot' : ''}`}
                style={{
                  width: `${(value / surfaceTotal) * 100}%`,
                  background: SURFACE_COLOR[surface] ?? 'var(--c-component)',
                }}
                onMouseEnter={() => setHot(surface)}
                title={`${SURFACE_LABEL[surface] ?? surface} — ${money(value, currency)}`}
              />
            ))}
          </div>
          <div className="cost-legend">
            {perSurface.map(([surface, value]) => (
              <div
                key={surface}
                className="legend-row"
                onMouseEnter={() => setHot(surface)}
                onMouseLeave={() => setHot(null)}
              >
                <span
                  className="legend-key"
                  style={{ background: SURFACE_COLOR[surface] ?? 'var(--c-component)' }}
                />
                <span className="legend-name">{SURFACE_LABEL[surface] ?? surface}</span>
                <span className="legend-pct">{percent(value / surfaceTotal)}</span>
                <span className="legend-value">{money(value, currency)}</span>
              </div>
            ))}
          </div>
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

      <button
        className={`disclosure ${expanded ? 'disclosure-open' : ''}`}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <IconChevron size={11} className="disclosure-caret" />
        {expanded ? 'Hide' : 'Show'} bill of materials
        <span className="badge badge-quiet" style={{ marginLeft: 'auto' }}>
          {cost.lineItems.length} lines
        </span>
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
                <span>{item.materialName}</span>
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

      {/* The basis is the single most important disclaimer here and also the
          longest paragraph in the app, so it is stated in one line and the
          sourcing sits one click away. */}
      <div className="caveat">
        <strong>Material supply only — excludes labour, installation and site overheads.</strong>
        <details className="caveat-details">
          <summary>Price basis &amp; sources</summary>
          <p>{catalog.meta.priceBasis}</p>
        </details>
      </div>
    </div>
  );
}

function Quantity({ label, value }: { label: string; value: number }) {
  return (
    <div className="quantity">
      <span className="quantity-value mono">
        {value.toFixed(1)}
        <em>m²</em>
      </span>
      <span className="quantity-label">{label}</span>
    </div>
  );
}
