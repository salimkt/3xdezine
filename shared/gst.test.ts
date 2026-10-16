import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Address, Party } from './business.ts';
import {
  GST_STATES, allowedDocTypes, chargesGst, compositionDeclaration, financialYear, gstinCheckChar, hsnDigits, placeOfSupply,
  splitTax, validateGstin,
} from './gst.ts';

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);

const addr = (stateCode: string, stateName = 'X'): Address => ({ line1: '1 Road', city: 'City', pin: '400001', stateName, stateCode });

describe('GST_STATES', () => {
  test('every code is unique, two digits, and the key states are right', () => {
    const codes = GST_STATES.map((s) => s.code);
    assert.equal(new Set(codes).size, codes.length, 'unique');
    for (const c of codes) check(/^\d{2}$/.test(c), `${c} is two digits`);
    const by = Object.fromEntries(GST_STATES.map((s) => [s.code, s]));
    assert.equal(by['27'].name, 'Maharashtra', '27');
    assert.equal(by['29'].name, 'Karnataka', '29');
    assert.equal(by['07'].name, 'Delhi', '07');
    assert.equal(by['36'].name, 'Telangana', '36');
    assert.equal(by['37'].name, 'Andhra Pradesh', '37');
    assert.equal(by['38'].name, 'Ladakh', '38');
    assert.equal(by['97'].name, 'Other Territory', '97');
    assert.equal(by['04'].taxLabel, 'UTGST', 'Chandigarh levies UTGST');
    assert.equal(by['07'].taxLabel, 'SGST', 'Delhi has a legislature: SGST');
    assert.equal(by['25'].active, false, 'Daman and Diu merged into 26');
    // 28 states + 8 UTs today, plus legacy 25/28, 97 and 99.
    assert.equal(GST_STATES.filter((s) => s.active && !s.ut && s.code !== '99').length, 28, '28 states');
    assert.equal(GST_STATES.filter((s) => s.active && s.ut && s.code !== '97').length, 8, '8 UTs');
  });
});

describe('GSTIN', () => {
  test('the GSTN example 27AAPFU0939F1ZV is valid (checksum worked by hand)', () => {
    // Weights 1,2,1,2… over 2 7 A A P F U 0 9 3 9 F 1 Z (values 2 7 10 10 25 15 30 0 9 3 9 15 1 35):
    // products 2 14 10 20 25 30 30 0 9 6 9 30 1 70; 70 → 1 + 34 = 35. Sum = 221; 221 mod 36 = 5;
    // (36 − 5) mod 36 = 31 → 'V'.
    assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V', 'check char');
    assert.deepEqual(validateGstin('27AAPFU0939F1ZV'), { valid: true, stateCode: '27', pan: 'AAPFU0939F' }, 'valid');
    assert.equal(validateGstin(' 27aapfu0939f1zv ').valid, true, 'trimmed and upper-cased');
  });

  test('computed GSTINs for other states validate, and every single-character change is caught', () => {
    const bases = ['29ABCDE1234F1Z', '07AAACR5055K1Z', '33AAACH2702H2Z', '24AAJCS0123M1Z', '36AABCT1332LAZ'];
    for (const b of bases) {
      const g = b + gstinCheckChar(b);
      const r = validateGstin(g);
      assert.equal(r.valid, true, `${g} valid`);
      assert.equal(r.stateCode, b.slice(0, 2), `${g} state`);
      assert.equal(r.pan, b.slice(2, 12), `${g} pan`);
      // Changing the check character always fails.
      for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (c === g[14]) continue;
        assert.equal(validateGstin(g.slice(0, 14) + c).valid, false, `${g.slice(0, 14)}${c} invalid`);
      }
    }
    // Known hand values from the function, pinned so a regression shows up.
    assert.equal(gstinCheckChar('29ABCDE1234F1Z'), 'W', '29ABCDE1234F1Z');
    assert.equal(gstinCheckChar('07AAACR5055K1Z'), '9', '07AAACR5055K1Z');
  });

  test('typos in the body are caught by the checksum', () => {
    assert.equal(validateGstin('27AAPFU0939F1ZV').valid, true, 'baseline');
    const r = validateGstin('27AAPFU0399F1ZV'); // adjacent digits 9 and 3 swapped
    assert.equal(r.valid, false, 'transposition');
    check(/Check character/.test(r.reason ?? ''), 'reason names the checksum');
    assert.equal(validateGstin('27AAPFV0939F1ZV').valid, false, 'one letter changed');
  });

  test('format errors have specific reasons', () => {
    const reason = (g: string) => validateGstin(g).reason ?? '';
    check(/15 characters/.test(reason('27AAPFU0939F1Z')), 'length');
    check(/letters and digits/.test(reason('27AAPFU0939F1Z-')), 'charset');
    check(/state code/.test(reason('00AAPFU0939F1ZV')), 'state 00');
    check(/state code/.test(reason('50AAPFU0939F1ZV')), 'state 50');
    check(/PAN/.test(reason('27AAP1U0939F1ZV')), 'PAN shape');
    check(/entity number/.test(reason('27AAPFU0939F0ZV')), 'entity 0');
    check(/'Z'/.test(reason('27AAPFU0939F1YV')), '14th char');
    assert.equal(validateGstin('').valid, false, 'empty');
  });
});

