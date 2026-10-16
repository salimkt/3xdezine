import { useMemo, useState } from 'react';
import type {
  BoardMaterial,
  CabinetRun,
  HardwareTier,
  ModularItem,
  ModuleKind,
  ShutterFinish,
  Zone,
  ZoneSpec,
} from '@shared/business';
import { STANDARD_WIDTHS_MM, ZONES, defaultModularItem, fillRun, modularQuoteLine, priceModular, specFor } from '@shared/modular';
import { useStore } from '../../store';
import { useCloud } from '../../cloud/state';
import { formatINR } from '../engines';
import { openPricing, useBiz } from '../state';
import { normaliseStudio } from '../defaults';
import { patchDraft, setDraft, useProjectKey, useWorkspace, type QuoteDraft } from '../workspace';
import { activeCard, newDraft, projectEntitlements } from '../quote/model';
import { NumberInput, RupeeInput } from '../quote/LineTable';
import { UpgradeNote } from '../ui';
import '../business.css';

const CARCASS: Array<[BoardMaterial, string]> = [
  ['BWP_PLY', 'BWP ply (IS 710)'],
  ['BWR_MR_PLY', 'MR ply (IS 303)'],
  ['HDHMR', 'HDHMR'],
  ['MDF', 'MDF'],
  ['PARTICLE_BOARD', 'Particle board'],
];
const FINISH: Array<[ShutterFinish, string]> = [
  ['LAMINATE_MATTE', 'Laminate, matte'],
  ['LAMINATE_GLOSS', 'Laminate, gloss'],
  ['MEMBRANE', 'Membrane'],
  ['ACRYLIC', 'Acrylic'],
  ['PU_MATTE', 'PU, matte'],
  ['PU_GLOSS', 'PU, gloss'],
  ['VENEER', 'Veneer'],
  ['GLASS_PROFILE', 'Glass profile'],
];
const HANDLE: Array<[ZoneSpec['handle'], string]> = [
  ['G_PROFILE', 'G-profile'],
  ['J_PROFILE', 'J-profile'],
  ['GOLA', 'Gola'],
  ['KNOB', 'Knob'],
  ['BAR', 'Bar handle'],
  ['PUSH_OPEN', 'Push to open'],
];
const TIERS: Array<[HardwareTier, string]> = [
  ['VALUE', 'Value · Ebco'],
  ['MID', 'Mid · Hettich std'],
  ['PREMIUM', 'Premium · Blum/Häfele'],
];
const KINDS: Record<Zone, ModuleKind[]> = {
  BASE: ['BASE', 'BASE_SINK', 'BASE_HOB', 'BASE_DRAWERS', 'BASE_CORNER', 'FILLER'],
  WALL: ['WALL', 'WALL_CORNER', 'WALL_LIFT_UP', 'FILLER'],
  TALL: ['TALL', 'TALL_APPLIANCE', 'WARDROBE_HINGED', 'WARDROBE_SLIDING', 'FILLER'],
  LOFT: ['LOFT', 'FILLER'],
};
const KIND_LABEL: Partial<Record<ModuleKind, string>> = {
  BASE: 'base', BASE_SINK: 'sink', BASE_HOB: 'hob', BASE_DRAWERS: 'drawers', BASE_CORNER: 'corner',
  WALL: 'wall', WALL_CORNER: 'corner', WALL_LIFT_UP: 'lift-up', TALL: 'tall', TALL_APPLIANCE: 'appliance',
  WARDROBE_HINGED: 'hinged', WARDROBE_SLIDING: 'sliding', LOFT: 'loft', FILLER: 'filler',
};
const APPLIANCES: Array<{ kind: ModularItem['appliances'][number]['kind']; name: string; rate: number; hsn: string }> = [
  { kind: 'CHIMNEY', name: 'Chimney, 90 cm auto-clean', rate: 18_000_00, hsn: '8414' },
  { kind: 'HOB', name: 'Built-in hob, 3 burner', rate: 14_000_00, hsn: '7321' },
  { kind: 'SINK', name: 'SS sink with drainboard', rate: 8_500_00, hsn: '7324' },
  { kind: 'OVEN', name: 'Built-in oven', rate: 38_000_00, hsn: '8516' },
  { kind: 'MICROWAVE', name: 'Built-in microwave', rate: 18_000_00, hsn: '8516' },
  { kind: 'DISHWASHER', name: 'Dishwasher', rate: 42_000_00, hsn: '8422' },
  { kind: 'RO', name: 'RO water purifier', rate: 15_000_00, hsn: '8421' },
];
const LAYOUT_WALLS: Record<NonNullable<ModularItem['layout']>, number> = { STRAIGHT: 1, L: 2, PARALLEL: 2, U: 3 };

