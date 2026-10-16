import type { ReactNode } from 'react';
import type { DocType, QuotationDocument, QuoteLine, TradeUnit } from '@shared/business';
import { printedRate } from '@shared/trades';
import { gstState, hsnDigits } from '@shared/gst';
import { formatINR, stateName } from '../engines';
import './quoteDoc.css';

/**
 * The quotation as a document: the A4 print layout, the on-screen preview,
 * and the client approval page all render this one component, from the
 * engine's QuotationDocument — so what the client approves is what printed.
 *
 * Internal fields (markup, material/labour split) never appear here.
 */

export const DOC_TITLE: Record<DocType, string> = {
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma Invoice',
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  PLAIN_INVOICE: 'Invoice',
  VARIATION_ORDER: 'Variation Order',
};

export const UNIT_LABEL: Record<TradeUnit, string> = {
  SQFT: 'sq ft',
  SQM: 'sq m',
  RFT: 'rft',
  RMT: 'rmt',
  POINT: 'point',
  NOS: 'nos',
  SET: 'set',
  LS: 'LS',
};

const AREA_LABEL = { CARPET: 'Carpet area', BUILT_UP: 'Built-up area', SUPER_BUILT_UP: 'Super built-up area' } as const;

const amt = (p: number) => formatINR(p, { symbol: false, paise: true });
const rupees = (p: number) => formatINR(p, { paise: true });

function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function qty(n: number, unit: TradeUnit) {
  if (unit === 'LS') return '1';
  const integer = unit === 'NOS' || unit === 'POINT' || unit === 'SET';
  return n.toLocaleString('en-IN', { minimumFractionDigits: integer ? 0 : 2, maximumFractionDigits: integer ? 0 : 2 });
}

function specText(line: Extract<QuoteLine, { kind: 'TRADE' }>) {
  const s = line.spec;
  if (!s) return '';
  return [s.brand, s.grade, s.finish].filter(Boolean).join(' · ');
}

export interface QuoteDocProps {
  doc: QuotationDocument;
  /** 'print' = A4 sheets; 'screen' = responsive (approval page); 'preview' = A4 sheets on screen. */
  variant: 'print' | 'screen' | 'preview';
  /** Shown under the letterhead in previews of a draft. */
  draftNote?: ReactNode;
  /** Extra content after the document body (the approval page's plan, for example). */
  children?: ReactNode;
  /** Room names for room-wise subtitles when a section has none. */
  hideSignatures?: boolean;
}

