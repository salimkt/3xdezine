import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  amountInWords, divRoundBig, formatINR, fromRft, fromSqft, numberInWordsIndian, paise, pctOf, roundHalfAway, rupees, toRft, toSqft,
} from './money.ts';

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);

describe('rounding', () => {
  test('half away from zero, without binary noise', () => {
    assert.equal(roundHalfAway(0.5), 1, '0.5');
    assert.equal(roundHalfAway(-0.5), -1, '-0.5');
    assert.equal(roundHalfAway(1.005, 2), 1.01, '1.005 → 1.01 (naive Math.round gives 1.00)');
    assert.equal(roundHalfAway(2.675, 2), 2.68, '2.675');
    assert.equal(roundHalfAway(-2.675, 2), -2.68, '-2.675');
    assert.equal(roundHalfAway(1.4999), 1, '1.4999');
    assert.equal(Object.is(roundHalfAway(-0.4), -0), false, 'no negative zero');
  });

  test('BigInt division rounds half away from zero', () => {
    assert.equal(divRoundBig(5n, 2n), 3n, '5/2');
    assert.equal(divRoundBig(-5n, 2n), -3n, '-5/2');
    assert.equal(divRoundBig(4n, 3n), 1n, '4/3');
    assert.equal(divRoundBig(5n, -3n), -2n, '5/-3');
  });

  test('pctOf is exact for large amounts', () => {
    assert.equal(pctOf(1_00_00_00_000_00, 18), 18_00_00_000_00, '18% of ₹1,000 cr');
    assert.equal(pctOf(1001, 50), 501, '50% of 1001 paise rounds up');
    assert.equal(pctOf(333, 12.5), 42, '12.5% of 333 = 41.625');
  });
});

describe('rupees ⇄ paise', () => {
  test('converts and rounds once', () => {
    assert.equal(paise(12.34), 1234, '12.34');
    assert.equal(paise(0.1 + 0.2), 30, 'float noise');
    assert.equal(paise(10.005), 1001, 'half away');
    assert.equal(paise(-10.005), -1001, 'negative half away');
    assert.equal(rupees(123456750), 1234567.5, 'rupees');
  });

  test('summing paise never drifts', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += paise(0.1);
    assert.equal(total, 10000, '1000 × ₹0.10 = ₹100.00 exactly');
  });
});

describe('formatINR', () => {
  test('Indian digit grouping', () => {
    assert.equal(formatINR(123456750), '₹12,34,567.50', 'lakhs');
    assert.equal(formatINR(1_00_00_000_00), '₹1,00,00,000.00', 'one crore');
    assert.equal(formatINR(12_34_56_78_901_23), '₹12,34,56,78,901.23', 'beyond crores, groups of two continue');
    assert.equal(formatINR(99900), '₹999.00', 'hundreds');
    assert.equal(formatINR(100000), '₹1,000.00', 'thousand');
    assert.equal(formatINR(0), '₹0.00', 'zero');
    assert.equal(formatINR(1), '₹0.01', 'one paisa');
    assert.equal(formatINR(-123456), '-₹1,234.56', 'negative');
  });

  test('options drop paise (rounded) and the symbol', () => {
    assert.equal(formatINR(123456750, { paise: false }), '₹12,34,568', 'rounded to the rupee');
    assert.equal(formatINR(123456749, { paise: false }), '₹12,34,567', 'rounded down');
    assert.equal(formatINR(123456750, { symbol: false }), '12,34,567.50', 'no symbol');
  });

  test('rejects non-integer paise', () => {
    assert.throws(() => formatINR(1.5), /integer/);
  });
});

describe('amountInWords', () => {
  test('the contract example', () => {
    assert.equal(amountInWords(123456750), 'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paise Only', 'example');
  });

  test('zero, one paisa, exact lakhs and crores', () => {
    assert.equal(amountInWords(0), 'Rupees Zero Only', 'zero');
    assert.equal(amountInWords(1), 'Rupees Zero and One Paise Only', '1 paise');
    assert.equal(amountInWords(1_00_000_00), 'Rupees One Lakh Only', 'one lakh');
    assert.equal(amountInWords(25_00_000_00), 'Rupees Twenty-Five Lakh Only', 'exact lakhs');
    assert.equal(amountInWords(1_00_00_000_00), 'Rupees One Crore Only', '1,00,00,000 = One Crore');
    assert.equal(amountInWords(99_99_999_99), 'Rupees Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only', '99,99,999.99');
    assert.equal(amountInWords(2_05_00_010_00), 'Rupees Two Crore Five Lakh Ten Only', 'gaps');
    assert.equal(amountInWords(1_000_00), 'Rupees One Thousand Only', 'thousand');
    assert.equal(amountInWords(11_900), 'Rupees One Hundred Nineteen Only', 'teens');
  });

  test('crores recurse in the Indian system', () => {
    assert.equal(numberInWordsIndian(1_50_000_00_00_000), 'One Lakh Fifty Thousand Crore', '1.5 lakh crore');
    assert.equal(numberInWordsIndian(123_45_67_890), 'One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety', 'hundreds of crores');
  });

  test('negative amounts', () => {
    assert.equal(amountInWords(-5000), 'Minus Rupees Fifty Only', 'negative');
  });
});

describe('trade units', () => {
  test('uses the stated factors and round-trips', () => {
    assert.equal(toSqft(1), 10.7639, 'sq ft');
    assert.equal(toRft(1), 3.28084, 'rft');
    check(Math.abs(fromSqft(toSqft(12.34)) - 12.34) < 1e-12, 'sq ft round trip');
    check(Math.abs(fromRft(toRft(3.048)) - 3.048) < 1e-12, 'rft round trip');
    assert.equal(roundHalfAway(toRft(3.048), 2), 10, '3048 mm = 10.00 ft');
  });
});
