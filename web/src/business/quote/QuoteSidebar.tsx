import { useState, type ReactNode } from 'react';
import type { Address, DocType, Party, QuotationDocument } from '@shared/business';
import { gstState } from '@shared/gst';
import { GST_STATES, checkGstin, formatINR, stateName } from '../engines';
import { DOC_TITLE } from '../doc/QuoteDoc';
import { BizField, ListEditor, MilestonesEditor } from '../ui';
import type { QuoteDraft } from '../workspace';
import { NumberInput, RupeeInput } from './LineTable';

const inr = (p: number) => formatINR(p);

export function TotalsPanel({ doc, error, freePlan }: { doc: QuotationDocument | null; error?: string; freePlan: boolean }) {
  if (!doc) {
    return (
      <div className="biz-totals">
        <p className="biz-bad">{error ?? 'Can’t compute this quote yet.'}</p>
      </div>
    );
  }
  const subtotal = doc.sections.reduce((s, sec) => s + sec.subtotal, 0);
  return (
    <div className="biz-totals" aria-live="polite">
      <Row label="Subtotal" value={inr(subtotal)} />
      {doc.designFee && doc.designFee.amount > 0 && <Row label="Design fee" value={inr(doc.designFee.amount)} />}
      {doc.discount && doc.discount.amount > 0 && <Row label={doc.discount.label || 'Discount'} value={`− ${inr(doc.discount.amount)}`} />}
      <Row label="Taxable value" value={inr(doc.taxableValue)} strong />
      {doc.taxLines
        .filter((t) => t.cgst + t.sgst + t.igst > 0)
        .flatMap((t) =>
          doc.isInterState
            ? [<Row key={`${t.hsnSac}${t.ratePct}i`} label={`IGST ${t.ratePct}% · ${t.hsnSac}`} value={inr(t.igst)} small />]
            : [
                <Row key={`${t.hsnSac}${t.ratePct}c`} label={`CGST ${t.ratePct / 2}% · ${t.hsnSac}`} value={inr(t.cgst)} small />,
                <Row key={`${t.hsnSac}${t.ratePct}s`} label={`${gstState(doc.placeOfSupplyStateCode)?.taxLabel ?? 'SGST'} ${t.ratePct / 2}% · ${t.hsnSac}`} value={inr(t.sgst)} small />,
              ],
        )}
      {doc.totalTax === 0 && <Row label="GST" value="not charged" small />}
      {doc.roundOff !== 0 && <Row label="Round off" value={`${doc.roundOff > 0 ? '+' : '−'} ${inr(Math.abs(doc.roundOff))}`} small />}
      <div className="biz-grand">
        <span>Grand total</span>
        <b className="mono">{formatINR(doc.grandTotal, { paise: false })}</b>
      </div>
      <p className="biz-words">{doc.amountInWords}</p>
      {doc.paymentSchedule.length > 0 && (
        <ul className="biz-sched">
          {doc.paymentSchedule.map((m) => (
            <li key={m.id}>
              <span>
                {m.pct}% · {m.label}
              </span>
              <span className="mono">{formatINR(m.amount, { paise: false })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint biz-place">
        {DOC_TITLE[doc.docType]} · place of supply {doc.placeOfSupplyStateCode} {stateName(doc.placeOfSupplyStateCode)} ·{' '}
        {doc.isInterState ? 'IGST (inter-state)' : `CGST + ${gstState(doc.placeOfSupplyStateCode)?.taxLabel ?? 'SGST'} (intra-state)`}
        {freePlan && ' · watermarked'}
      </p>
    </div>
  );
}

function Row({ label, value, strong, small }: { label: string; value: string; strong?: boolean; small?: boolean }) {
  return (
    <div className={`biz-trow ${strong ? 'biz-trow-strong' : ''} ${small ? 'biz-trow-small' : ''}`}>
      <span>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

export function Section({ title, children, defaultOpen = false, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`biz-side-sec ${open ? 'is-open' : ''}`}>
      <button className="biz-side-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {badge}
        <span className={`caret ${open ? 'caret-open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="biz-side-body">{children}</div>}
    </section>
  );
}

export function AddressEditor({ value, onChange, idPrefix }: { value: Address; onChange: (a: Address) => void; idPrefix: string }) {
  const set = (p: Partial<Address>) => onChange({ ...value, ...p });
  return (
    <div className="biz-grid biz-grid-tight">
      <BizField label="Line 1" wide>
        <input className="input" id={`${idPrefix}-l1`} value={value.line1} onChange={(e) => set({ line1: e.target.value })} />
      </BizField>
      <BizField label="Line 2" wide>
        <input className="input" value={value.line2 ?? ''} onChange={(e) => set({ line2: e.target.value || undefined })} />
      </BizField>
      <BizField label="City">
        <input className="input" value={value.city} onChange={(e) => set({ city: e.target.value })} />
      </BizField>
      <BizField label="PIN">
        <input className="input mono" inputMode="numeric" maxLength={6} value={value.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })} />
      </BizField>
      <BizField label="State" wide>
        <select className="input select" value={value.stateCode} onChange={(e) => set({ stateCode: e.target.value, stateName: stateName(e.target.value) })}>
          {GST_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </BizField>
    </div>
  );
}

export function DraftSettings({
  draft,
  patch,
  doc,
  docTypes,
  lockedDocTypes,
  onUpgrade,
  sqft,
}: {
  draft: QuoteDraft;
  patch: (p: Partial<QuoteDraft>) => void;
  doc: QuotationDocument | null;
  docTypes: DocType[];
  /** Doc types the plan or registration doesn't allow, shown disabled with why. */
  lockedDocTypes: Array<{ type: DocType; why: string }>;
  onUpgrade: () => void;
  sqft: { carpet: number; builtUp: number };
}) {
  const r = draft.recipient;
  const setParty = (p: Partial<Party>) => patch({ recipient: { ...r, ...p } });
  const gst = r.gstin ? checkGstin(r.gstin) : null;
  const sameSite = JSON.stringify(draft.siteAddress) === JSON.stringify(r.address);
  const fee = draft.designFee;
  const isVO = draft.docType === 'VARIATION_ORDER';

  return (
    <>
      <Section title="Document" defaultOpen>
        <div className="biz-grid biz-grid-tight">
          <BizField label="Type" wide>
            {isVO ? (
              <input className="input" value="Variation order" readOnly />
            ) : (
              <select className="input select" value={draft.docType} onChange={(e) => patch({ docType: e.target.value as DocType })}>
                {docTypes.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TITLE[t]}
                  </option>
                ))}
                {lockedDocTypes.map(({ type, why }) => (
                  <option key={type} value={type} disabled>
                    {DOC_TITLE[type]} — {why}
                  </option>
                ))}
              </select>
            )}
          </BizField>
          {lockedDocTypes.some((l) => l.why.includes('Solo')) && (
            <p className="hint biz-field-wide">
              Tax invoices and proformas need Solo.{' '}
              <button className="btn btn-small" onClick={onUpgrade}>
                See plans
              </button>
            </p>
          )}
          <BizField label="Valid for (days)">
            <NumberInput value={draft.validityDays} min={1} max={365} label="Validity in days" onChange={(validityDays) => patch({ validityDays: Math.round(validityDays) || 1 })} />
          </BizField>
          <BizField label="Area basis">
            <select className="input select" value={draft.areaBasisKind} onChange={(e) => patch({ areaBasisKind: e.target.value as QuoteDraft['areaBasisKind'] })}>
              <option value="CARPET">Carpet · {Math.round(sqft.carpet).toLocaleString('en-IN')} sq ft</option>
              <option value="BUILT_UP">Built-up · {Math.round(sqft.builtUp).toLocaleString('en-IN')} sq ft</option>
            </select>
          </BizField>
        </div>
      </Section>

      <Section title="Client" defaultOpen badge={!r.legalName ? <span className="badge badge-warn">needed</span> : undefined}>
        <div className="biz-grid biz-grid-tight">
          <BizField label="Name" wide>
            <input className="input" value={r.legalName} placeholder="Mr & Mrs Kulkarni" onChange={(e) => setParty({ legalName: e.target.value })} />
          </BizField>
          <BizField label="Phone">
            <input className="input" type="tel" value={r.phone ?? ''} onChange={(e) => setParty({ phone: e.target.value || undefined })} />
          </BizField>
          <BizField label="Email">
            <input className="input" type="email" value={r.email ?? ''} onChange={(e) => setParty({ email: e.target.value || undefined })} />
          </BizField>
          <BizField
            label="Client GSTIN (if claiming ITC)"
            wide
            hint={r.gstin ? (gst?.ok ? <span className="biz-ok">Valid</span> : <span className="biz-bad">{gst?.message}</span>) : undefined}
          >
            <input className="input mono" maxLength={15} value={r.gstin ?? ''} onChange={(e) => setParty({ gstin: e.target.value.toUpperCase().replace(/\s/g, '') || undefined })} />
          </BizField>
        </div>
        <span className="field-label biz-sub-label">Billing address</span>
        <AddressEditor
          idPrefix="bill"
          value={r.address}
          onChange={(address) => patch({ recipient: { ...r, address }, ...(sameSite ? { siteAddress: address } : {}) })}
        />
      </Section>

      <Section title="Site · place of supply" defaultOpen>
        <label className="policy-toggle">
          <input type="checkbox" checked={sameSite} onChange={(e) => e.target.checked && patch({ siteAddress: { ...r.address } })} />
          <span>
            <b>Same as billing address</b>
            <small>GST follows the site’s state (IGST Act s.12(3)), not the client’s.</small>
          </span>
        </label>
        <AddressEditor idPrefix="site" value={draft.siteAddress} onChange={(siteAddress) => patch({ siteAddress })} />
      </Section>

      <Section title="Design fee & discount">
        <div className="biz-grid biz-grid-tight">
          <BizField label="Design fee">
            <select
              className="input select"
              value={fee?.basis ?? 'NONE'}
              onChange={(e) =>
                patch({
                  designFee:
                    e.target.value === 'NONE'
                      ? undefined
                      : {
                          basis: e.target.value as NonNullable<QuoteDraft['designFee']>['basis'],
                          value: e.target.value === 'PCT_OF_PROJECT' ? 8 : e.target.value === 'PER_SQFT' ? 100_00 : 75_000_00,
                        },
                })
              }
            >
              <option value="NONE">None</option>
              <option value="PCT_OF_PROJECT">% of project</option>
              <option value="PER_SQFT">₹ per sq ft</option>
              <option value="LUMP_SUM">Lump sum</option>
            </select>
          </BizField>
          {fee && (
            <BizField label={fee.basis === 'PCT_OF_PROJECT' ? 'Percent' : fee.basis === 'PER_SQFT' ? '₹ per sq ft' : 'Amount ₹'}>
              {fee.basis === 'PCT_OF_PROJECT' ? (
                <NumberInput value={fee.value} step={0.5} max={50} label="Design fee percent" onChange={(value) => patch({ designFee: { ...fee, value } })} />
              ) : (
                <RupeeInput value={fee.value} label={fee.basis === 'PER_SQFT' ? 'Design fee per sq ft' : 'Design fee amount'} onChange={(value) => patch({ designFee: { ...fee, value } })} />
              )}
            </BizField>
          )}
          <BizField label="Discount label">
            <input className="input" value={draft.discount?.label ?? 'Discount'} onChange={(e) => patch({ discount: { label: e.target.value, amount: draft.discount?.amount ?? 0 } })} />
          </BizField>
          <BizField label="Discount ₹">
            <RupeeInput value={draft.discount?.amount ?? 0} label="Discount amount" onChange={(amount) => patch({ discount: { label: draft.discount?.label ?? 'Discount', amount } })} />
          </BizField>
        </div>
      </Section>

      <Section title="Payment milestones" badge={Math.abs(draft.milestones.reduce((s, m) => s + m.pct, 0) - 100) > 0.001 ? <span className="badge badge-warn">≠ 100%</span> : undefined}>
        <MilestonesEditor
          value={draft.milestones}
          withTrigger
          onChange={(milestones) => patch({ milestones: milestones.map((m) => ({ ...m, trigger: m.trigger ?? 'ON_APPROVAL' })) })}
          amounts={doc?.paymentSchedule.map((m) => formatINR(m.amount, { paise: false }))}
        />
      </Section>

      <Section title="Make list">
        <MakeListEditor value={draft.makeList} onChange={(makeList) => patch({ makeList })} />
      </Section>

      <Section title="Inclusions">
        <ListEditor value={draft.inclusions} onChange={(inclusions) => patch({ inclusions })} rows={4} ariaLabel="Inclusions, one per line" />
      </Section>

      <Section title="Exclusions" defaultOpen={draft.exclusions.length === 0} badge={draft.exclusions.length === 0 ? <span className="badge badge-warn">required</span> : undefined}>
        {draft.exclusions.length === 0 && (
          <p className="biz-warn" role="alert">
            List what is <b>not</b> included. Missing exclusions are the most common root of disputes.
          </p>
        )}
        <ListEditor value={draft.exclusions} onChange={(exclusions) => patch({ exclusions })} rows={5} ariaLabel="Exclusions, one per line" placeholder="One exclusion per line" />
      </Section>

      <Section title="Terms">
        <ListEditor value={draft.terms} onChange={(terms) => patch({ terms })} rows={7} ariaLabel="Terms, one per line" />
      </Section>
    </>
  );
}

function MakeListEditor({ value, onChange }: { value: QuoteDraft['makeList']; onChange: (v: QuoteDraft['makeList']) => void }) {
  const set = (i: number, p: Partial<QuoteDraft['makeList'][number]>) => onChange(value.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return (
    <div className="biz-make">
      {value.map((m, i) => (
        <div key={i} className="biz-make-row">
          <input className="input" aria-label="Category" value={m.category} onChange={(e) => set(i, { category: e.target.value })} />
          <input
            className="input"
            aria-label="Brands, separated by /"
            value={m.brands.join(' / ')}
            onChange={(e) => set(i, { brands: e.target.value.split('/').map((b) => b.trim()).filter(Boolean) })}
          />
          <button className="btn btn-ghost btn-icon" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="btn btn-small" onClick={() => onChange([...value, { category: 'Category', brands: [] }])}>
        Add category
      </button>
    </div>
  );
}
