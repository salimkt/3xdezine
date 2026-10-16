import { Fragment, useEffect, useMemo, useState } from 'react';
import type { QuoteLine, Trade, TradeLineItem, TradeUnit } from '@shared/business';
import type { Project } from '@shared/types';
import { fromDisplayQuantity, roundDisplay, unitBaseOf } from '@shared/trades';
import { formatINR, toSqft, toRft } from '../engines';
import { UNIT_LABEL } from '../doc/QuoteDoc';
import { TRADE_LABEL, type LiveLine } from './model';

/** A rupee amount typed in rupees, stored in integer paise. */
export function RupeeInput({ value, onChange, label, disabled }: { value: number; onChange: (paise: number) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(() => (value / 100).toFixed(2));
  useEffect(() => {
    if (Math.round(Number(text) * 100) !== value) setText((value / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="input mono biz-num-input"
      inputMode="decimal"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, '');
        setText(t);
        const n = Number(t);
        if (Number.isFinite(n)) onChange(Math.round(n * 100));
      }}
      onBlur={() => setText((value / 100).toFixed(2))}
    />
  );
}

export function NumberInput({ value, onChange, label, step = 1, min = 0, max, disabled, className = '' }: {
  value: number; onChange: (v: number) => void; label: string; step?: number; min?: number; max?: number; disabled?: boolean; className?: string;
}) {
  return (
    <input
      className={`input mono biz-num-input ${className}`}
      type="number"
      aria-label={label}
      step={step}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(max !== undefined ? Math.min(max, Math.max(min, n)) : Math.max(min, n));
      }}
    />
  );
}

const UNITS: TradeUnit[] = ['SQFT', 'SQM', 'RFT', 'RMT', 'POINT', 'NOS', 'SET', 'LS'];
const TRADES = Object.keys(TRADE_LABEL) as Trade[];

export interface Group {
  key: string;
  title: string;
  roomId?: string;
  rows: LiveLine[];
  subtotal: number;
}

export function groupLines(live: LiveLine[], view: 'ROOM_WISE' | 'TRADE_WISE', project: Project): Group[] {
  const rooms = project.floors.flatMap((f) => f.rooms);
  const order: string[] = [];
  const groups = new Map<string, Group>();
  const keyOf = (l: QuoteLine) => {
    if (view === 'ROOM_WISE') return l.roomId ? `room:${l.roomId}` : 'room:';
    const trade = l.kind === 'MODULAR' ? (l.item.type === 'KITCHEN' ? 'MODULAR_KITCHEN' : 'WARDROBE') : l.trade;
    return `trade:${trade}`;
  };
  for (const row of live) {
    const key = keyOf(row.line);
    let g = groups.get(key);
    if (!g) {
      const roomId = key.startsWith('room:') ? key.slice(5) || undefined : undefined;
      const title = view === 'ROOM_WISE'
        ? roomId
          ? (rooms.find((r) => r.id === roomId)?.name ?? 'Removed room')
          : 'Whole house'
        : TRADE_LABEL[key.slice(6) as Trade] ?? key.slice(6);
      g = { key, title, roomId, rows: [], subtotal: 0 };
      groups.set(key, g);
      order.push(key);
    }
    g.rows.push(row);
    if (!row.line.optional) g.subtotal += row.line.amount;
  }
  const list = order.map((k) => groups.get(k)!);
  if (view === 'ROOM_WISE') {
    // Plan order for rooms, the whole-house section last.
    const idx = (g: Group) => (g.roomId ? rooms.findIndex((r) => r.id === g.roomId) : 9999);
    list.sort((a, b) => idx(a) - idx(b));
  } else {
    list.sort((a, b) => TRADES.indexOf(a.key.slice(6) as Trade) - TRADES.indexOf(b.key.slice(6) as Trade));
  }
  return list;
}

