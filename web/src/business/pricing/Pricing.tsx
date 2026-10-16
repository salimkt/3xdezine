import { useState } from 'react';
import type { CreateCheckoutResponse, PlanId, PlanPrice } from '@shared/business';
import { formatINR } from '../engines';
import { BILLING_ENABLED, useCloud } from '../../cloud/state';
import { Dialog, ErrorLine, useAction } from '../../cloud/ui/common';
import { cancelSubscription, createCheckout, isSignedIn, refreshEntitlements } from '../api';
import { PLAN_LABEL, useBiz } from '../state';
import { closeBizDialog } from '../BizDialogs';
import { confirmSimulated, openRazorpay } from './checkout';
import { RANK, TIERS, planMailto, priceLine, yearlyToggleLabel, type Interval } from './tiers';
import { gstNote } from '../../legal/business';
import { siteUrl } from '../../site/routes';

export default function Pricing() {
  const ents = useBiz((s) => s.entitlements);
  const intent = useBiz((s) => s.pricing);
  const status = useCloud((s) => s.status);
  const activeId = useCloud((s) => s.active?.id);
  const current: PlanId = ents?.plan ?? 'FREE';
  const projectId = intent.projectId ?? activeId;
  const hasPass = Boolean(projectId && ents?.passProjectIds.includes(projectId));
  const [interval, setInterval] = useState<Interval>(intent.interval ?? 'YEAR');
  const [simulated, setSimulated] = useState<{ checkout: CreateCheckoutResponse; plan: PlanId; interval: PlanPrice['interval'] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { busy, error, setError, run } = useAction();

  const buy = (plan: PlanId) =>
    void run(async () => {
      setDone(null);
      if (!isSignedIn()) {
        useBiz.setState({ dialog: null });
        useCloud.setState({ dialog: 'signin' });
        return;
      }
      const iv: PlanPrice['interval'] = plan === 'PROJECT_PASS' ? 'ONE_TIME' : interval;
      if (plan === 'PROJECT_PASS' && !projectId) {
        setError('Open the cloud project you want to unlock, then buy its Project Pass from there.');
        return;
      }
      const checkout = await createCheckout({ plan, interval: iv, ...(plan === 'PROJECT_PASS' ? { projectId } : {}) });
      if (checkout.simulated) {
        setSimulated({ checkout, plan, interval: iv });
        return;
      }
      const paid = await openRazorpay(checkout, PLAN_LABEL[plan]);
      if (!paid) return;
      // The webhook grants the plan; give it a moment, then re-read.
      for (let i = 0; i < 6; i++) {
        const next = await refreshEntitlements();
        if (next && (plan === 'PROJECT_PASS' ? next.passProjectIds.includes(projectId ?? '') : next.plan === plan)) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      setDone(`${PLAN_LABEL[plan]} is active. Thank you!`);
    });

  const confirm = () =>
    void run(async () => {
      if (!simulated) return;
      await confirmSimulated(simulated.checkout);
      await refreshEntitlements();
      setSimulated(null);
      setDone(`${PLAN_LABEL[simulated.plan]} is active (simulated).`);
    });

  return (
    <Dialog title="Plans" onClose={closeBizDialog} width={1060}>
      <div className="biz-pricing">
        {intent.reason && <p className="biz-pricing-reason">{intent.reason}</p>}
        <div className="biz-pricing-head">
          <div className="segmented" role="radiogroup" aria-label="Billing interval">
            {(['MONTH', 'YEAR'] as const).map((iv) => (
              <button key={iv} role="radio" aria-checked={interval === iv} className={`seg ${interval === iv ? 'seg-on' : ''}`} onClick={() => setInterval(iv)}>
                {iv === 'MONTH' ? 'Monthly' : yearlyToggleLabel()}
              </button>
            ))}
          </div>
          <span className="hint">
            {gstNote()}{' '}
            <a href={siteUrl('pricing')} target="_blank" rel="noopener">
              Compare every plan and read the FAQ ↗
            </a>
          </span>
        </div>

        {simulated && (
          <div className="biz-simulated" role="alertdialog" aria-label="Simulated payment">
            <span className="badge badge-warn">Simulated payment (dev)</span>
            <p>
              No Razorpay keys are configured on this server, so checkout is simulated. Confirming grants{' '}
              <b>{PLAN_LABEL[simulated.plan]}</b> for {formatINR(simulated.checkout.amount)} without charging anything.
            </p>
            <div className="cloud-actions">
              <button className="btn" onClick={() => setSimulated(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirm} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm simulated payment'}
              </button>
            </div>
          </div>
        )}
        {done && <p className="biz-done" role="status">{done}</p>}
        <ErrorLine text={error} />

        <div className="biz-tiers">
          {TIERS.map((tier) => {
            const price = priceLine(tier.plan, interval);
            const isCurrent = tier.plan === current || (tier.plan === 'PROJECT_PASS' && hasPass);
            const lower = tier.plan !== 'PROJECT_PASS' && RANK[tier.plan] < RANK[current];
            return (
              <section key={tier.plan} className={`biz-tier ${tier.plan === 'SOLO' ? 'biz-tier-featured' : ''} ${isCurrent ? 'biz-tier-current' : ''}`}>
                <header>
                  <h3>{PLAN_LABEL[tier.plan]}</h3>
                  {isCurrent && <span className="badge badge-ok">Current</span>}
                  {tier.plan === 'SOLO' && !isCurrent && <span className="badge badge-accent">Most studios</span>}
                </header>
                <div className="biz-tier-price">
                  <b className="mono">{price.amount}</b>
                  <small>{price.per}</small>
                </div>
                <p className="biz-tier-tagline">{tier.tagline}</p>
                <ul>
                  {tier.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="biz-tier-cta">
                  {tier.plan === 'FREE' ? (
                    <span className="hint">{current === 'FREE' ? 'You’re on Free.' : 'Included.'}</span>
                  ) : tier.contact ? (
                    <a className="btn btn-block" href={planMailto(tier.plan, interval)}>
                      Talk to us
                    </a>
                  ) : !BILLING_ENABLED ? (
                    <a className="btn btn-block" href={planMailto(tier.plan, interval)} title="Payments aren’t open yet — we’ll email you when they are">
                      Notify me
                    </a>
                  ) : isCurrent || lower ? (
                    <button className="btn btn-block" disabled>
                      {isCurrent ? 'Active' : 'Included'}
                    </button>
                  ) : (
                    <button className={`btn btn-block ${tier.plan === 'SOLO' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => buy(tier.plan)}>
                      {status !== 'signedIn'
                        ? 'Sign in to upgrade'
                        : tier.plan === 'PROJECT_PASS'
                          ? projectId
                            ? 'Unlock this project'
                            : 'Open a cloud project'
                          : `Upgrade to ${PLAN_LABEL[tier.plan]}`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {ents?.currentPeriodEnd && (() => {
          const until = new Date(ents.currentPeriodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' });
          if (ents.renews === false) {
            return (
              <p className="hint">
                {PLAN_LABEL[current]} is cancelled and ends on {until}. You won’t be charged again, and you keep every
                paid feature until then.
              </p>
            );
          }
          // Only the subscriber gets `renews`; a studio seat holder sees the date alone.
          if (ents.renews !== true) return <p className="hint">{PLAN_LABEL[current]} runs until {until}.</p>;
          return (
            <div className="plan-renewal">
              <p className="hint">
                {PLAN_LABEL[current]} renews on {until}.{' '}
                {!confirmCancel && (
                  <button type="button" className="plan-cancel-link" disabled={busy} onClick={() => setConfirmCancel(true)}>
                    Cancel subscription
                  </button>
                )}
              </p>
              {confirmCancel && (
                <div className="plan-cancel-confirm" role="group" aria-label="Confirm cancellation">
                  <p>
                    Cancel renewal? You keep {PLAN_LABEL[current]} until <strong>{until}</strong> and won’t be charged
                    again. Partial periods aren’t refunded — see the{' '}
                    <a href={siteUrl('refunds')} target="_blank" rel="noopener">refund policy</a>.
                  </p>
                  <div className="plan-cancel-actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => setConfirmCancel(false)}>
                      Keep my plan
                    </button>
                    <button
                      type="button"
                      className="btn plan-cancel-danger"
                      disabled={busy}
                      onClick={async () => {
                        const res = await run(() => cancelSubscription());
                        if (res) {
                          setConfirmCancel(false);
                          setDone(`Cancelled. ${PLAN_LABEL[current]} stays active until ${until}.`);
                        }
                      }}
                    >
                      {busy ? 'Cancelling…' : 'Cancel renewal'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {!BILLING_ENABLED && (
          <p className="hint">
            Payments aren’t open yet, so everything is on the Free plan: quotes work in this browser and print with the
            “Made with 3xDezine” mark. “Notify me” emails us — we’ll write back when paid plans open.
          </p>
        )}
      </div>
    </Dialog>
  );
}
