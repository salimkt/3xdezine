import { useState, type ReactNode } from 'react';
import type { PlanId } from '@shared/business';
import { BILLING_ENABLED } from '../../cloud/state';
import { PLAN_LABEL, useBiz } from '../../business/state';
import {
  COMPARE,
  COMPARE_PLANS,
  TIERS,
  entitlementsShown,
  planMailto,
  priceLine,
  rupees,
  yearlySaving,
  yearlyToggleLabel,
  type Cell,
  type Interval,
} from '../../business/pricing/tiers';
import { GST_REGISTERED, gstNote, gstSuffix } from '../../legal/business';

/**
 * `#/pricing` — works signed out and with no cloud at all. Paid CTAs go to the
 * in-app checkout only when billing is switched on; otherwise they are
 * mailto links, so the live site never shows a checkout that cannot work.
 */

/** Hand over to the studio's Plans dialog, which owns sign-in and Razorpay. */
function openCheckout(plan: PlanId, interval: Interval) {
  const reason = plan === 'PROJECT_PASS' ? 'A Project Pass unlocks one cloud project: open it from Your projects, then choose Project Pass.' : undefined;
  useBiz.setState({ dialog: 'pricing', pricing: { interval, ...(reason ? { reason } : {}) } });
  location.hash = '#/';
}

function Cta({ plan, interval }: { plan: PlanId; interval: Interval }) {
  const current = useBiz((s) => s.entitlements?.plan);
  if (plan === 'FREE') {
    return (
      <a className="btn btn-block site-cta" href="#/">
        Start free
      </a>
    );
  }
  if (plan === 'BUSINESS') {
    return (
      <a className="btn btn-block site-cta" href={planMailto(plan, interval)}>
        Talk to us
      </a>
    );
  }
  if (!BILLING_ENABLED) {
    return (
      <a className={`btn btn-block site-cta ${plan === 'SOLO' ? 'btn-primary' : ''}`} href={planMailto(plan, interval)}>
        Notify me
      </a>
    );
  }
  if (current === plan) {
    return (
      <button className="btn btn-block site-cta" disabled>
        Your plan
      </button>
    );
  }
  return (
    <button className={`btn btn-block site-cta ${plan === 'SOLO' ? 'btn-primary' : ''}`} onClick={() => openCheckout(plan, interval)}>
      {plan === 'PROJECT_PASS' ? 'Buy for a project' : `Choose ${PLAN_LABEL[plan]}`}
    </button>
  );
}

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <span className="site-yes" aria-label="Included">✓</span>;
  if (value === false) return <span className="site-no" aria-label="Not included">—</span>;
  return <>{value}</>;
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="site-faq">
      <summary>{q}</summary>
      <div>{children}</div>
    </details>
  );
}

