import { Fragment, useMemo, useState } from 'react';
import type { RateCardEntry, RateCardOverrides, Trade, TradeUnit } from '@shared/business';
import { Dialog, ErrorLine, useAction } from '../../cloud/ui/common';
import { useCloud } from '../../cloud/state';
import { formatINR } from '../engines';
import { UNIT_LABEL } from '../doc/QuoteDoc';
import { getCloudOverrides, isSignedIn, saveRateOverrides } from '../api';
import { openPricing, useBiz } from '../state';
import { closeBizDialog } from '../BizDialogs';
import { DEFAULT_CARD, TRADE_LABEL, freeEntitlements } from '../quote/model';
import { ConfidenceBadge } from '../quote/AddFromCard';
import { RupeeInput } from '../quote/LineTable';
import { UpgradeNote } from '../ui';

const empty = (): RateCardOverrides => ({ baseCardId: DEFAULT_CARD.id, overrides: {}, added: [], disabled: [] });

const UNITS: TradeUnit[] = ['SQFT', 'SQM', 'RFT', 'RMT', 'POINT', 'NOS', 'SET', 'LS'];

/**
 * The default card by trade, every rate with its source and confidence —
 * shown honestly: most are LOW-confidence planning figures. A studio on Solo
 * or above overrides rates, disables entries and adds its own; everyone else
 * can still change any rate on a quote line.
 */
