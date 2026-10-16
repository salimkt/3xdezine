import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { OpenQuoteResponse, QuotationDocument } from '@shared/business';
import type { Project } from '@shared/types';
import { CLOUD_ENABLED } from '../../cloud/state';
import { localPersistence, useStore } from '../../store';
import { PlanThumb } from '../../ui/PlanThumb';
import { formatINR } from '../engines';
import { BizError, openQuote, respondToQuote } from '../api';
import { useWorkspace } from '../workspace';
import { DOC_TITLE, QuoteDoc } from '../doc/QuoteDoc';
import './approval.css';
import { SiteFooter } from '../../site/SiteFooter';

/**
 * The client approval page, `#/q/<token>`. A homeowner opens it from
 * WhatsApp on a phone, signed out, often on mobile data: it fetches one quote
 * with a plain `fetch` (no SDK), draws the plan as SVG, and pulls three.js
 * only when they tap "View in 3D". The decision is pinned to the hash of the
 * exact document shown.
 */

const Viewport = lazy(() => import('../../three/Viewport').then((m) => ({ default: m.Viewport })));

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: OpenQuoteResponse };

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function ApprovalPage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [rev, setRev] = useState(0);

  useEffect(() => {
    document.documentElement.style.colorScheme = 'light';
    document.title = 'Your quotation — 3xDezine';
    return () => {
      document.documentElement.style.colorScheme = '';
    };
  }, []);

  useEffect(() => {
    if (!CLOUD_ENABLED) {
      setLoad({ state: 'error', message: 'This approval link needs the 3xDezine cloud, which isn’t set up on this site.' });
      return;
    }
    let live = true;
    setLoad({ state: 'loading' });
    openQuote(token)
      .then((data) => live && setLoad({ state: 'ready', data }))
      .catch((e) => live && setLoad({ state: 'error', message: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [token, rev]);

  if (load.state === 'loading') {
    return (
      <div className="ap ap-center" role="status">
        <div className="spinner" />
        <p>Opening your quotation…</p>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="ap ap-center">
        <h1>Link unavailable</h1>
        <p>{load.message}</p>
      </div>
    );
  }
  return <Loaded data={load.data} token={token} reload={() => setRev((r) => r + 1)} onQuote={(quote) => setLoad({ state: 'ready', data: { ...load.data, quote } })} />;
}

function Loaded({ data, token, reload, onQuote }: { data: OpenQuoteResponse; token: string; reload: () => void; onQuote: (q: QuotationDocument) => void }) {
  const q = data.quote;
  const catalog = useStore((s) => s.catalog);
  const [show3d, setShow3d] = useState(false);
  const last = q.approvals[q.approvals.length - 1];
  const lines = q.sections.reduce((n, s) => n + s.lines.length, 0);
  const branded = !q.watermark;
  const open = q.status === 'ISSUED';

  return (
    <div className="ap">
      <header className="ap-top">
        {branded && q.supplier.logoDataUrl ? <img src={q.supplier.logoDataUrl} alt="" className="ap-logo" /> : <span className="ap-mark">{(data.studioName[0] ?? '?').toUpperCase()}</span>}
        <div>
          <b>{data.studioName}</b>
          <small>
            {DOC_TITLE[q.docType]} {q.number}
          </small>
        </div>
      </header>

      <main className="ap-main">
        <StatusBanner q={q} />

        <section className="ap-card ap-summary" style={branded && q.supplier.brandColorHex ? { borderTopColor: q.supplier.brandColorHex } : undefined}>
          <p className="ap-for">Prepared for {q.recipient.legalName}</p>
          <div className="ap-total">
            <span>Grand total</span>
            <b>{formatINR(q.grandTotal, { paise: false })}</b>
            <small>{q.totalTax > 0 ? 'including GST' : 'no GST charged'}</small>
          </div>
          <p className="ap-words">{q.amountInWords}</p>
          <dl className="ap-facts">
            <div>
              <dt>Items</dt>
              <dd>{lines}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{fmtDate(q.issueDate)}</dd>
            </div>
            {q.validUntil && (
              <div>
                <dt>Valid until</dt>
                <dd>{fmtDate(q.validUntil)}</dd>
              </div>
            )}
            {q.areaBasis && (
              <div>
                <dt>Area</dt>
                <dd>{Math.round(q.areaBasis.sqft).toLocaleString('en-IN')} sq ft</dd>
              </div>
            )}
          </dl>
          {q.paymentSchedule.length > 0 && (
            <ul className="ap-sched">
              {q.paymentSchedule.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.pct}% · {m.label}
                  </span>
                  <b>{formatINR(m.amount, { paise: false })}</b>
                </li>
              ))}
            </ul>
          )}
          {open && (
            <a className="ap-btn ap-btn-primary" href="#respond">
              Approve or ask for changes
            </a>
          )}
        </section>

        <section className="ap-card ap-plan">
          <h2>The plan</h2>
          {show3d ? (
            <ThreeD project={data.project} quote={q} onClose={() => setShow3d(false)} />
          ) : (
            <>
              <PlanThumb project={data.project} catalog={catalog} className="ap-plan-svg" />
              <button className="ap-btn" onClick={() => setShow3d(true)}>
                View in 3D
              </button>
              <small className="ap-hint">Loads the 3D viewer (a few MB). Works best on Wi-Fi.</small>
            </>
          )}
        </section>

        <QuoteDoc doc={q} variant="screen" hideSignatures />

        {open ? (
          <RespondForm q={q} token={token} reload={reload} onQuote={onQuote} />
        ) : last ? (
          <section className="ap-card" id="respond">
            <h2>{last.decision === 'APPROVED' ? 'Approved' : 'Changes requested'}</h2>
            <p>
              By <b>{last.byName}</b> on {new Date(last.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.
              {last.comment && <> “{last.comment}”</>}
            </p>
            <p className="ap-hint">Document reference {last.documentHash.slice(0, 12)}</p>
          </section>
        ) : null}

        {q.watermark && (
          <a className="ap-free" href={`${location.origin}${import.meta.env.BASE_URL}`} target="_blank" rel="noopener">
            <span>
              Made with <b>3xDezine</b>
            </span>
            <small>Plan → 3D → GST quotation your client approves on WhatsApp. Make yours free →</small>
          </a>
        )}
        <SiteFooter compact newTab />
      </main>
    </div>
  );
}

function StatusBanner({ q }: { q: QuotationDocument }) {
  if (q.status === 'APPROVED') return <div className="ap-banner ap-banner-ok">This quotation is approved and locked. Any change now comes as a variation order.</div>;
  if (q.status === 'CHANGES_REQUESTED') return <div className="ap-banner ap-banner-warn">You asked for changes. Your designer will send a revised quotation.</div>;
  if (q.status === 'SUPERSEDED') return <div className="ap-banner ap-banner-warn">A newer version of this quotation has been sent. Please open the latest link from your designer.</div>;
  if (q.status === 'CANCELLED') return <div className="ap-banner ap-banner-warn">This quotation was withdrawn.</div>;
  return null;
}

function RespondForm({ q, token, reload, onQuote }: { q: QuotationDocument; token: string; reload: () => void; onQuote: (q: QuotationDocument) => void }) {
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUESTED'>('APPROVED');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [comment, setComment] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const approve = decision === 'APPROVED';
  const contactOk = /^\+?[0-9 ()-]{8,}$/.test(contact.trim()) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());
  const ok = name.trim().length > 1 && contactOk && agree && (approve || comment.trim().length > 0) && Boolean(q.hash);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || !q.hash) return;
    setBusy(true);
    setError(null);
    try {
      const r = await respondToQuote({ token, decision, byName: name.trim(), byContact: contact.trim(), ...(comment.trim() ? { comment: comment.trim() } : {}), documentHash: q.hash });
      onQuote(r.quote);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const be = err as BizError;
      setError({ message: be.message, stale: be.code === 'CONFLICT' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ap-card ap-form" id="respond" onSubmit={submit}>
      <h2>Your decision</h2>
      <div className="ap-seg" role="radiogroup" aria-label="Decision">
        <button type="button" role="radio" aria-checked={approve} className={approve ? 'on' : ''} onClick={() => setDecision('APPROVED')}>
          Approve
        </button>
        <button type="button" role="radio" aria-checked={!approve} className={!approve ? 'on' : ''} onClick={() => setDecision('CHANGES_REQUESTED')}>
          Request changes
        </button>
      </div>
      <label>
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required />
      </label>
      <label>
        <span>Phone or email</span>
        <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="tel" inputMode="email" maxLength={120} required />
      </label>
      <label>
        <span>{approve ? 'Comment (optional)' : 'What would you like changed?'}</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={approve ? 2 : 4} maxLength={2000} required={!approve} />
      </label>
      <label className="ap-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          {approve
            ? `I have read ${DOC_TITLE[q.docType].toLowerCase()} ${q.number} for ${formatINR(q.grandTotal, { paise: false })}, including the exclusions and terms, and I approve it.`
            : `I am asking for changes to ${DOC_TITLE[q.docType].toLowerCase()} ${q.number}. I understand it is not approved.`}
        </span>
      </label>
      {error && (
        <div className="ap-error" role="alert">
          {error.message}
          {error.stale && (
            <button type="button" className="ap-btn" onClick={reload}>
              Reload the quotation
            </button>
          )}
        </div>
      )}
      <button type="submit" className={`ap-btn ${approve ? 'ap-btn-primary' : 'ap-btn-warn'}`} disabled={!ok || busy}>
        {busy ? 'Sending…' : approve ? 'Approve quotation' : 'Send change request'}
      </button>
      <p className="ap-hint">
        Your name, contact, the time and a fingerprint of this exact document ({q.hash?.slice(0, 12)}) are recorded with your decision and shared with{' '}
        {q.supplier.tradeName || q.supplier.legalName}.
      </p>
    </form>
  );
}

class ThreeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="ap-hint">3D isn’t available on this device. The plan and the quotation above are complete.</p> : this.props.children;
  }
}

function ThreeD({ project, quote, onClose }: { project: Project; quote: QuotationDocument; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The viewport reads the editor store; point it at this quote's plan, and draw its kitchens and wardrobes.
    const items = quote.sections.flatMap((s) => s.lines.flatMap((l) => (l.kind === 'MODULAR' ? [l.item] : [])));
    useWorkspace.setState({ previewItems: items });
    localPersistence.paused = true;
    useStore.setState({ project, screen: 'studio', view: '3d', selection: { kind: null, id: null }, openedAt: useStore.getState().openedAt + 1 });
    setReady(true);
    return () => useWorkspace.setState({ previewItems: null });
  }, [project, quote]);
  return (
    <div className="ap-3d">
      <ThreeBoundary>
        {ready && (
          <Suspense fallback={<div className="ap-center"><div className="spinner" /><p>Loading 3D…</p></div>}>
            <Viewport />
          </Suspense>
        )}
      </ThreeBoundary>
      <button className="ap-btn ap-3d-close" onClick={onClose}>
        Back to plan
      </button>
    </div>
  );
}
