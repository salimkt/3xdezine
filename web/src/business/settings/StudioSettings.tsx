import { useRef, useState } from 'react';
import type { GstRegistration, StudioProfile } from '@shared/business';
import { Dialog, ErrorLine, useAction } from '../../cloud/ui/common';
import { CLOUD_ENABLED, useCloud } from '../../cloud/state';
import { GST_STATES, checkGstin, stateName } from '../engines';
import { isSignedIn, saveStudio } from '../api';
import { useBiz } from '../state';
import { closeBizDialog } from '../BizDialogs';
import { normaliseStudio } from '../defaults';
import { BizField, ListEditor, MilestonesEditor } from '../ui';
import { LOGO_MAX_BYTES, dataUrlBytes, downscaleLogo } from './logo';

const REGISTRATION: Array<[GstRegistration, string, string]> = [
  ['REGULAR', 'Regular', 'Charges GST; can issue tax invoices.'],
  ['COMPOSITION', 'Composition', 'Pays tax on turnover; issues a bill of supply, no GST charged.'],
  ['UNREGISTERED', 'Not registered', 'Below the threshold; plain quotations and invoices, no GST.'],
];

export default function StudioSettings() {
  const stored = useBiz((s) => s.studio);
  const source = useBiz((s) => s.studioSource);
  const status = useCloud((s) => s.status);
  const [s, setS] = useState<StudioProfile>(() => normaliseStudio(stored));
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const file = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<StudioProfile>) => {
    setSaved(false);
    setS((cur) => ({ ...cur, ...p }));
  };
  const patchAddress = (p: Partial<StudioProfile['address']>) => patch({ address: { ...s.address, ...p } });

  const gst = s.gstin ? checkGstin(s.gstin) : null;
  const mismatch = gst?.ok && gst.stateCode && gst.stateCode !== s.address.stateCode;
  const milestoneTotal = s.defaultMilestones.reduce((t, m) => t + (Number(m.pct) || 0), 0);
  const needsGstin = s.gstRegistration !== 'UNREGISTERED';
  const pinOk = /^[1-9][0-9]{5}$/.test(s.address.pin);
  const bankFilled = Boolean(s.bank?.accountNo || s.bank?.ifsc || s.bank?.accountName);
  const bankOk = !bankFilled || (/^[0-9]{9,18}$/.test(s.bank?.accountNo ?? '') && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s.bank?.ifsc ?? '') && Boolean(s.bank?.accountName?.trim()));
  const problems = [
    !s.legalName.trim() && 'the legal name',
    !s.address.line1.trim() && 'address line 1',
    !s.address.city.trim() && 'the city',
    !pinOk && 'a 6-digit PIN',
    needsGstin && !gst?.ok && 'a valid GSTIN',
    mismatch && 'a GSTIN from the address’s state',
    s.gstRegistration === 'UNREGISTERED' && s.gstin && 'no GSTIN when not registered (or pick Regular/Composition)',
    !s.numberPrefix && 'a number prefix',
    !bankOk && 'complete bank details (or none)',
    Math.abs(milestoneTotal - 100) >= 0.001 && 'milestones totalling 100%',
  ].filter(Boolean) as string[];
  const canSave =
    problems.length === 0 &&
    s.legalName.trim().length > 0 &&
    Math.abs(milestoneTotal - 100) < 0.001 &&
    (!needsGstin || Boolean(gst?.ok)) &&
    (!s.gstin || Boolean(gst?.ok));

  const onGstin = (raw: string) => {
    const gstin = raw.toUpperCase().replace(/\s+/g, '').slice(0, 15);
    const next: Partial<StudioProfile> = { gstin: gstin || undefined };
    const check = gstin.length === 15 ? checkGstin(gstin) : null;
    // A valid GSTIN names its state; fill it in when the address hasn't been set.
    if (check?.ok && check.stateCode && (!s.address.line1 || !s.address.stateCode)) {
      next.address = { ...s.address, stateCode: check.stateCode, stateName: stateName(check.stateCode) };
    }
    if (check?.ok && check.pan && !s.pan) next.pan = check.pan;
    if (check?.ok && s.gstRegistration === 'UNREGISTERED') next.gstRegistration = 'REGULAR';
    patch(next);
  };

  const onLogo = async (f: File | undefined) => {
    setLogoError(null);
    if (!f) return;
    try {
      patch({ logoDataUrl: await downscaleLogo(f) });
    } catch (e) {
      setLogoError((e as Error).message);
    }
  };

  const save = () =>
    void run(async () => {
      const { bank, ...rest } = s;
      await saveStudio({
        ...rest,
        ...(bankFilled && bank ? { bank: { ...bank, upiId: bank.upiId || undefined } } : {}),
        gstin: s.gstin || undefined,
        pan: s.gstin && gst?.pan ? gst.pan : s.pan,
        legalName: s.legalName.trim(),
      });
      setSaved(true);
    });

  return (
    <Dialog title="Studio settings" onClose={closeBizDialog} width={760}>
      <div className="biz-settings">
        <p className="cloud-lead">
          Printed on every quotation: your letterhead, GST details and payment terms.{' '}
          {isSignedIn()
            ? 'Saved to your studio in the cloud.'
            : CLOUD_ENABLED && status !== 'signedIn'
              ? 'Saved in this browser until you sign in.'
              : 'Saved in this browser.'}
          {source === 'cloud' && <span className="badge badge-quiet biz-src">cloud</span>}
        </p>

        <section className="biz-section">
          <h3>Business</h3>
          <div className="biz-grid">
            <BizField label="Legal name *" wide>
              <input className="input" value={s.legalName} maxLength={120} placeholder="Studio Sahyadri Interiors LLP" onChange={(e) => patch({ legalName: e.target.value })} />
            </BizField>
            <BizField label="Trade name">
              <input className="input" value={s.tradeName ?? ''} maxLength={120} placeholder="Sahyadri Studio" onChange={(e) => patch({ tradeName: e.target.value || undefined })} />
            </BizField>
            <BizField label="Quote number prefix" hint={`e.g. ${(s.numberPrefix || 'QT').toUpperCase()}/Q/26-27/0042`}>
              <input
                className="input mono"
                value={s.numberPrefix}
                maxLength={4}
                onChange={(e) => patch({ numberPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })}
              />
            </BizField>
            <BizField label="Phone">
              <input className="input" type="tel" value={s.phone ?? ''} onChange={(e) => patch({ phone: e.target.value || undefined })} />
            </BizField>
            <BizField label="Email">
              <input className="input" type="email" value={s.email ?? ''} onChange={(e) => patch({ email: e.target.value || undefined })} />
            </BizField>
          </div>
        </section>

        <section className="biz-section">
          <h3>Address</h3>
          <div className="biz-grid">
            <BizField label="Line 1" wide>
              <input className="input" value={s.address.line1} onChange={(e) => patchAddress({ line1: e.target.value })} />
            </BizField>
            <BizField label="Line 2" wide>
              <input className="input" value={s.address.line2 ?? ''} onChange={(e) => patchAddress({ line2: e.target.value || undefined })} />
            </BizField>
            <BizField label="City">
              <input className="input" value={s.address.city} onChange={(e) => patchAddress({ city: e.target.value })} />
            </BizField>
            <BizField label="PIN" hint={s.address.pin && !pinOk ? <span className="biz-bad">6 digits</span> : undefined}>
              <input className="input mono" inputMode="numeric" maxLength={6} value={s.address.pin} onChange={(e) => patchAddress({ pin: e.target.value.replace(/\D/g, '') })} />
            </BizField>
            <BizField label="State" hint={mismatch ? undefined : 'Decides CGST + SGST or IGST on each quote'}>
              <select
                className="input select"
                value={s.address.stateCode}
                onChange={(e) => patchAddress({ stateCode: e.target.value, stateName: stateName(e.target.value) })}
              >
                {GST_STATES.map((st) => (
                  <option key={st.code} value={st.code}>
                    {st.code} · {st.name}
                  </option>
                ))}
              </select>
            </BizField>
          </div>
        </section>

        <section className="biz-section">
          <h3>GST</h3>
          <div className="biz-radios" role="radiogroup" aria-label="GST registration">
            {REGISTRATION.map(([id, label, detail]) => (
              <label key={id} className={`biz-radio ${s.gstRegistration === id ? 'biz-radio-on' : ''}`}>
                <input type="radio" name="gstreg" checked={s.gstRegistration === id} onChange={() => patch({ gstRegistration: id })} />
                <span>
                  <b>{label}</b>
                  <small>{detail}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="biz-grid">
            <BizField
              label={needsGstin ? 'GSTIN *' : 'GSTIN'}
              hint={
                !s.gstin ? (
                  needsGstin ? 'Required for a registered business' : '15 characters, e.g. 27ABCDE1234F1Z5'
                ) : gst?.ok ? (
                  <span className="biz-ok">Valid · state {gst.stateCode} {stateName(gst.stateCode ?? '')}</span>
                ) : (
                  <span className="biz-bad">{gst?.message ?? 'Invalid GSTIN'}</span>
                )
              }
            >
              <input
                className={`input mono ${s.gstin && !gst?.ok ? 'biz-input-bad' : ''}`}
                value={s.gstin ?? ''}
                maxLength={15}
                spellCheck={false}
                autoCapitalize="characters"
                aria-invalid={Boolean(s.gstin && !gst?.ok)}
                onChange={(e) => onGstin(e.target.value)}
              />
            </BizField>
            <BizField label="PAN">
              <input className="input mono" value={s.pan ?? ''} maxLength={10} onChange={(e) => patch({ pan: e.target.value.toUpperCase() || undefined })} />
            </BizField>
            <label className="policy-toggle biz-field-wide">
              <input type="checkbox" checked={s.turnoverAbove5Cr} onChange={(e) => patch({ turnoverAbove5Cr: e.target.checked })} />
              <span>
                <b>Aggregate turnover above ₹5 crore</b>
                <small>Prints 6-digit HSN/SAC codes instead of 4.</small>
              </span>
            </label>
          </div>
          {mismatch && (
            <p className="biz-warn" role="alert">
              The GSTIN is registered in state {gst?.stateCode} ({stateName(gst?.stateCode ?? '')}) but the address is in{' '}
              {s.address.stateCode} ({s.address.stateName}). A GSTIN is per state — check you’ve entered the right one.{' '}
              <button
                className="btn btn-small"
                onClick={() => patchAddress({ stateCode: gst!.stateCode!, stateName: stateName(gst!.stateCode!) })}
              >
                Use {stateName(gst?.stateCode ?? '')}
              </button>
            </p>
          )}
        </section>

        <section className="biz-section">
          <h3>Brand</h3>
          <div className="biz-brand">
            <div className="biz-logo" style={{ borderColor: s.brandColorHex ?? undefined }}>
              {s.logoDataUrl ? <img src={s.logoDataUrl} alt="Studio logo" /> : <span>No logo</span>}
            </div>
            <div className="biz-brand-actions">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => void onLogo(e.target.files?.[0])} />
              <button className="btn" onClick={() => file.current?.click()}>
                {s.logoDataUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {s.logoDataUrl && (
                <button className="btn btn-ghost" onClick={() => patch({ logoDataUrl: undefined })}>
                  Remove
                </button>
              )}
              <span className="hint">
                {s.logoDataUrl
                  ? `${(dataUrlBytes(s.logoDataUrl) / 1024).toFixed(1)} KB of ${LOGO_MAX_BYTES / 1024} KB`
                  : 'Resized in your browser to fit 64 KB.'}
              </span>
              <label className="biz-color">
                <span className="field-label">Brand colour</span>
                <input type="color" value={s.brandColorHex ?? '#1c8593'} onChange={(e) => patch({ brandColorHex: e.target.value })} />
                <span className="mono">{s.brandColorHex ?? '—'}</span>
              </label>
            </div>
          </div>
          <ErrorLine text={logoError} />
          <p className="hint">Logo and colour print on Solo, Studio and Project Pass quotes. Free quotes carry the 3xDezine mark.</p>
        </section>

        <section className="biz-section">
          <h3>Bank and UPI</h3>
          <div className="biz-grid">
            <BizField label="Account name">
              <input className="input" value={s.bank?.accountName ?? ''} onChange={(e) => patch({ bank: { accountName: e.target.value, accountNo: s.bank?.accountNo ?? '', ifsc: s.bank?.ifsc ?? '', upiId: s.bank?.upiId } })} />
            </BizField>
            <BizField label="Account number">
              <input className="input mono" inputMode="numeric" value={s.bank?.accountNo ?? ''} onChange={(e) => patch({ bank: { accountName: s.bank?.accountName ?? '', accountNo: e.target.value.replace(/\s/g, ''), ifsc: s.bank?.ifsc ?? '', upiId: s.bank?.upiId } })} />
            </BizField>
            <BizField label="IFSC" hint={s.bank?.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s.bank.ifsc) ? <span className="biz-bad">IFSC is 4 letters, 0, then 6 characters</span> : undefined}>
              <input className="input mono" maxLength={11} value={s.bank?.ifsc ?? ''} onChange={(e) => patch({ bank: { accountName: s.bank?.accountName ?? '', accountNo: s.bank?.accountNo ?? '', ifsc: e.target.value.toUpperCase(), upiId: s.bank?.upiId } })} />
            </BizField>
            <BizField label="UPI ID">
              <input className="input mono" value={s.bank?.upiId ?? ''} placeholder="studio@okhdfc" onChange={(e) => patch({ bank: { accountName: s.bank?.accountName ?? '', accountNo: s.bank?.accountNo ?? '', ifsc: s.bank?.ifsc ?? '', upiId: e.target.value || undefined } })} />
            </BizField>
          </div>
        </section>

        <section className="biz-section">
          <h3>Default payment milestones</h3>
          <MilestonesEditor value={s.defaultMilestones} onChange={(defaultMilestones) => patch({ defaultMilestones })} />
        </section>

        <section className="biz-section">
          <h3>Default terms</h3>
          <ListEditor value={s.defaultTerms} onChange={(defaultTerms) => patch({ defaultTerms })} rows={6} ariaLabel="Default terms, one per line" />
          <span className="hint">One term per line. Copied into each new quote, where you can edit them.</span>
        </section>

        <ErrorLine text={error} />
        {problems.length > 0 && <p className="hint">Still needed: {problems.join(', ')}.</p>}
        <div className="cloud-actions biz-sticky-actions">
          {saved && <span className="biz-ok">Saved</span>}
          <span className="topbar-spacer" />
          <button className="btn" onClick={closeBizDialog}>
            Close
          </button>
          <button className="btn btn-primary" disabled={busy || !canSave} onClick={save} title={canSave ? undefined : `Still needed: ${problems.join(', ')}`}>
            {busy ? 'Saving…' : 'Save studio'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