/** "Floor area of Bedroom 2 = 13.70 m² = 147.47 sq ft" — the trace from plan to quote. */
export function formulaText(row: LiveLine): string {
  const l = row.line;
  if (l.kind !== 'TRADE') return '';
  if (row.error) return row.error;
  const f = row.formula ?? '';
  if (l.rule.kind === 'MANUAL') return 'Typed quantity (manual line)';
  if (l.rule.kind === 'FIXED') return f;
  const unit = UNIT_LABEL[l.unit];
  if (l.unit === 'SQFT') return `${f} = ${toSqft(l.quantityBase).toFixed(2)} ${unit}`;
  if (l.unit === 'RFT') return `${f} = ${toRft(l.quantityBase).toFixed(2)} ${unit}`;
  return `${f} → ${l.quantityDisplay} ${unit}`;
}

const amt = (p: number) => formatINR(p, { symbol: false });

export function LineTable({
  groups,
  lineNos,
  rooms,
  onChange,
  onMove,
  onDelete,
  onEditModular,
}: {
  groups: Group[];
  lineNos: Map<string, string>;
  rooms: Array<{ id: string; name: string }>;
  onChange: (id: string, patch: Partial<TradeLineItem> | Partial<Extract<QuoteLine, { kind: 'MODULAR' }>>) => void;
  onMove: (id: string, dir: -1 | 1, group: Group) => void;
  onDelete: (id: string) => void;
  onEditModular: (itemId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const empty = useMemo(() => groups.every((g) => g.rows.length === 0), [groups]);
  if (empty) return <p className="biz-empty">No lines yet. Add from the rate card or add a manual line.</p>;

  return (
    <table className="biz-lines">
      <thead>
        <tr>
          <th className="biz-c-move" aria-label="Reorder" />
          <th className="biz-c-no">No.</th>
          <th>Description</th>
          <th className="biz-c-qty">Qty</th>
          <th className="biz-c-rate" title="Material rate per unit, ex-GST">Material ₹</th>
          <th className="biz-c-rate" title="Labour rate per unit, ex-GST">Labour ₹</th>
          <th className="biz-c-pct" title="Internal markup — folded into the printed rate, never printed">Markup</th>
          <th className="biz-c-pct">Disc.</th>
          <th className="biz-c-amt">Amount ₹</th>
          <th className="biz-c-flags" aria-label="Options" />
        </tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.key}>
          <tr className="biz-group">
            <td colSpan={8}>{g.title}</td>
            <td className="biz-c-amt mono">{amt(g.subtotal)}</td>
            <td />
          </tr>
          {g.rows.map((row, i) => {
            const l = row.line;
            const isOpen = open === l.id;
            if (l.kind === 'MODULAR') {
              return (
                <tr key={l.id} className={`biz-line biz-line-modular ${l.optional ? 'biz-line-optional' : ''}`}>
                  <td className="biz-c-move">
                    <MoveButtons first={i === 0} last={i === g.rows.length - 1} onMove={(d) => onMove(l.id, d, g)} />
                  </td>
                  <td className="biz-c-no mono">{lineNos.get(l.id) ?? ''}</td>
                  <td>
                    <input className="input biz-desc" value={l.description} aria-label="Description" onChange={(e) => onChange(l.id, { description: e.target.value })} />
                    <span className="biz-line-sub">
                      {l.breakdown.byZone.filter((z) => z.amount > 0).map((z) => `${z.zone.toLowerCase()} ${z.rft.toFixed(1)} rft`).join(' · ')}
                      {row.error && <span className="biz-bad"> · {row.error}</span>}
                    </span>
                  </td>
                  <td className="biz-c-qty mono">1 set</td>
                  <td colSpan={4}>
                    <button className="btn btn-small" onClick={() => onEditModular(l.item.id)}>
                      Configure…
                    </button>
                  </td>
                  <td className="biz-c-amt mono">{l.optional ? <s>{amt(l.amount)}</s> : amt(l.amount)}</td>
                  <td className="biz-c-flags">
                    <Flag on={l.optional} label="Optional" short="Opt" onToggle={() => onChange(l.id, { optional: !l.optional })} />
                    <button className="btn btn-ghost btn-icon" aria-label="Delete line" onClick={() => onDelete(l.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            }
            const manual = l.rule.kind === 'MANUAL' || l.rule.kind === 'FIXED';
            const formula = formulaText(row);
            return (
              <Fragment key={l.id}>
                <tr className={`biz-line ${l.optional ? 'biz-line-optional' : ''} ${row.error ? 'biz-line-error' : ''} ${isOpen ? 'biz-line-open' : ''}`}>
                  <td className="biz-c-move">
                    <MoveButtons first={i === 0} last={i === g.rows.length - 1} onMove={(d) => onMove(l.id, d, g)} />
                  </td>
                  <td className="biz-c-no mono">{lineNos.get(l.id) ?? ''}</td>
                  <td>
                    <input className="input biz-desc" value={l.description} aria-label="Description" onChange={(e) => onChange(l.id, { description: e.target.value })} />
                    <span className="biz-line-sub">
                      {l.spec?.brand || l.spec?.grade || l.spec?.finish ? [l.spec.brand, l.spec.grade, l.spec.finish].filter(Boolean).join(' · ') : <i>no brand / spec</i>}
                      {l.clientSupplied && ' · labour only'}
                    </span>
                  </td>
                  <td className="biz-c-qty">
                    {manual ? (
                      <span className="biz-qty-edit">
                        <NumberInput
                          value={l.quantityDisplay}
                          step={unitBaseOf(l.unit) === 'COUNT' ? 1 : 0.01}
                          label="Quantity"
                          disabled={l.unit === 'LS'}
                          onChange={(v) => {
                            const d = roundDisplay(v, l.unit);
                            onChange(l.id, { rule: { kind: 'MANUAL' }, quantityDisplay: d, quantityBase: fromDisplayQuantity(d, l.unit) });
                          }}
                        />
                        <small>{UNIT_LABEL[l.unit]}</small>
                      </span>
                    ) : (
                      <span className="biz-qty-geo mono" title={formula} tabIndex={0} aria-label={`${l.quantityDisplay} ${UNIT_LABEL[l.unit]}: ${formula}`}>
                        {l.quantityDisplay.toLocaleString('en-IN', { maximumFractionDigits: 2 })} <small>{UNIT_LABEL[l.unit]}</small>
                        <span className="biz-geo-dot" aria-hidden />
                      </span>
                    )}
                  </td>
                  <td className="biz-c-rate">
                    <RupeeInput value={l.materialRate} label="Material rate" disabled={l.clientSupplied} onChange={(materialRate) => onChange(l.id, { materialRate })} />
                  </td>
                  <td className="biz-c-rate">
                    <RupeeInput value={l.labourRate} label="Labour rate" onChange={(labourRate) => onChange(l.id, { labourRate })} />
                  </td>
                  <td className="biz-c-pct">
                    <NumberInput value={l.markupPct} label="Markup percent" max={300} step={0.5} onChange={(markupPct) => onChange(l.id, { markupPct })} />
                  </td>
                  <td className="biz-c-pct">
                    <NumberInput value={l.discountPct} label="Discount percent" max={100} step={0.5} onChange={(discountPct) => onChange(l.id, { discountPct })} />
                  </td>
                  <td className="biz-c-amt mono">{l.optional ? <s>{amt(l.amount)}</s> : amt(l.amount)}</td>
                  <td className="biz-c-flags">
                    <Flag on={l.optional} label="Optional — shown, not in total" short="Opt" onToggle={() => onChange(l.id, { optional: !l.optional })} />
                    <Flag on={l.clientSupplied} label="Client supplies material — labour only" short="CS" onToggle={() => onChange(l.id, { clientSupplied: !l.clientSupplied })} />
                    <button className={`btn btn-ghost btn-icon ${isOpen ? 'btn-ghost-on' : ''}`} aria-expanded={isOpen} aria-label="More fields" onClick={() => setOpen(isOpen ? null : l.id)}>
                      ⋯
                    </button>
                    <button className="btn btn-ghost btn-icon" aria-label="Delete line" onClick={() => onDelete(l.id)}>
                      ×
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="biz-line-more">
                    <td />
                    <td colSpan={9}>
                      <div className="biz-more-grid">
                        <label className="field">
                          <span className="field-label">Brand / make</span>
                          <input className="input" value={l.spec?.brand ?? ''} onChange={(e) => onChange(l.id, { spec: { ...l.spec, brand: e.target.value || undefined } })} />
                        </label>
                        <label className="field">
                          <span className="field-label">Grade / spec</span>
                          <input className="input" value={l.spec?.grade ?? ''} onChange={(e) => onChange(l.id, { spec: { ...l.spec, grade: e.target.value || undefined } })} />
                        </label>
                        <label className="field">
                          <span className="field-label">Finish</span>
                          <input className="input" value={l.spec?.finish ?? ''} onChange={(e) => onChange(l.id, { spec: { ...l.spec, finish: e.target.value || undefined } })} />
                        </label>
                        <label className="field">
                          <span className="field-label">Unit</span>
                          <select
                            className="input select"
                            value={l.unit}
                            onChange={(e) => {
                              const unit = e.target.value as TradeUnit;
                              // A geometry rule only fits units of its own base; otherwise the line becomes manual.
                              const fits = !manual && (unitBaseOf(unit) === 'ANY' || unitBaseOf(unit) === unitBaseOf(l.unit));
                              onChange(l.id, fits ? { unit } : { unit, rule: { kind: 'MANUAL' }, quantityDisplay: roundDisplay(l.quantityDisplay, unit), quantityBase: fromDisplayQuantity(roundDisplay(l.quantityDisplay, unit), unit) });
                            }}
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {UNIT_LABEL[u]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">Room</span>
                          <select className="input select" value={l.roomId ?? ''} onChange={(e) => onChange(l.id, { roomId: e.target.value || undefined })}>
                            <option value="">Whole house</option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">Trade</span>
                          <select className="input select" value={l.trade} onChange={(e) => onChange(l.id, { trade: e.target.value as Trade })}>
                            {TRADES.filter((t) => t !== 'DESIGN_FEE').map((t) => (
                              <option key={t} value={t}>
                                {TRADE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">HSN / SAC</span>
                          <input className="input mono" value={l.hsnSac} maxLength={8} onChange={(e) => onChange(l.id, { hsnSac: e.target.value.replace(/\D/g, '') })} />
                        </label>
                        <label className="field">
                          <span className="field-label">GST %</span>
                          <select className="input select" value={l.gstRatePct} onChange={(e) => onChange(l.id, { gstRatePct: Number(e.target.value) })}>
                            {[0, 5, 12, 18, 28].map((r) => (
                              <option key={r} value={r}>
                                {r}%
                              </option>
                            ))}
                          </select>
                        </label>
                        {!manual && (
                          <div className="field biz-more-wide">
                            <span className="field-label">Quantity from the plan</span>
                            <span className="hint">
                              {formula}{' '}
                              <button
                                className="btn btn-small"
                                onClick={() => onChange(l.id, { rule: { kind: 'MANUAL' } })}
                                title="Stop following the plan and type the quantity"
                              >
                                Type quantity instead
                              </button>
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

function MoveButtons({ first, last, onMove }: { first: boolean; last: boolean; onMove: (d: -1 | 1) => void }) {
  return (
    <span className="biz-move">
      <button className="biz-move-btn" disabled={first} aria-label="Move up" onClick={() => onMove(-1)}>
        ▲
      </button>
      <button className="biz-move-btn" disabled={last} aria-label="Move down" onClick={() => onMove(1)}>
        ▼
      </button>
    </span>
  );
}

function Flag({ on, label, short, onToggle }: { on: boolean; label: string; short: string; onToggle: () => void }) {
  return (
    <button className={`chip biz-flag ${on ? 'chip-on' : ''}`} aria-pressed={on} title={label} aria-label={label} onClick={onToggle}>
      {short}
    </button>
  );
}