export function QuoteDoc({ doc, variant, draftNote, children, hideSignatures }: QuoteDocProps) {
  const s = doc.supplier;
  const branded = !doc.watermark;
  const brand = branded && s.brandColorHex ? s.brandColorHex : '#1f2933';
  const anyDiscount = doc.sections.some((sec) => sec.lines.some((l) => l.kind === 'TRADE' && l.discountPct > 0));
  const showTax = doc.docType !== 'BILL_OF_SUPPLY' && doc.taxLines.some((t) => t.ratePct > 0) && doc.totalTax > 0;
  const subtotal = doc.sections.reduce((t, sec) => t + sec.subtotal, 0);
  const title = DOC_TITLE[doc.docType];
  const placeName = stateName(doc.placeOfSupplyStateCode) || doc.siteAddress.stateName;
  const isDraft = doc.status === 'DRAFT' || !doc.number;
  // Union territories without a legislature levy UTGST; the TaxLine field stays `sgst`.
  const sgstLabel = gstState(doc.placeOfSupplyStateCode)?.taxLabel ?? 'SGST';

  return (
    <article className={`qd qd-${variant} ${doc.watermark ? 'qd-free' : ''}`} style={{ ['--qd-brand' as string]: brand }} aria-label={`${title} ${doc.number ?? '(draft)'}`}>
      {doc.watermark && (
        <div className="qd-watermark" aria-hidden>
          Made with 3xDezine
        </div>
      )}

      {/* ---------------------------------------------------- letterhead */}
      <header className="qd-head">
        <div className="qd-supplier">
          {branded && s.logoDataUrl && <img className="qd-logo" src={s.logoDataUrl} alt="" />}
          <div>
            <div className="qd-supplier-name">{s.tradeName || s.legalName || 'Your studio name'}</div>
            {s.tradeName && s.legalName && s.tradeName !== s.legalName && <div className="qd-legal">{s.legalName}</div>}
            <AddressLines a={s.address} />
            <div className="qd-ids">
              {s.gstin ? (
                <span>
                  GSTIN <b className="qd-mono">{s.gstin}</b>
                </span>
              ) : (
                <span>Not registered under GST</span>
              )}
              {s.pan && (
                <span>
                  PAN <b className="qd-mono">{s.pan}</b>
                </span>
              )}
            </div>
            {(s.phone || s.email) && <div className="qd-contact">{[s.phone, s.email].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
        <div className="qd-title-block">
          <h1 className="qd-title">{title}</h1>
          <table className="qd-meta">
            <tbody>
              <tr>
                <th>No.</th>
                <td className="qd-mono">{doc.number ?? (isDraft ? 'DRAFT' : '—')}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{fmtDate(doc.issueDate)}</td>
              </tr>
              {doc.validUntil && doc.docType !== 'TAX_INVOICE' && (
                <tr>
                  <th>Valid until</th>
                  <td>{fmtDate(doc.validUntil)}</td>
                </tr>
              )}
              {doc.version > 1 && (
                <tr>
                  <th>Revision</th>
                  <td>R{doc.version - 1}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </header>
      <div className="qd-rule" />
      {draftNote && <div className="qd-draftnote">{draftNote}</div>}

      {/* ---------------------------------------------------- parties */}
      <section className="qd-parties">
        <div>
          <h4>{doc.docType === 'TAX_INVOICE' || doc.docType === 'BILL_OF_SUPPLY' ? 'Bill to' : 'Prepared for'}</h4>
          <div className="qd-party-name">{doc.recipient.legalName || '—'}</div>
          <AddressLines a={doc.recipient.address} />
          {doc.recipient.gstin && (
            <div className="qd-ids">
              GSTIN <b className="qd-mono">{doc.recipient.gstin}</b>
            </div>
          )}
          {(doc.recipient.phone || doc.recipient.email) && (
            <div className="qd-contact">{[doc.recipient.phone, doc.recipient.email].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <div>
          <h4>Site</h4>
          <AddressLines a={doc.siteAddress} />
          <div className="qd-ids">
            Place of supply: <b>{placeName}</b> ({doc.placeOfSupplyStateCode}){doc.isInterState ? ' · inter-state' : ''}
          </div>
          {doc.areaBasis && (
            <div className="qd-ids">
              {AREA_LABEL[doc.areaBasis.kind]}: <b className="qd-mono">{doc.areaBasis.sqft.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b> sq ft
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- abstract */}
      {doc.sections.length > 1 && (
        <section className="qd-block qd-abstract">
          <h3>Abstract of cost</h3>
          <table className="qd-table qd-table-abstract">
            <thead>
              <tr>
                <th className="qd-c-sl">#</th>
                <th>{doc.view === 'ROOM_WISE' ? 'Room / area' : 'Trade'}</th>
                <th className="qd-num">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {doc.sections.map((sec, i) => (
                <tr key={sec.id}>
                  <td className="qd-c-sl">{i + 1}</td>
                  <td>{sec.title}</td>
                  <td className="qd-num qd-mono">{amt(sec.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Subtotal</td>
                <td className="qd-num qd-mono">{amt(subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* ---------------------------------------------------- bill of quantities */}
      <section className="qd-block qd-boq">
        <h3>{doc.docType === 'VARIATION_ORDER' ? 'Changes to the approved scope' : 'Bill of quantities'}</h3>
        <table className="qd-table qd-table-boq">
          <thead>
            <tr>
              <th className="qd-c-sl">Sl.</th>
              <th className="qd-c-desc">Description of item</th>
              <th className="qd-c-hsn">HSN/SAC</th>
              <th className="qd-c-unit">Unit</th>
              <th className="qd-num qd-c-qty">Qty</th>
              <th className="qd-num qd-c-rate">Rate (₹)</th>
              {anyDiscount && <th className="qd-num qd-c-disc">Disc.</th>}
              <th className="qd-num qd-c-amt">Amount (₹)</th>
            </tr>
          </thead>
          {doc.sections.map((sec) => (
            <tbody key={sec.id} className="qd-section">
              <tr className="qd-section-head">
                <td colSpan={anyDiscount ? 8 : 7}>{sec.title}</td>
              </tr>
              {sec.lines.map((line) => (
                <LineRow key={line.id} line={line} anyDiscount={anyDiscount} wide={s.turnoverAbove5Cr} />
              ))}
              <tr className="qd-section-sub">
                <td colSpan={anyDiscount ? 7 : 6}>Total — {sec.title}</td>
                <td className="qd-num qd-mono">{amt(sec.subtotal)}</td>
              </tr>
            </tbody>
          ))}
        </table>
        {doc.sections.some((sec) => sec.lines.some((l) => l.optional)) && (
          <p className="qd-note">Items marked “optional” are priced for reference and are not included in the total.</p>
        )}
      </section>

      {/* ---------------------------------------------------- totals */}
      <section className="qd-block qd-totals-wrap">
        <table className="qd-totals">
          <tbody>
            <tr>
              <th>Subtotal</th>
              <td className="qd-mono">{amt(subtotal)}</td>
            </tr>
            {doc.designFee && doc.designFee.amount > 0 && (
              <tr>
                <th>
                  Design fee
                  <small>
                    {doc.designFee.basis === 'PCT_OF_PROJECT'
                      ? ` (${doc.designFee.value}% of project)`
                      : doc.designFee.basis === 'PER_SQFT'
                        ? ` (${formatINR(doc.designFee.value)}/sq ft on ${doc.areaBasis ? doc.areaBasis.sqft.toLocaleString('en-IN') : ''} sq ft)`
                        : ' (lump sum)'}{' '}
                    · SAC {doc.designFee.sac}
                  </small>
                </th>
                <td className="qd-mono">{amt(doc.designFee.amount)}</td>
              </tr>
            )}
            {doc.discount && doc.discount.amount > 0 && (
              <tr>
                <th>{doc.discount.label || 'Discount'}</th>
                <td className="qd-mono">− {amt(doc.discount.amount)}</td>
              </tr>
            )}
            <tr className="qd-totals-strong">
              <th>Taxable value</th>
              <td className="qd-mono">{amt(doc.taxableValue)}</td>
            </tr>
            {showTax &&
              doc.taxLines.flatMap((t) =>
                doc.isInterState
                  ? [
                      <tr key={`${t.hsnSac}-${t.ratePct}-i`}>
                        <th>
                          IGST @ {t.ratePct}% <small>on {amt(t.taxableValue)} · {t.hsnSac}</small>
                        </th>
                        <td className="qd-mono">{amt(t.igst)}</td>
                      </tr>,
                    ]
                  : [
                      <tr key={`${t.hsnSac}-${t.ratePct}-c`}>
                        <th>
                          CGST @ {t.ratePct / 2}% <small>on {amt(t.taxableValue)} · {t.hsnSac}</small>
                        </th>
                        <td className="qd-mono">{amt(t.cgst)}</td>
                      </tr>,
                      <tr key={`${t.hsnSac}-${t.ratePct}-s`}>
                        <th>
                          {sgstLabel} @ {t.ratePct / 2}% <small>on {amt(t.taxableValue)} · {t.hsnSac}</small>
                        </th>
                        <td className="qd-mono">{amt(t.sgst)}</td>
                      </tr>,
                    ],
              )}
            {doc.roundOff !== 0 && (
              <tr>
                <th>Round off</th>
                <td className="qd-mono">
                  {doc.roundOff > 0 ? '+ ' : '− '}
                  {amt(Math.abs(doc.roundOff))}
                </td>
              </tr>
            )}
            <tr className="qd-grand">
              <th>Grand total</th>
              <td className="qd-mono">{rupees(doc.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
        <p className="qd-words">
          <span>Amount in words:</span> {doc.amountInWords}
        </p>
        {!showTax && doc.docType !== 'BILL_OF_SUPPLY' && !s.gstin && (
          <p className="qd-note">GST not charged: supplier is not registered under GST.</p>
        )}
        {doc.compositionDeclaration && <p className="qd-note qd-decl">{doc.compositionDeclaration}</p>}
      </section>

      {/* ---------------------------------------------------- tax summary by HSN */}
      {showTax && doc.taxLines.length > 0 && (
        <section className="qd-block qd-avoid">
          <h3>Tax summary (HSN/SAC-wise)</h3>
          <table className="qd-table qd-table-tax">
            <thead>
              <tr>
                <th>HSN/SAC</th>
                <th className="qd-num">Taxable value</th>
                {doc.isInterState ? (
                  <th className="qd-num">IGST</th>
                ) : (
                  <>
                    <th className="qd-num">CGST</th>
                    <th className="qd-num">{sgstLabel}</th>
                  </>
                )}
                <th className="qd-num">Total tax</th>
              </tr>
            </thead>
            <tbody>
              {doc.taxLines.map((t) => (
                <tr key={`${t.hsnSac}-${t.ratePct}`}>
                  <td className="qd-mono">
                    {t.hsnSac} <small>@ {t.ratePct}%</small>
                  </td>
                  <td className="qd-num qd-mono">{amt(t.taxableValue)}</td>
                  {doc.isInterState ? (
                    <td className="qd-num qd-mono">{amt(t.igst)}</td>
                  ) : (
                    <>
                      <td className="qd-num qd-mono">{amt(t.cgst)}</td>
                      <td className="qd-num qd-mono">{amt(t.sgst)}</td>
                    </>
                  )}
                  <td className="qd-num qd-mono">{amt(t.cgst + t.sgst + t.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------------------------------------------- payment schedule */}
      {doc.paymentSchedule.length > 0 && (
        <section className="qd-block qd-avoid">
          <h3>Payment schedule</h3>
          <table className="qd-table qd-table-pay">
            <thead>
              <tr>
                <th className="qd-c-sl">#</th>
                <th>Milestone</th>
                <th className="qd-num">%</th>
                <th className="qd-num">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {doc.paymentSchedule.map((m, i) => (
                <tr key={m.id}>
                  <td className="qd-c-sl">{i + 1}</td>
                  <td>{m.label}</td>
                  <td className="qd-num qd-mono">{m.pct}%</td>
                  <td className="qd-num qd-mono">{amt(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------------------------------------------- make list */}
      {doc.makeList.length > 0 && (
        <section className="qd-block qd-avoid">
          <h3>Make list (approved brands)</h3>
          <table className="qd-table qd-table-make">
            <tbody>
              {doc.makeList.map((m) => (
                <tr key={m.category}>
                  <th>{m.category}</th>
                  <td>{m.brands.join(' / ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---------------------------------------------------- scope */}
      <section className="qd-block qd-scope">
        {doc.inclusions.length > 0 && (
          <div>
            <h3>Inclusions</h3>
            <ul>
              {doc.inclusions.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3>Exclusions</h3>
          {doc.exclusions.length > 0 ? (
            <ul>
              {doc.exclusions.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="qd-note">None listed.</p>
          )}
        </div>
      </section>

      {doc.terms.length > 0 && (
        <section className="qd-block">
          <h3>Terms and conditions</h3>
          <ol className="qd-terms">
            {doc.terms.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>
      )}

      {s.bank && (s.bank.accountNo || s.bank.upiId) && (
        <section className="qd-block qd-avoid qd-bank">
          <h3>Payment details</h3>
          <div className="qd-bank-grid">
            {s.bank.accountName && (
              <span>
                Account name <b>{s.bank.accountName}</b>
              </span>
            )}
            {s.bank.accountNo && (
              <span>
                A/c no. <b className="qd-mono">{s.bank.accountNo}</b>
              </span>
            )}
            {s.bank.ifsc && (
              <span>
                IFSC <b className="qd-mono">{s.bank.ifsc}</b>
              </span>
            )}
            {s.bank.upiId && (
              <span>
                UPI <b className="qd-mono">{s.bank.upiId}</b>
              </span>
            )}
          </div>
        </section>
      )}

      {children}

      {!hideSignatures && (
        <section className="qd-signs qd-avoid">
          <div>
            <div className="qd-sign-line" />
            <b>For {s.tradeName || s.legalName || 'the studio'}</b>
            <small>Authorised signatory</small>
          </div>
          <div>
            <div className="qd-sign-line" />
            <b>Accepted by {doc.recipient.legalName || 'the client'}</b>
            <small>Signature, name and date</small>
          </div>
        </section>
      )}

      <footer className="qd-foot">
        {doc.hash && (
          <span className="qd-hash" title="Document fingerprint (SHA-256)">
            Ref {doc.hash.slice(0, 12)}
          </span>
        )}
        <span>Rates are ex-GST unless stated. Quantities from the design drawing; final billing on measured quantities.</span>
        {doc.watermark && (
          <span className="qd-free-foot">
            Made with <b>3xDezine</b> — make yours free at 3xdezine
          </span>
        )}
      </footer>
    </article>
  );
}

function AddressLines({ a }: { a: QuotationDocument['siteAddress'] | undefined }) {
  if (!a) return null;
  const tail = [a.city, a.pin].filter(Boolean).join(' ');
  return (
    <div className="qd-address">
      {a.line1 && <div>{a.line1}</div>}
      {a.line2 && <div>{a.line2}</div>}
      {(tail || a.stateName) && <div>{[tail, a.stateName].filter(Boolean).join(', ')}</div>}
    </div>
  );
}

function LineRow({ line, anyDiscount, wide }: { line: QuoteLine; anyDiscount: boolean; wide: boolean }) {
  const hsn = hsnDigits(line.hsnSac, wide);
  if (line.kind === 'MODULAR') {
    const b = line.breakdown;
    return (
      <>
        <tr className={`qd-line ${line.optional ? 'qd-optional' : ''}`}>
          <td className="qd-c-sl qd-mono">{line.lineNo}</td>
          <td className="qd-c-desc">
            <div className="qd-desc">{line.description}</div>
            <div className="qd-spec">
              {b.byZone
                .filter((z) => z.amount > 0)
                .map((z) => `${z.zone.toLowerCase()} ${z.rft.toFixed(2)} rft / ${z.frontSqft.toFixed(2)} sq ft`)
                .join(' · ')}
              {b.hardware.hinges + b.hardware.channels + b.hardware.liftUps > 0 &&
                ` · hardware: ${b.hardware.hinges} hinges, ${b.hardware.channels} channels${b.hardware.liftUps ? `, ${b.hardware.liftUps} lift-ups` : ''}`}
              {b.countertop.sqft > 0 && ` · countertop ${b.countertop.sqft.toFixed(2)} sq ft`}
            </div>
            {line.optional && <div className="qd-tag">Optional — not in total</div>}
          </td>
          <td className="qd-c-hsn qd-mono">{hsn}</td>
          <td className="qd-c-unit">set</td>
          <td className="qd-num qd-c-qty qd-mono">1</td>
          <td className="qd-num qd-c-rate qd-mono">{amt(line.amount)}</td>
          {anyDiscount && <td className="qd-num qd-c-disc" />}
          <td className="qd-num qd-c-amt qd-mono">{line.optional ? <s>{amt(line.amount)}</s> : amt(line.amount)}</td>
        </tr>
      </>
    );
  }
  const spec = specText(line);
  return (
    <tr className={`qd-line ${line.optional ? 'qd-optional' : ''}`}>
      <td className="qd-c-sl qd-mono">{line.lineNo}</td>
      <td className="qd-c-desc">
        <div className="qd-desc">{line.description}</div>
        {spec && <div className="qd-spec">{spec}</div>}
        {line.clientSupplied && <div className="qd-tag">Labour only — material supplied by client</div>}
        {line.optional && <div className="qd-tag">Optional — not in total</div>}
      </td>
      <td className="qd-c-hsn qd-mono">{hsn}</td>
      <td className="qd-c-unit">{UNIT_LABEL[line.unit] ?? line.unit}</td>
      <td className="qd-num qd-c-qty qd-mono">{qty(line.quantityDisplay, line.unit)}</td>
      <td className="qd-num qd-c-rate qd-mono">{amt(printedRate(line))}</td>
      {anyDiscount && <td className="qd-num qd-c-disc qd-mono">{line.discountPct > 0 ? `${line.discountPct}%` : ''}</td>}
      <td className="qd-num qd-c-amt qd-mono">{line.optional ? <s>{amt(line.amount)}</s> : amt(line.amount)}</td>
    </tr>
  );
}
