import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { EMPTY_MANIFEST, loadTextureManifest, type HdriEntry } from '../lib/materials';
import { useCost } from './CostPanel';
import { money } from '../lib/format';
import { AndroidMenu } from './AndroidApp';
import { IconChevron } from './icons';

export function TopBar() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cameraMode = useStore((s) => s.cameraMode);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const backend = useStore((s) => s.backend);
  const render = useStore((s) => s.render);
  const patchRender = useStore((s) => s.patchRender);
  const resetProject = useStore((s) => s.resetProject);
  const catalogSource = useStore((s) => s.catalogSource);
  const cost = useCost();

  const [hdris, setHdris] = useState<HdriEntry[]>(EMPTY_MANIFEST.hdris);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTextureManifest().then((m) => setHdris(m.hdris));
  }, []);

  // A render menu that stays open behind a click in the viewport reads as a
  // stuck panel, so it closes on any outside press and on Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!settingsWrap.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">3×</span>
        <span className="brand-text">
          Dezine
          <small>{project.name}</small>
        </span>
      </div>

      <div className="segmented">
        {(['2d', '3d', 'split'] as const).map((mode) => (
          <button
            key={mode}
            className={`seg ${view === mode ? 'seg-on' : ''}`}
            onClick={() => setView(mode)}
            title={
              mode === '2d'
                ? 'Floor plan only'
                : mode === '3d'
                  ? 'Render only'
                  : 'Plan and render side by side'
            }
          >
            {mode === '2d' ? 'Plan' : mode === '3d' ? '3D' : 'Split'}
          </button>
        ))}
      </div>

      <div className="segmented">
        {(['orbit', 'walk'] as const).map((mode) => (
          <button
            key={mode}
            className={`seg ${cameraMode === mode ? 'seg-on' : ''}`}
            onClick={() => setCameraMode(mode)}
            title={mode === 'walk' ? 'Drag to look, WASD to walk, Shift to run' : 'Orbit the model'}
          >
            {mode === 'orbit' ? 'Orbit' : 'Walk'}
          </button>
        ))}
      </div>

      <div className="topbar-spacer" />

      <div className="headline-cost">
        <span className="headline-label">Buffered total</span>
        <span className="headline-value mono">{money(cost.total, cost.currency)}</span>
      </div>

      <span
        className={`badge ${backend === 'webgpu' ? 'badge-ok' : backend === 'webgl' ? 'badge-warn' : 'badge-quiet'}`}
        title={
          backend === 'webgpu'
            ? 'WebGPURenderer on the WebGPU backend'
            : backend === 'webgl'
              ? 'WebGPURenderer running on its WebGL2 fallback backend'
              : 'Renderer initialising'
        }
      >
        <i className="dot" />
        {backend === 'pending' ? 'renderer' : backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}
      </span>

      <span
        className="badge badge-quiet"
        title={
          catalogSource === 'api'
            ? 'Catalogue served by the backend'
            : 'Catalogue read from the bundled seed — identical to the one the backend serves'
        }
      >
        {catalogSource === 'api' ? 'catalog · live' : 'catalog · bundled'}
      </span>

      <span className="topbar-divider" />

      <AndroidMenu />

      <div ref={settingsWrap} style={{ display: 'contents' }}>
        <button
          className={`btn btn-ghost ${settingsOpen ? 'btn-ghost-on' : ''}`}
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
        >
          Render
          <IconChevron size={12} className={`caret ${settingsOpen ? 'caret-open' : ''}`} />
        </button>

        {settingsOpen && (
          <div className="popover render-menu" role="dialog" aria-label="Render settings">
            <span className="popover-title">Render</span>

            <Field label="Environment">
              <select
                className="input select"
                value={render.hdri}
                onChange={(event) => patchRender({ hdri: event.target.value })}
              >
                {hdris.map((hdri) => (
                  <option key={hdri.id} value={hdri.url}>
                    {hdri.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Tone mapping">
              <div className="segmented segmented-fill">
                <button
                  className={`seg ${render.toneMapping === 'AGX' ? 'seg-on' : ''}`}
                  onClick={() => patchRender({ toneMapping: 'AGX' })}
                  title="Rolls off blown-out window highlights — the interior failure case"
                >
                  AgX
                </button>
                <button
                  className={`seg ${render.toneMapping === 'NEUTRAL' ? 'seg-on' : ''}`}
                  onClick={() => patchRender({ toneMapping: 'NEUTRAL' })}
                  title="Material-accurate: shows the marble you actually picked"
                >
                  Neutral
                </button>
              </div>
            </Field>

            <Field label="Quality">
              <div className="segmented segmented-fill">
                {(['performance', 'balanced', 'high'] as const).map((q) => (
                  <button
                    key={q}
                    className={`seg ${render.quality === q ? 'seg-on' : ''}`}
                    onClick={() => patchRender({ quality: q })}
                    title={
                      q === 'performance'
                        ? 'No post-processing'
                        : q === 'balanced'
                          ? 'GTAO + SSR + TRAA + bloom'
                          : 'Adds SSGI bounce light'
                    }
                  >
                    {q === 'performance' ? 'Fast' : q === 'balanced' ? 'Balanced' : 'High'}
                  </button>
                ))}
              </div>
            </Field>

            <Slider
              label="Exposure"
              value={render.exposure}
              min={0.3}
              max={2.5}
              step={0.05}
              onChange={(exposure) => patchRender({ exposure })}
            />
            <Slider
              label="Environment light"
              value={render.envIntensity}
              min={0}
              max={3}
              step={0.05}
              onChange={(envIntensity) => patchRender({ envIntensity })}
            />
            <Slider
              label="Sun"
              value={render.sunIntensity}
              min={0}
              max={8}
              step={0.1}
              onChange={(sunIntensity) => patchRender({ sunIntensity })}
            />

            <Field label="Overlays">
              <div className="toggle-row">
                <Toggle
                  label="Ceilings"
                  value={render.showCeilings}
                  onChange={(showCeilings) => patchRender({ showCeilings })}
                />
                <Toggle
                  label="Site grid"
                  value={render.showGrid}
                  onChange={(showGrid) => patchRender({ showGrid })}
                />
              </div>
            </Field>
          </div>
        )}
      </div>

      <button className="btn btn-ghost" onClick={resetProject} title="Discard edits and reload the sample project">
        Reset
      </button>
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-row">
      <span>
        {label} <b className="mono">{value.toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button className={`chip ${value ? 'chip-on' : ''}`} onClick={() => onChange(!value)}>
      {label}
    </button>
  );
}