/**
 * The modular configurator, in the studio rail: pick walls for a new run,
 * then spec zones, hardware, dims, countertop and appliances, adjust modules,
 * and add the priced item to the quote. Gated to Solo (or a Project Pass on
 * this project); Free sees the preview and an upgrade prompt.
 */
export default function ModularPanel() {
  const pick = useWorkspace((s) => s.pick);
  const editingId = useWorkspace((s) => s.editingModularId);
  if (pick) return <PickPanel />;
  if (editingId) return <EditPanel id={editingId} />;
  return null;
}

function useEnsureDraft() {
  const key = useProjectKey();
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const activeId = useCloud((s) => s.active?.id);
  const rawEnts = useBiz((s) => s.entitlements);
  const studio = useBiz((s) => s.studio);
  const ents = projectEntitlements(rawEnts, activeId);
  return {
    key,
    ents,
    ensure: (): QuoteDraft => {
      const cur = useWorkspace.getState().drafts[key];
      if (cur) return cur;
      const st = normaliseStudio(studio);
      const d = newDraft(project, activeCard(ents).card, catalog, st, 'QUOTATION');
      setDraft(key, d);
      return d;
    },
  };
}

function PickPanel() {
  const pick = useWorkspace((s) => s.pick)!;
  const project = useStore((s) => s.project);
  const floor = project.floors.find((f) => f.rooms.some((r) => r.id === pick.roomId));
  const room = floor?.rooms.find((r) => r.id === pick.roomId);
  const { key, ensure } = useEnsureDraft();
  const [error, setError] = useState<string | null>(null);
  const kitchen = pick.type === 'KITCHEN';
  const need = kitchen ? LAYOUT_WALLS[pick.layout] : 1;
  const walls = pick.wallIds.map((id) => floor?.walls.find((w) => w.id === id)).filter((w): w is NonNullable<typeof w> => Boolean(w));

  const create = () => {
    if (!room || !floor) return;
    setError(null);
    try {
      const draft = ensure();
      const n = draft.modular.filter((m) => m.roomId === room.id && m.type === pick.type).length;
      const item = defaultModularItem(room, kitchen ? walls : walls.slice(0, 1), pick.type, {
        floor,
        layout: kitchen ? pick.layout : undefined,
        id: `${pick.type.toLowerCase()}-${room.id}${n ? `-${n + 1}` : ''}`,
      });
      patchDraft(key, { modular: [...draft.modular, item] });
      useWorkspace.setState({ pick: null, editingModularId: item.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="panel biz-mod">
      <header className="panel-header panel-title">
        <h2>{kitchen ? 'Add kitchen' : 'Add wardrobe'}</h2>
        <span className="badge badge-quiet">{room?.name ?? 'room'}</span>
      </header>
      <div className="biz-mod-pick">
        {kitchen && (
          <div className="segmented segmented-fill" role="radiogroup" aria-label="Layout">
            {(['STRAIGHT', 'L', 'U', 'PARALLEL'] as const).map((l) => (
              <button key={l} role="radio" aria-checked={pick.layout === l} className={`seg ${pick.layout === l ? 'seg-on' : ''}`} onClick={() => useWorkspace.setState({ pick: { ...pick, layout: l } })}>
                {l === 'STRAIGHT' ? 'Straight' : l === 'PARALLEL' ? 'Parallel' : `${l}-shape`}
              </button>
            ))}
          </div>
        )}
        <p className="hint">
          Click {need === 1 ? 'the wall' : `${need} walls`} of {room?.name ?? 'the room'} in the plan
          {need > 1 ? ' — in order; the first one owns the corner' : ''}. Highlighted walls are the room’s.
        </p>
        <div className="biz-mod-walls">
          {walls.map((w, i) => (
            <span key={w.id} className="chip chip-on">
              {i + 1}. {Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z).toFixed(2)} m wall
            </span>
          ))}
          {!walls.length && <span className="hint">No walls picked yet.</span>}
        </div>
        {error && <p className="cloud-error">{error}</p>}
        <div className="cloud-actions">
          <button className="btn" onClick={() => useWorkspace.setState({ pick: null })}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={walls.length < need} onClick={create}>
            Create {kitchen ? 'kitchen' : 'wardrobe'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditPanel({ id }: { id: string }) {
  const project = useStore((s) => s.project);
  const { key, ents } = useEnsureDraft();
  const draft = useWorkspace((s) => s.drafts[key]);
  const item = draft?.modular.find((m) => m.id === id);
  const [showModules, setShowModules] = useState(false);

  const breakdown = useMemo(() => {
    if (!item) return null;
    try {
      return priceModular(item, undefined, project);
    } catch {
      return null;
    }
  }, [item, project]);

  if (!draft || !item) return null;
  const room = project.floors.flatMap((f) => f.rooms).find((r) => r.id === item.roomId);
  const locked = !ents.modular;
  const inQuote = draft.lines.some((l) => l.kind === 'MODULAR' && l.item.id === item.id);

  const update = (next: ModularItem) => patchDraft(key, { modular: draft.modular.map((m) => (m.id === id ? next : m)) });
  const setSpec = (zone: Zone, p: Partial<ZoneSpec> & { finish?: ShutterFinish; colorHex?: string }) => {
    const cur = specFor(item, zone);
    const { finish, colorHex, ...rest } = p;
    update({
      ...item,
      zoneSpecs: { ...item.zoneSpecs, [zone]: { ...cur, ...rest, shutter: { ...cur.shutter, ...(finish ? { finish } : {}), ...(colorHex ? { colorHex } : {}) } } },
    });
  };
  const setRun = (runId: string, run: CabinetRun) => update({ ...item, runs: item.runs.map((r) => (r.id === runId ? run : r)) });
  const refill = (run: CabinetRun) => setRun(run.id, fillRun(run, item));
  const zones = ZONES.filter((z) => item.runs.some((r) => r.zones.includes(z)));

  const addToQuote = () => {
    if (locked) return openPricing({ reason: 'The modular kitchen and wardrobe configurator is part of Solo — or a Project Pass for this project.' });
    if (inQuote) return;
    patchDraft(key, { lines: [...draft.lines, modularQuoteLine(item, project)] });
  };
  const remove = () => {
    patchDraft(key, {
      modular: draft.modular.filter((m) => m.id !== id),
      lines: draft.lines.filter((l) => !(l.kind === 'MODULAR' && l.item.id === id)),
    });
    useWorkspace.setState({ editingModularId: null });
  };

  return (
    <div className={`panel biz-mod ${locked ? 'biz-mod-locked' : ''}`}>
      <header className="panel-header panel-title">
        <h2>
          {item.type === 'KITCHEN' ? `Kitchen${item.layout ? ` · ${item.layout.toLowerCase()}` : ''}` : 'Wardrobe'}
        </h2>
        <span className="badge badge-quiet">{room?.name ?? 'room removed'}</span>
      </header>
      {locked && (
        <UpgradeNote onUpgrade={() => openPricing({ reason: 'The modular configurator — priced kitchens and wardrobes on your plan, in 3D and in the quote — is part of Solo.' })}>
          Preview only. Configuring modular units and adding them to quotes is part of Solo (or a Project Pass).
        </UpgradeNote>
      )}

      <div className="biz-mod-body">
        <div className="field">
          <span className="field-label">Hardware</span>
          <select className="input select" value={item.hardwareTier} onChange={(e) => update({ ...item, hardwareTier: e.target.value as HardwareTier })}>
            {TIERS.map(([t, l]) => (
              <option key={t} value={t}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {zones.map((zone) => {
          const spec = specFor(item, zone);
          return (
            <div key={zone} className="biz-mod-zone">
              <b>{zone}</b>
              <select className="input select" aria-label={`${zone} carcass`} value={spec.carcass} onChange={(e) => setSpec(zone, { carcass: e.target.value as BoardMaterial })}>
                {CARCASS.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </select>
              <select className="input select" aria-label={`${zone} handle`} value={spec.handle} onChange={(e) => setSpec(zone, { handle: e.target.value as ZoneSpec['handle'] })}>
                {HANDLE.map(([h, l]) => (
                  <option key={h} value={h}>
                    {l}
                  </option>
                ))}
              </select>
              <div className="biz-mod-zone-extra">
                <select className="input select" aria-label={`${zone} shutter finish`} value={spec.shutter.finish} onChange={(e) => setSpec(zone, { finish: e.target.value as ShutterFinish })}>
                  {FINISH.map(([f, l]) => (
                    <option key={f} value={f}>
                      {l}
                    </option>
                  ))}
                </select>
                <input type="color" aria-label={`${zone} shutter colour`} value={spec.shutter.colorHex} onChange={(e) => setSpec(zone, { colorHex: e.target.value.toUpperCase() })} />
              </div>
            </div>
          );
        })}

        <div className="biz-mod-dims">
          {item.type === 'KITCHEN' && (
            <>
              <label>
                Counter height mm
                <NumberInput value={item.dims.counterHeightMm} min={750} max={1000} step={10} label="Counter height" onChange={(v) => update({ ...item, dims: { ...item.dims, counterHeightMm: v } })} />
              </label>
              <label>
                Wall units from mm
                <NumberInput value={item.dims.wallBottomMm} min={1200} max={1800} step={10} label="Wall unit bottom" onChange={(v) => update({ ...item, dims: { ...item.dims, wallBottomMm: v } })} />
              </label>
              <label>
                Wall unit height mm
                <NumberInput value={item.dims.wallHeightMm} min={300} max={900} step={10} label="Wall unit height" onChange={(v) => update({ ...item, dims: { ...item.dims, wallHeightMm: v } })} />
              </label>
              <label>
                Wall unit depth mm
                <NumberInput value={item.dims.wallDepthMm} min={250} max={450} step={10} label="Wall unit depth" onChange={(v) => update({ ...item, dims: { ...item.dims, wallDepthMm: v } })} />
              </label>
            </>
          )}
          <label>
            {item.type === 'KITCHEN' ? 'Base depth mm' : 'Depth mm'}
            <NumberInput value={item.dims.baseDepthMm} min={400} max={700} step={10} label="Depth" onChange={(v) => update({ ...item, dims: { ...item.dims, baseDepthMm: v } })} />
          </label>
          <label>
            {item.type === 'KITCHEN' ? 'Tall unit height mm' : 'Height mm'}
            <NumberInput value={item.dims.tallHeightMm} min={1800} max={2700} step={10} label="Tall height" onChange={(v) => update({ ...item, dims: { ...item.dims, tallHeightMm: v } })} />
          </label>
          <label>
            Loft height mm
            <NumberInput value={item.dims.loftHeightMm} min={0} max={900} step={10} label="Loft height" onChange={(v) => update({ ...item, dims: { ...item.dims, loftHeightMm: v } })} />
          </label>
          <label>
            Priced by
            <select className="input select" value={item.pricing.convention} onChange={(e) => update({ ...item, pricing: { ...item.pricing, convention: e.target.value as ModularItem['pricing']['convention'] } })}>
              <option value="RFT">Running ft</option>
              <option value="SQFT_FRONT">Sq ft of front</option>
            </select>
          </label>
        </div>
        <label className="policy-toggle">
          <input type="checkbox" checked={item.pricing.installationIncluded} onChange={(e) => update({ ...item, pricing: { ...item.pricing, installationIncluded: e.target.checked } })} />
          <span>
            <b>Installation included</b>
          </span>
        </label>

        {item.type === 'KITCHEN' && (
          <div className="biz-mod-dims">
            <label>
              Countertop
              <select
                className="input select"
                value={item.countertop?.material ?? 'NONE'}
                onChange={(e) =>
                  update({
                    ...item,
                    countertop:
                      e.target.value === 'NONE'
                        ? undefined
                        : { material: e.target.value as NonNullable<ModularItem['countertop']>['material'], ratePerSqft: item.countertop?.ratePerSqft ?? 350_00 },
                  })
                }
              >
                <option value="NONE">None</option>
                <option value="GRANITE">Granite</option>
                <option value="QUARTZ">Quartz</option>
                <option value="SOLID_SURFACE">Solid surface</option>
                <option value="SS">Stainless steel</option>
              </select>
            </label>
            {item.countertop && (
              <label>
                ₹ per sq ft
                <RupeeInput value={item.countertop.ratePerSqft} label="Countertop rate per sq ft" onChange={(ratePerSqft) => update({ ...item, countertop: { ...item.countertop!, ratePerSqft } })} />
              </label>
            )}
          </div>
        )}

        {item.type === 'KITCHEN' && (
          <div className="field">
            <span className="field-label">Appliances</span>
            {item.appliances.map((a, i) => (
              <div key={i} className="biz-mod-appl">
                <input className="input" value={a.name} aria-label="Appliance" onChange={(e) => update({ ...item, appliances: item.appliances.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <RupeeInput value={a.rate} label={`${a.name} rate`} disabled={a.clientSupplied} onChange={(rate) => update({ ...item, appliances: item.appliances.map((x, j) => (j === i ? { ...x, rate } : x)) })} />
                <button
                  className={`chip ${a.clientSupplied ? 'chip-on' : ''}`}
                  title="Client buys this appliance — fitted, not priced"
                  aria-pressed={a.clientSupplied}
                  onClick={() => update({ ...item, appliances: item.appliances.map((x, j) => (j === i ? { ...x, clientSupplied: !x.clientSupplied } : x)) })}
                >
                  Client
                </button>
                <button className="btn btn-ghost btn-icon" aria-label="Remove appliance" onClick={() => update({ ...item, appliances: item.appliances.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <select
              className="input select"
              value=""
              aria-label="Add appliance"
              onChange={(e) => {
                const a = APPLIANCES.find((x) => x.kind === e.target.value);
                if (a) update({ ...item, appliances: [...item.appliances, { kind: a.kind, name: a.name, qty: 1, rate: a.rate, hsn: a.hsn, clientSupplied: false }] });
              }}
            >
              <option value="">+ Add appliance…</option>
              {APPLIANCES.map((a) => (
                <option key={a.kind} value={a.kind}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button className="disclosure" aria-expanded={showModules} onClick={() => setShowModules(!showModules)}>
          <span className={`disclosure-caret ${showModules ? 'disclosure-open' : ''}`}>▸</span> Runs and modules
        </button>
        {showModules &&
          item.runs.map((run, ri) => (
            <div key={run.id} className="biz-mod-run">
              <div className="biz-mod-run-head">
                <span>
                  Run {ri + 1} · {run.zones.join(' + ').toLowerCase()}
                </span>
                <button className="btn btn-small btn-ghost" onClick={() => refill(run)} title="Refill each zone to the run length with standard widths and a filler">
                  Refill
                </button>
              </div>
              <label className="biz-mod-dims">
                <span>
                  Length mm
                  <NumberInput value={run.lengthMm} min={300} max={12000} step={10} label="Run length" onChange={(lengthMm) => setRun(run.id, fillRun({ ...run, lengthMm }, item))} />
                </span>
                <span>
                  Start mm
                  <NumberInput value={run.offsetStartMm} min={0} max={12000} step={10} label="Run start offset" onChange={(offsetStartMm) => setRun(run.id, { ...run, offsetStartMm })} />
                </span>
              </label>
              {run.zones.map((zone) => (
                <div key={zone} className="biz-mod-modules" aria-label={`${zone} modules`}>
                  {run.modules
                    .filter((m) => m.zone === zone)
                    .map((m) => (
                      <span key={m.id} className={`biz-mod-module ${m.kind === 'FILLER' ? 'biz-mod-module-filler' : ''}`}>
                        <select
                          aria-label="Module kind"
                          value={m.kind}
                          onChange={(e) => setRun(run.id, { ...run, modules: run.modules.map((x) => (x.id === m.id ? { ...x, kind: e.target.value as ModuleKind } : x)) })}
                        >
                          {KINDS[zone].map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k] ?? k}
                            </option>
                          ))}
                        </select>
                        {m.kind === 'FILLER' ? (
                          <span className="mono">{m.widthMm}</span>
                        ) : (
                          <select
                            aria-label="Module width"
                            value={m.widthMm}
                            onChange={(e) => {
                              const widthMm = Number(e.target.value);
                              const next = { ...run, modules: run.modules.map((x) => (x.id === m.id ? { ...x, widthMm, shutters: widthMm >= 600 ? 2 : 1 } : x)) };
                              setRun(run.id, fillRun(next, item));
                            }}
                          >
                            {[...new Set([...STANDARD_WIDTHS_MM, m.widthMm])].sort((a, b) => a - b).map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          className="biz-move-btn"
                          aria-label="Remove module"
                          onClick={() => setRun(run.id, fillRun({ ...run, modules: run.modules.filter((x) => x.id !== m.id) }, item))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              ))}
            </div>
          ))}
      </div>

      {breakdown && (
        <table className="biz-mod-breakdown">
          <thead>
            <tr>
              <th>Zone</th>
              <th>rft</th>
              <th>sq ft front</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.byZone.map((z) => (
              <tr key={z.zone}>
                <td>{z.zone.toLowerCase()}</td>
                <td className="mono">{z.rft.toFixed(2)}</td>
                <td className="mono">{z.frontSqft.toFixed(2)}</td>
                <td className="mono">
                  {formatINR(z.rate, { paise: false })}/{item.pricing.convention === 'RFT' ? 'rft' : 'sq ft'}
                </td>
                <td className="mono">{formatINR(z.amount, { paise: false })}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}>
                Hardware: {breakdown.hardware.hinges} hinges · {breakdown.hardware.channels} channels
                {breakdown.hardware.liftUps ? ` · ${breakdown.hardware.liftUps} lift-ups` : ''}
              </td>
              <td className="mono">{formatINR(breakdown.hardware.amount, { paise: false })}</td>
            </tr>
            {breakdown.countertop.sqft > 0 && (
              <tr>
                <td colSpan={4}>Countertop {breakdown.countertop.sqft.toFixed(2)} sq ft</td>
                <td className="mono">{formatINR(breakdown.countertop.amount, { paise: false })}</td>
              </tr>
            )}
            {breakdown.accessories > 0 && (
              <tr>
                <td colSpan={4}>Accessories</td>
                <td className="mono">{formatINR(breakdown.accessories, { paise: false })}</td>
              </tr>
            )}
            {breakdown.appliances > 0 && (
              <tr>
                <td colSpan={4}>Appliances</td>
                <td className="mono">{formatINR(breakdown.appliances, { paise: false })}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total, ex-GST</td>
              <td className="mono">{formatINR(breakdown.total, { paise: false })}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {breakdown && breakdown.warnings.length > 0 && (
        <ul className="biz-warnings">
          {breakdown.warnings.slice(0, 5).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <p className="hint">Rates are LOW-confidence planning figures (carcass × finish × hardware tier). Override them per zone on the quote if you quote differently.</p>

      <div className="cloud-actions">
        <button className="btn btn-ghost" onClick={remove}>
          Delete
        </button>
        <span className="topbar-spacer" />
        <button className="btn" onClick={() => useWorkspace.setState({ editingModularId: null })}>
          Done
        </button>
        {inQuote ? (
          <button className="btn" onClick={() => (useWorkspace.setState({ editingModularId: null }), useBiz.setState({ quoteOpen: true }))}>
            In quote · open
          </button>
        ) : (
          <button className="btn btn-primary" onClick={addToQuote}>
            {locked ? 'Upgrade to add' : 'Add to quote'}
          </button>
        )}
      </div>
    </div>
  );
}
