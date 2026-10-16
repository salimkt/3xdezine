import { useState } from 'react';
import { PRICES, type CreateCheckoutResponse, type PlanId, type PlanPrice } from '@shared/business';
import { formatINR } from '../engines';
import { CLOUD_ENABLED, useCloud } from '../../cloud/state';
import { Dialog, ErrorLine, useAction } from '../../cloud/ui/common';
import { createCheckout, isSignedIn, refreshEntitlements } from '../api';
import { PLAN_LABEL, useBiz } from '../state';
import { closeBizDialog } from '../BizDialogs';
import { confirmSimulated, openRazorpay } from './checkout';

type Interval = 'MONTH' | 'YEAR';

interface Tier {
  plan: PlanId;
  tagline: string;
  features: string[];
  /** Sales-led tiers have no checkout. */
  contact?: boolean;
}

/** From docs/strategy.md — the gates are enforced server-side; this is the menu. */
const TIERS: Tier[] = [
  {
    plan: 'FREE',
    tagline: 'Plan, 3D, estimate and NBC checks — the whole design tool.',
    features: [
      '2 active projects',
      'Quotations with client approval links',
      '“Made with 3xDezine” on every share',
      'Default rate card, editable per line',
      '7-day history',
    ],
  },
  {
    plan: 'PROJECT_PASS',
    tagline: 'One client, done properly — no subscription.',
    features: [
      'This project’s quotes unbranded, with your studio details',
      'Client approval link',
      'Valid 90 days',
    ],
  },
  {
    plan: 'SOLO',
    tagline: 'For the independent designer quoting every week.',
    features: [
      'Unlimited projects',
      'Branded GST quotes and tax invoices',
      'Your own rate cards',
      'Modular kitchen & wardrobe configurator',
      'Variation orders after approval',
      '90-day history',
    ],
  },
  {
    plan: 'STUDIO',
    tagline: 'A small team sharing one studio.',
    features: [
      'Everything in Solo',
      '3 seats with roles (+₹599/seat)',
      'Shared rate cards and branding',
      'Unlimited history',
    ],
  },
  {
    plan: 'BUSINESS',
    tagline: 'White-label catalogue for dealers, brands and kitchen makers.',
    features: ['From ₹14,999/month', 'Your catalogue and rate packs', 'Sales-led onboarding'],
    contact: true,
  },
];

const RANK: Record<PlanId, number> = { FREE: 0, PROJECT_PASS: 1, SOLO: 2, STUDIO: 3, BUSINESS: 4 };

function priceFor(plan: PlanId, interval: Interval): PlanPrice | undefined {
  if (plan === 'PROJECT_PASS') return PRICES.find((p) => p.plan === plan);
  return PRICES.find((p) => p.plan === plan && p.interval === interval);
}

function priceLine(plan: PlanId, interval: Interval) {
  if (plan === 'FREE') return { amount: '₹0', per: 'forever' };
  if (plan === 'BUSINESS') return { amount: '₹14,999', per: 'from, per month' };
  const p = priceFor(plan, interval);
  if (!p) return { amount: '—', per: '' };
  const per = p.interval === 'ONE_TIME' ? 'per project, one-off' : p.interval === 'YEAR' ? 'per year' : 'per month';
  return { amount: formatINR(p.amount, { paise: false }), per };
}

export default function Pricing() {
  const ents = useBiz((s) => s.entitlements);
  const intent = useBiz((s) => s.pricing);
  const status = useCloud((s) => s.status);
  const activeId = useCloud((s) => s.active?.id);
  const current: PlanId = ents?.plan ?? 'FREE';
  const projectId = intent.projectId ?? activeId;
  const hasPass = Boolean(projectId && ents?.passProjectIds.includes(projectId));
  const [interval, setInterval] = useState<Interval>('YEAR');
  const [simulated, setSimulated] = useState<{ checkout: CreateCheckoutResponse; plan: PlanId; interval: PlanPrice['interval'] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
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
                {iv === 'MONTH' ? 'Monthly' : 'Yearly · 2 months free'}
              </button>
            ))}
          </div>
          <span className="hint">Prices exclude GST. GST at 18% is added at checkout once 3xDezine is registered.</span>
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
                    <a className="btn btn-block" href="mailto:hello@3xdezine.app?subject=3xDezine%20Business">
                      Talk to us
                    </a>
                  ) : !CLOUD_ENABLED ? (
                    <button className="btn btn-block" disabled title="Checkout needs the cloud version with an account">
                      Needs an account
                    </button>
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
        {ents?.currentPeriodEnd && (
          <p className="hint">
            {PLAN_LABEL[current]} renews or ends on{' '}
            {new Date(ents.currentPeriodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.
          </p>
        )}
        {!CLOUD_ENABLED && (
          <p className="hint">
            This demo runs without an account, so everything is on the Free plan: quotes work in this browser and print
            with the “Made with 3xDezine” mark.
          </p>
        )}
      </div>
    </Dialog>
  );
}
