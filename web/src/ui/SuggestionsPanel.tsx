import { useCallback, useEffect, useState } from 'react';
import type { Surface, SuggestionMode, SuggestionResponse } from '@shared/types';
import { ApiOffline, getHealth, postSuggestions } from '../lib/api';
import { useStore } from '../store';
import { money, moneyPrecise, unitLabel } from '../lib/format';

/**
 * `estimatedSavingsPct` is not pinned to a unit by the contract and the engine
 * reports whole percent (59.73 = 60%), while a fraction (0.6) is the other
 * plausible reading. Anything above 1.5 can only be whole percent — a 150%
 * saving is impossible — so read it that way and treat the rest as a fraction.
 */
function savingsPct(value: number): string {
  const whole = Math.abs(value) > 1.5 ? Math.abs(value) : Math.abs(value) * 100;
  return `${whole.toFixed(0)}%`;
}

const MODES: Array<{ id: SuggestionMode; label: string; blurb: string }> = [
  { id: 'AESTHETIC', label: 'Aesthetic', blurb: 'Best-looking, style-coherent finishes' },
  { id: 'COST_EFFICIENCY', label: 'Value', blurb: 'Closest look for the least money' },
  { id: 'BALANCED', label: 'Balanced', blurb: 'Looks and value weighted together' },
];

/** What the project currently specifies, per surface, as the engine's baseline. */
function currentSelection(): Partial<Record<Surface, string>> {
  const { project } = useStore.getState();
  const floor = project.floors[0];
  const current: Partial<Record<Surface, string>> = {};
  if (!floor) return current;
  const firstRoom = floor.rooms[0];
  if (firstRoom?.floorMaterialId) current.FLOOR = firstRoom.floorMaterialId;
  if (firstRoom?.ceilingMaterialId) current.CEILING = firstRoom.ceilingMaterialId;
  const interior = floor.walls.find((w) => w.interiorMaterialId);
  if (interior?.interiorMaterialId) current.WALL = interior.interiorMaterialId;
  const exterior = floor.walls.find((w) => w.exteriorMaterialId);
  if (exterior?.exteriorMaterialId) current.EXTERIOR_WALL = exterior.exteriorMaterialId;
  if (project.roof?.materialId) current.ROOF = project.roof.materialId;
  return current;
}

export function SuggestionsPanel() {
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const applyMaterial = useStore((s) => s.applyMaterial);
  const select = useStore((s) => s.select);
  const setSurfaceTarget = useStore((s) => s.setSurfaceTarget);

  const [mode, setMode] = useState<SuggestionMode>('BALANCED');
  const [styleId, setStyleId] = useState<string>('');
  const [data, setData] = useState<SuggestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    getHealth()
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await postSuggestions({
        mode,
        ...(styleId ? { styleId } : {}),
        current: currentSelection(),
        project,
      });
      setData(response);
      setOnline(true);
    } catch (caught) {
      setData(null);
      setOnline(false);
      setError(caught instanceof ApiOffline ? caught.message : 'unexpected error');
    } finally {
      setLoading(false);
    }
  }, [mode, styleId, project]);

  return (
    <div className="panel suggest-panel">
      <header className="panel-header">
        <h2>Suggestions</h2>
        <span className={`badge ${online === false ? 'badge-warn' : online ? 'badge-ok' : 'badge-quiet'}`}>
          {online === null ? 'checking' : online ? 'backend online' : 'backend offline'}
        </span>
      </header>

      <div className="mode-row">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode ${mode === m.id ? 'mode-on' : ''}`}
            onClick={() => setMode(m.id)}
            title={m.blurb}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="palette-filters">
        <select
          className="input select"
          value={styleId}
          onChange={(event) => setStyleId(event.target.value)}
        >
          <option value="">Infer style from selection</option>
          {catalog.styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? 'Thinking…' : 'Suggest'}
        </button>
      </div>

      {online === false && (
        <div className="offline-note">
          <strong>Backend offline.</strong> Suggestions need <code>POST /api/suggestions</code> on
          <code> localhost:4000</code>. Everything else — the plan, the 3D view, materials and the
          cost estimate — keeps working from the bundled catalog.
          {error && <span className="offline-detail">{error}</span>}
        </div>
      )}

      {data && (
        <>
          <p className="suggest-note">{data.note}</p>
          {data.currentTotal !== undefined && data.projectedTotal !== undefined && (
            <div className="suggest-totals">
              <span>
                Now <b className="mono">{money(data.currentTotal, project.currency)}</b>
              </span>
              <span className="arrow">→</span>
              <span>
                Projected <b className="mono">{money(data.projectedTotal, project.currency)}</b>
              </span>
            </div>
          )}
          <div className="suggest-list">
            {data.items.map((item) => (
              <div key={`${item.surface}-${item.materialId}`} className="suggest-item">
                <div className="suggest-head">
                  <span className="suggest-surface">{item.surface.replace('_', ' ')}</span>
                  <span className="suggest-name">{item.materialName}</span>
                  <span className="mono suggest-price">
                    {moneyPrecise(item.unitPrice, project.currency)}
                    <small>/{unitLabel(item.unit)}</small>
                  </span>
                </div>
                <p className="suggest-reason">{item.reason}</p>
                <div className="suggest-foot">
                  {item.estimatedSavings !== undefined && (
                    <span className={item.estimatedSavings >= 0 ? 'savings' : 'savings negative'}>
                      {item.estimatedSavings >= 0 ? 'Saves' : 'Adds'}{' '}
                      {money(Math.abs(item.estimatedSavings), project.currency)}
                      {item.estimatedSavingsPct !== undefined &&
                        ` (${savingsPct(item.estimatedSavingsPct)})`}
                    </span>
                  )}
                  {item.replacesName && <span className="replaces">replaces {item.replacesName}</span>}
                  <span className="score mono">score {item.score.toFixed(2)}</span>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      const floor = project.floors[0];
                      if (item.surface === 'FLOOR' || item.surface === 'CEILING') {
                        select('room', floor?.rooms[0]?.id ?? null);
                      } else if (item.surface === 'ROOF') {
                        select('roof', 'roof');
                      } else {
                        const wall = floor?.walls.find((w) =>
                          item.surface === 'EXTERIOR_WALL' ? w.exterior : !w.exterior,
                        );
                        select('wall', wall?.id ?? null);
                      }
                      setSurfaceTarget(item.surface);
                      applyMaterial(item.materialId);
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!data && online !== false && (
        <p className="hint">
          Pick a mode and hit Suggest. Each result carries its reasoning and the money it moves.
        </p>
      )}
    </div>
  );
}