export default function PricingPage() {
  const [interval, setInterval] = useState<Interval>('YEAR');
  const columns = COMPARE_PLANS.map((plan) => ({ plan, ent: entitlementsShown(plan) }));

  return (
    <div className="site-pricing">
      <header className="site-hero">
        <h1>Pricing in rupees, per studio</h1>
        <p>
          Design, render, estimate and check a plan for free. Pay when you quote clients under your own name — one
          project at a time, or every project with a subscription.
        </p>
        <div className="segmented site-toggle" role="radiogroup" aria-label="Billing interval">
          {(['MONTH', 'YEAR'] as const).map((iv) => (
            <button key={iv} role="radio" aria-checked={interval === iv} className={`seg ${interval === iv ? 'seg-on' : ''}`} onClick={() => setInterval(iv)}>
              {iv === 'MONTH' ? 'Monthly' : yearlyToggleLabel()}
            </button>
          ))}
        </div>
        <p className="site-gst">{gstNote()}</p>
      </header>

      {!BILLING_ENABLED && (
        <p className="site-notice" role="note">
          Paid plans open soon. Everything in Free works today, in your browser, with no account. “Notify me” emails us
          and we’ll write back the day payments open.
        </p>
      )}

      <div className="site-tiers">
        {TIERS.map((tier) => {
          const price = priceLine(tier.plan, interval);
          const saving = interval === 'YEAR' ? yearlySaving(tier.plan) : null;
          const paid = tier.plan !== 'FREE';
          return (
            <section key={tier.plan} className={`site-tier ${tier.plan === 'SOLO' ? 'site-tier-featured' : ''}`} aria-label={PLAN_LABEL[tier.plan]}>
              <header>
                <h2>{PLAN_LABEL[tier.plan]}</h2>
                {tier.plan === 'SOLO' && <span className="badge badge-accent">Most studios</span>}
              </header>
              <div className="site-price">
                <b className="mono">{price.amount}</b>
                <small>
                  {price.per}
                  {paid && ` · ${gstSuffix()}`}
                </small>
              </div>
              <p className="site-saving">
                {saving
                  ? `${rupees(saving.perMonth)}/month billed yearly — save ${rupees(saving.amount)} (${saving.pct}%)`
                  : tier.plan === 'PROJECT_PASS'
                    ? 'No subscription, no mandate'
                    : tier.plan === 'FREE'
                      ? 'No card, no trial clock'
                      : tier.plan === 'BUSINESS'
                        ? 'Priced to your catalogue'
                        : ' '}
              </p>
              <p className="site-tagline">{tier.tagline}</p>
              <ul>
                {tier.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Cta plan={tier.plan} interval={interval} />
            </section>
          );
        })}
      </div>

      <section className="site-section" aria-labelledby="compare">
        <h2 id="compare">Compare plans</h2>
        <p className="site-muted">Read from the same rules the server enforces. A Project Pass gives one project Solo’s features for 90 days.</p>
        <div className="site-table-wrap" tabIndex={0} role="region" aria-label="Plan comparison">
          <table className="site-table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {columns.map((c) => (
                  <th key={c.plan} scope="col">
                    {PLAN_LABEL[c.plan]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price ({interval === 'YEAR' ? 'yearly' : 'monthly'})</th>
                {columns.map((c) => {
                  const p = priceLine(c.plan, interval);
                  return (
                    <td key={c.plan} className="mono">
                      {p.amount}
                      {c.plan === 'BUSINESS' ? '+' : ''}
                    </td>
                  );
                })}
              </tr>
              {COMPARE.map((row) => (
                <tr key={row.label}>
                  <th scope="row">
                    {row.label}
                    {row.note && <small>{row.note}</small>}
                  </th>
                  {columns.map((c) => (
                    <td key={c.plan}>
                      <CellValue value={row.value(c.ent, c.plan)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="site-section" aria-labelledby="faq">
        <h2 id="faq">Questions</h2>
        <Faq q="What counts as an active project?">
          <p>
            A cloud project you own. Projects other people share with you don’t count, and neither does the plan you
            work on in this browser without an account. Delete a project you no longer need to free a slot. A Project
            Pass doesn’t add a slot — it upgrades one of your projects.
          </p>
        </Faq>
        <Faq q="What is the watermark?">
          <p>
            On Free, quotations, printouts and client approval links carry a small “Made with 3xDezine” mark that links
            here, and your studio logo and brand colour are left off. Solo, Studio, or a Project Pass for that project
            removes the mark and prints your letterhead instead. Estimates, 3D and plan checks are never watermarked.
          </p>
        </Faq>
        <Faq q="Can I cancel any time?">
          <p>
            Yes — from your account (Account → Plans), by emailing us, or by cancelling the mandate in your UPI app or
            bank. You keep paid features until the end of the period you’ve paid for, then move to Free with your
            projects intact. We don’t refund partial periods; see the <a href="#/refunds">Cancellation and Refund Policy</a>.
          </p>
        </Faq>
        <Faq q="How does UPI AutoPay work?">
          <p>
            You approve a mandate once in your UPI app (or a card e-mandate). Under RBI rules, recurring debits up to
            ₹15,000 need no extra authentication each time, and you get a pre-debit notice at least 24 hours before each
            charge with the amount and date — you can pause or cancel from that notice or your UPI app. Every monthly
            plan is below ₹15,000. Studio yearly is above it, so your bank will ask you to approve each yearly renewal
            with your UPI PIN or card OTP.
          </p>
        </Faq>
        <Faq q="Do you store my client’s data?">
          <p>
            Only what you put into a cloud project or quotation, and what your client types on the approval page (their
            name, contact and decision). For that data you decide what is collected and why — you are the data
            fiduciary and 3xDezine processes it on your behalf. Without an account nothing leaves your browser. Card and
            UPI details go to Razorpay and never touch our servers. Details in the <a href="#/privacy">Privacy Policy</a>.
          </p>
        </Faq>
        <Faq q="Do subscribers get a GST invoice?">
          {GST_REGISTERED ? (
            <p>
              Yes. Every payment comes with a GST tax invoice carrying our GSTIN. Add your studio’s GSTIN before you pay
              to claim input tax credit.
            </p>
          ) : (
            <p>
              Not yet. 3xDezine is not GST-registered yet, so no GST is charged and you receive a payment receipt. Once
              registered, subscribers get GST tax invoices with our GSTIN, and 18% GST is added to the prices above —
              we’ll give 30 days’ notice before that changes what you pay.
            </p>
          )}
        </Faq>
        <Faq q="Can I issue tax invoices to my own clients on Free?">
          <p>
            Free issues quotations. Proformas, tax invoices, bills of supply and variation orders come with Solo, Studio
            or a Project Pass — and which of them you can issue depends on your own GST registration, which the app
            checks.
          </p>
        </Faq>
        <Faq q="Do you take a cut of my projects?">
          <p>No. You pay for the software and nothing else. We never contact your clients or sell your leads.</p>
        </Faq>
        <Faq q="How is the service delivered?">
          <p>
            Online, instantly. Paid features switch on as soon as Razorpay confirms the payment — there is nothing to
            ship. See the <a href="#/delivery">Delivery Policy</a>.
          </p>
        </Faq>
      </section>

      <p className="site-muted site-legal-links">
        Buying a plan means agreeing to the <a href="#/terms">Terms</a>, <a href="#/privacy">Privacy Policy</a> and{' '}
        <a href="#/refunds">Cancellation and Refund Policy</a>. Questions? <a href="#/contact">Contact us</a>.
      </p>
    </div>
  );
}