export default function RateCardEditor() {
  const ents = useBiz((s) => s.entitlements) ?? freeEntitlements();
  const studio = useBiz((s) => s.studio);
  const studioSource = useBiz((s) => s.studioSource);
  const status = useCloud((s) => s.status);
  const [o, setO] = useState<RateCardOverrides>(() => structuredClone(getCloudOverrides() ?? empty()));
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [add, setAdd] = useState<{ description: string; trade: Trade; unit: TradeUnit; materialRate: number; labourRate: number }>({
    description: '',
    trade: 'CARPENTRY',
    unit: 'SQFT',
    materialRate: 0,
    labourRate: 0,
  });
  const { busy, error, run } = useAction();
  const editable = ents.rateCards;

  const entries = useMemo(() => [...DEFAULT_CARD.entries, ...o.added], [o.added]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => (!onlyLow || e.source.confidence === 'LOW') && (!needle || `${e.description} ${e.id} ${TRADE_LABEL[e.trade]}`.toLowerCase().includes(needle)));
  }, [entries, q, onlyLow]);
  const byTrade = useMemo(() => {
    const m = new Map<Trade, RateCardEntry[]>();
    for (const e of shown) m.set(e.trade, [...(m.get(e.trade) ?? []), e]);
    return [...m.entries()];
  }, [shown]);
  const lowCount = DEFAULT_CARD.entries.filter((e) => e.source.confidence === 'LOW').length;

  const touch = (next: RateCardOverrides) => {
    setSaved(false);
    setO(next);
  };
  const isAdded = (id: string) => o.added.some((e) => e.id === id);
  const rateOf = (e: RateCardEntry, k: 'materialRate' | 'labourRate') => (isAdded(e.id) ? e[k] : (o.overrides[e.id]?.[k] ?? e[k]));
  const setRate = (e: RateCardEntry, k: 'materialRate' | 'labourRate', v: number) => {
    if (isAdded(e.id)) return touch({ ...o, added: o.added.map((a) => (a.id === e.id ? { ...a, [k]: v } : a)) });
    const cur = { ...(o.overrides[e.id] ?? {}) };
    if (v === e[k]) delete cur[k];
    else cur[k] = v;
    const overrides = { ...o.overrides };
    if (Object.keys(cur).length) overrides[e.id] = cur;
    else delete overrides[e.id];
    touch({ ...o, overrides });
  };
  const toggle = (id: string) => touch({ ...o, disabled: o.disabled.includes(id) ? o.disabled.filter((d) => d !== id) : [...o.disabled, id] });
  const reset = (id: string) => {
    if (isAdded(id)) return touch({ ...o, added: o.added.filter((a) => a.id !== id), disabled: o.disabled.filter((d) => d !== id) });
    const overrides = { ...o.overrides };
    delete overrides[id];
    touch({ ...o, overrides, disabled: o.disabled.filter((d) => d !== id) });
  };

  const addEntry = () => {
    if (!add.description.trim()) return;
    const id = `STUDIO-${Date.now().toString(36).toUpperCase()}`;
    const entry: RateCardEntry = {
      id,
      trade: add.trade,
      description: add.description.trim(),
      unit: add.unit,
      materialRate: add.materialRate,
      labourRate: add.labourRate,
      hsnSac: add.trade === 'CARPENTRY' ? '995476' : add.trade === 'PAINTING' ? '995473' : '9954',
      gstRatePct: 18,
      supplyNature: 'WORKS_CONTRACT',
      defaultRule: { kind: 'MANUAL' },
      source: { name: `${studio?.tradeName || studio?.legalName || 'Studio'} rate`, asOf: new Date().toISOString().slice(0, 7), confidence: 'HIGH' },
    };
    touch({ ...o, added: [...o.added, entry] });
    setAdd({ ...add, description: '', materialRate: 0, labourRate: 0 });
  };

  const changed = Object.keys(o.overrides).length + o.added.length + o.disabled.length;
  const cloudStudio = studioSource === 'cloud' && studio && !studio.id.startsWith('local-') ? studio : null;
  const save = () =>
    void run(async () => {
      if (!cloudStudio) throw new Error('Save your studio settings to the cloud first — rate cards belong to a studio.');
      await saveRateOverrides(cloudStudio.id, o);
      setSaved(true);
    });

  return (
    <Dialog title={`Rate card — ${DEFAULT_CARD.name}`} onClose={closeBizDialog} width={1000}>
      <div className="biz-rc">
        <p className="cloud-lead">
          Material and labour per unit, ex-GST. <b>{lowCount}</b> of {DEFAULT_CARD.entries.length} rates are{' '}
          <span className="biz-conf biz-conf-low">LOW</span> confidence: planning ranges from thin or conflicting sources, not
          market quotes. Replace them with your own before you rely on them.
        </p>
        {!editable && (
          <UpgradeNote onUpgrade={() => openPricing({ reason: 'Your own rate card — override every rate once, use it on every quote — is part of Solo.' })}>
            You can view the card and change any rate on a quote line. Saving your own card is part of Solo.
          </UpgradeNote>
        )}
        <div className="biz-rc-head">
          <input className="input" placeholder="Search rates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rates" />
          <button className={`chip ${onlyLow ? 'chip-on' : ''}`} aria-pressed={onlyLow} onClick={() => setOnlyLow(!onlyLow)}>
            Only LOW confidence
          </button>
          <span className="topbar-spacer" />
          {changed > 0 && <span className="badge badge-quiet">{changed} change{changed === 1 ? '' : 's'}</span>}
        </div>
        <div className="biz-rc-scroll">
          <table className="biz-rc-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Source</th>
                <th>Material ₹</th>
                <th>Labour ₹</th>
                <th>Total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {byTrade.map(([trade, list]) => (
                <Fragment key={trade}>
                  <tr className="biz-rc-trade">
                    <td colSpan={7}>{TRADE_LABEL[trade]}</td>
                  </tr>
                  {list.map((e) => {
                    const off = o.disabled.includes(e.id);
                    const ch = Boolean(o.overrides[e.id]) || isAdded(e.id);
                    const m = rateOf(e, 'materialRate');
                    const l = rateOf(e, 'labourRate');
                    return (
                      <tr key={e.id} className={`${off ? 'biz-rc-off' : ''} ${ch ? 'biz-rc-changed' : ''}`}>
                        <td className="biz-rc-desc">
                          {e.description}
                          <small className="mono">{e.id}{e.defaultRule.kind !== 'MANUAL' ? ' · quantity from plan' : ''}</small>
                        </td>
                        <td>{UNIT_LABEL[e.unit]}</td>
                        <td title={`${e.source.name}${e.source.url ? ` — ${e.source.url}` : ''}`}>
                          <ConfidenceBadge c={e.source.confidence} /> <small className="hint">{e.source.asOf}</small>
                        </td>
                        <td>
                          <RupeeInput value={m} label={`${e.description} material rate`} disabled={!editable || off} onChange={(v) => setRate(e, 'materialRate', v)} />
                        </td>
                        <td>
                          <RupeeInput value={l} label={`${e.description} labour rate`} disabled={!editable || off} onChange={(v) => setRate(e, 'labourRate', v)} />
                        </td>
                        <td className="mono">{formatINR(m + l, { paise: false })}</td>
                        <td>
                          {editable && (
                            <>
                              <button className="btn btn-small btn-ghost" onClick={() => toggle(e.id)}>
                                {off ? 'Enable' : 'Disable'}
                              </button>
                              {(ch || off) && (
                                <button className="btn btn-small btn-ghost" onClick={() => reset(e.id)}>
                                  {isAdded(e.id) ? 'Remove' : 'Reset'}
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="biz-rc-add">
            <label className="field">
              <span className="field-label">Add your own item</span>
              <input className="input" value={add.description} placeholder="e.g. Louvered shoe rack, laminate" onChange={(e) => setAdd({ ...add, description: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Trade</span>
              <select className="input select" value={add.trade} onChange={(e) => setAdd({ ...add, trade: e.target.value as Trade })}>
                {(Object.keys(TRADE_LABEL) as Trade[]).filter((t) => t !== 'DESIGN_FEE').map((t) => (
                  <option key={t} value={t}>
                    {TRADE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Unit</span>
              <select className="input select" value={add.unit} onChange={(e) => setAdd({ ...add, unit: e.target.value as TradeUnit })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Material ₹</span>
              <RupeeInput value={add.materialRate} label="New item material rate" onChange={(materialRate) => setAdd({ ...add, materialRate })} />
            </label>
            <label className="field">
              <span className="field-label">Labour ₹</span>
              <RupeeInput value={add.labourRate} label="New item labour rate" onChange={(labourRate) => setAdd({ ...add, labourRate })} />
            </label>
            <button className="btn" disabled={!add.description.trim()} onClick={addEntry}>
              Add
            </button>
          </div>
        )}
        <ErrorLine text={error} />
        <div className="cloud-actions">
          {saved && <span className="biz-ok">Saved — new quotes price from your card.</span>}
          {editable && !isSignedIn() && status !== 'signedIn' && <span className="hint">Sign in to save your card.</span>}
          <span className="topbar-spacer" />
          <button className="btn" onClick={closeBizDialog}>
            Close
          </button>
          {editable && (
            <button className="btn btn-primary" disabled={busy || !isSignedIn()} onClick={save}>
              {busy ? 'Saving…' : 'Save rate card'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
