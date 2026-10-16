import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PRICES } from './business.ts';
import { ALL_DOC_TYPES, entitlementsFor, entitlementsForProject, issuableDocTypes, priceFor } from './plans.ts';

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);

describe('entitlements per plan (docs/strategy.md)', () => {
  test('FREE', () => {
    assert.deepEqual(entitlementsFor('FREE'), {
      plan: 'FREE', maxActiveProjects: 2, passProjectIds: [], brandedQuotes: false, docTypes: ['QUOTATION'], clientApprovals: true,
      rateCards: false, modular: false, variationOrders: false, seats: 1, historyDays: 7, currentPeriodEnd: null,
    }, 'free');
    assert.equal(entitlementsFor('FREE', { periodEnd: '2027-01-01' }).currentPeriodEnd, null, 'no period on free');
  });

  test('PROJECT_PASS is FREE plus pass projects, unlocked per project only', () => {
    const ent = entitlementsFor('PROJECT_PASS', { passProjectIds: ['p2', 'p1', 'p1'] });
    assert.equal(ent.plan, 'FREE', 'not a plan of its own');
    assert.deepEqual(ent.passProjectIds, ['p1', 'p2'], 'deduplicated, sorted');
    assert.equal(ent.brandedQuotes, false, 'account level stays free');
    const pass = entitlementsForProject(ent, 'p1');
    assert.equal(pass.brandedQuotes, true, 'branded in the pass project');
    assert.equal(pass.modular, true, 'modular');
    assert.equal(pass.rateCards, true, 'rate cards');
    assert.equal(pass.variationOrders, true, 'VOs');
    assert.deepEqual(pass.docTypes, ALL_DOC_TYPES, 'all doc types');
    assert.equal(pass.historyDays, 90, '90-day history');
    assert.equal(pass.maxActiveProjects, 2, 'still two active projects');
    assert.equal(pass.seats, 1, 'one seat');
    assert.deepEqual(entitlementsForProject(ent, 'p3'), ent, 'other projects stay free');
    assert.deepEqual(entitlementsFor('FREE', { passProjectIds: ['p1', 'p2'] }), ent, 'FREE with pass ids is the same thing');
  });

  test('SOLO', () => {
    const e = entitlementsFor('SOLO', { periodEnd: '2026-11-16T00:00:00Z' });
    assert.equal(e.plan, 'SOLO', 'plan');
    assert.equal(e.maxActiveProjects, null, 'unlimited');
    assert.equal(e.brandedQuotes, true, 'branded');
    assert.deepEqual(e.docTypes, ALL_DOC_TYPES, 'doc types (filtered by registration at issue)');
    check(e.rateCards && e.modular && e.variationOrders && e.clientApprovals, 'features');
    assert.equal(e.seats, 1, 'one seat');
    assert.equal(e.historyDays, 90, '90 days');
    assert.equal(e.currentPeriodEnd, '2026-11-16T00:00:00Z', 'period end');
    assert.deepEqual(entitlementsForProject(e, 'any'), e, 'no per-project change on paid plans');
  });

  test('STUDIO and BUSINESS', () => {
    const s = entitlementsFor('STUDIO');
    assert.equal(s.seats, 3, 'three seats included');
    assert.equal(s.historyDays, null, 'unlimited history');
    assert.equal(s.maxActiveProjects, null, 'unlimited projects');
    assert.equal(entitlementsFor('STUDIO', { seats: 5 }).seats, 5, 'bought seats (total)');
    assert.equal(entitlementsFor('STUDIO', { seats: 1 }).seats, 3, 'never below three');
    const b = entitlementsFor('BUSINESS', { seats: 10 });
    assert.equal(b.plan, 'BUSINESS', 'plan');
    assert.deepEqual({ ...b, plan: 'STUDIO' }, entitlementsFor('STUDIO', { seats: 10 }), 'business is like studio');
  });

  test('every plan allows client approvals', () => {
    for (const p of ['FREE', 'PROJECT_PASS', 'SOLO', 'STUDIO', 'BUSINESS'] as const) {
      assert.equal(entitlementsFor(p).clientApprovals, true, p);
    }
  });

  test('issuable doc types = plan ∩ GST registration', () => {
    assert.deepEqual(issuableDocTypes(entitlementsFor('FREE'), 'REGULAR'), ['QUOTATION'], 'free');
    assert.deepEqual(issuableDocTypes(entitlementsFor('SOLO'), 'REGULAR'), ['QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'VARIATION_ORDER'], 'solo regular');
    assert.deepEqual(issuableDocTypes(entitlementsFor('SOLO'), 'COMPOSITION'), ['QUOTATION', 'BILL_OF_SUPPLY', 'VARIATION_ORDER'], 'solo composition');
    assert.deepEqual(issuableDocTypes(entitlementsFor('SOLO'), 'UNREGISTERED'), ['QUOTATION', 'PLAIN_INVOICE'], 'solo unregistered');
  });
});

describe('prices', () => {
  test('from PRICES', () => {
    assert.equal(priceFor('SOLO', 'MONTH')?.amount, 79_900, '₹799');
    assert.equal(priceFor('SOLO', 'YEAR')?.amount, 7_99_900, '₹7,999');
    assert.equal(priceFor('STUDIO', 'MONTH')?.amount, 2_49_900, '₹2,499');
    assert.equal(priceFor('STUDIO', 'YEAR')?.amount, 24_99_900, '₹24,999');
    assert.equal(priceFor('PROJECT_PASS', 'ONE_TIME')?.amount, 49_900, '₹499');
    assert.equal(priceFor('FREE', 'MONTH'), undefined, 'free is not sold');
    assert.equal(priceFor('SOLO', 'ONE_TIME'), undefined, 'no one-time solo');
    for (const p of PRICES.filter((x) => x.interval === 'MONTH')) check(p.amount < 15_000_00, `${p.label}: monthly under ₹15,000 (UPI AutoPay without AFA)`);
  });
});