describe('place of supply', () => {
  const studio = (stateCode: string, gstin?: string): Party => ({ legalName: 'Studio', address: addr(stateCode), ...(gstin ? { gstin } : {}) });

  test('is the site state (IGST s.12(3)), not the client or the studio', () => {
    const p = placeOfSupply(studio('29'), addr('27', 'Maharashtra'));
    assert.equal(p.stateCode, '27', 'site state');
    assert.equal(p.stateName, 'Maharashtra', 'name from the table');
    assert.equal(p.isInterState, true, 'Bengaluru studio, Mumbai flat → IGST');
    assert.equal(placeOfSupply(studio('27'), addr('27')).isInterState, false, 'local job');
  });

  test('a valid GSTIN decides the supplier state', () => {
    const p = placeOfSupply(studio('29', '27AAPFU0939F1ZV'), addr('27'));
    assert.equal(p.supplierStateCode, '27', 'GSTIN state wins over the address');
    assert.equal(p.isInterState, false, 'intra-state');
  });

  test('unknown state codes throw', () => {
    assert.throws(() => placeOfSupply(studio('27'), addr('64')), /unknown GST state code/);
    assert.throws(() => placeOfSupply(studio('xx'), addr('27')), /unknown GST state code/);
  });
});

describe('splitTax', () => {
  test('CGST + SGST always sum to the total; CGST takes the odd paisa', () => {
    for (const taxable of [1, 3, 5, 11, 99, 12345, 98765, 1_23_45_678_91, 2_50_000_00]) {
      for (const rate of [0, 5, 12, 18, 28, 2.5]) {
        const t = splitTax(taxable, rate, false);
        assert.equal(t.cgst + t.sgst, t.total, `${taxable} @ ${rate}`);
        check(t.cgst - t.sgst === 0 || t.cgst - t.sgst === 1, `halves within a paisa (${taxable} @ ${rate})`);
        assert.equal(t.igst, 0, 'no IGST intra-state');
        assert.equal(splitTax(taxable, rate, true).igst, t.total, 'IGST equals the same total');
      }
    }
  });

  test('hand-checked values', () => {
    assert.deepEqual(splitTax(10_000_00, 18, false), { cgst: 90_000, sgst: 90_000, igst: 0, total: 1_80_000 }, '₹10,000 @ 18%');
    assert.deepEqual(splitTax(10_000_00, 18, true), { cgst: 0, sgst: 0, igst: 1_80_000, total: 1_80_000 }, 'IGST');
    // 18% of 12345 paise = 2222.1 → 2222; halves 1111 + 1111.
    assert.deepEqual(splitTax(12345, 18, false), { cgst: 1111, sgst: 1111, igst: 0, total: 2222 }, '12345');
    // 18% of 12347 = 2222.46 → 2222. 18% of 12350 = 2223 → 1112 + 1111.
    assert.deepEqual(splitTax(12350, 18, false), { cgst: 1112, sgst: 1111, igst: 0, total: 2223 }, 'odd total');
  });

  test('rejects fractional paise and negative rates', () => {
    assert.throws(() => splitTax(10.5, 18, false), /integer/);
    assert.throws(() => splitTax(100, -1, false), /rate/);
  });
});

describe('HSN digits', () => {
  test('4 digits up to ₹5 cr, 6 above (Notification 78/2020-CT)', () => {
    assert.equal(hsnDigits('998391', false), '9983', 'design SAC, small studio');
    assert.equal(hsnDigits('998391', true), '998391', 'design SAC, > ₹5 cr');
    assert.equal(hsnDigits('9954', true), '9954', 'shorter code unchanged');
    assert.equal(hsnDigits('94036000', true), '940360', '8-digit HSN truncated to 6');
    assert.equal(hsnDigits('9403 60 00', false), '9403', 'spaces ignored');
  });
});

describe('documents', () => {
  test('allowed doc types per registration', () => {
    assert.deepEqual(allowedDocTypes('UNREGISTERED'), ['QUOTATION', 'PLAIN_INVOICE'], 'unregistered');
    assert.deepEqual(allowedDocTypes('COMPOSITION'), ['QUOTATION', 'BILL_OF_SUPPLY', 'VARIATION_ORDER'], 'composition');
    assert.deepEqual(allowedDocTypes('REGULAR'), ['QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'VARIATION_ORDER'], 'regular');
  });

  test('only regular suppliers show GST', () => {
    assert.equal(chargesGst('REGULAR', 'QUOTATION'), true, 'regular quote');
    assert.equal(chargesGst('REGULAR', 'TAX_INVOICE'), true, 'tax invoice');
    assert.equal(chargesGst('COMPOSITION', 'BILL_OF_SUPPLY'), false, 'bill of supply');
    assert.equal(chargesGst('COMPOSITION', 'QUOTATION'), false, 'composition quote');
    assert.equal(chargesGst('UNREGISTERED', 'PLAIN_INVOICE'), false, 'plain invoice');
  });

  test('composition declaration is the Rule 5(1)(g) wording', () => {
    assert.equal(compositionDeclaration, 'composition taxable person, not eligible to collect tax on supplies', 'wording');
  });

  test('financial year runs April to March', () => {
    assert.equal(financialYear('2026-10-16'), '2026-27', 'October');
    assert.equal(financialYear('2026-04-01'), '2026-27', '1 April');
    assert.equal(financialYear('2026-03-31'), '2025-26', '31 March');
    assert.equal(financialYear('2027-01-05T10:00:00Z'), '2026-27', 'January, with time');
    assert.equal(financialYear('2099-12-01'), '2099-00', 'century wrap');
    assert.throws(() => financialYear('16/10/2026'), /ISO date/);
  });
});
