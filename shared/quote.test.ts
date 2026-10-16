import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Address, QuotationDocument, QuoteDraftInput, QuoteLine, RateCard, StudioProfile } from './business.ts';
import { defaultModularItem, modularQuoteLine } from './modular.ts';
import { amountInWords } from './money.ts';
import {
  HASH_EXCLUDED_FIELDS, TRADE_ORDER, allocate, buildQuote, canonicalJson, diffQuotes, hashQuote, nextQuoteNumber, toQuoteLines,
} from './quote.ts';
import { autoLines } from './trades.ts';
import type { PlanTemplateMeta, Project } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const load = <T>(p: string) => JSON.parse(readFileSync(join(here, p), 'utf8')) as T;
const sample = load<Project>('sample-project.json');
const card = load<RateCard>('ratecards/metro-mid-2026.json');
const index = load<PlanTemplateMeta[]>('templates/index.json');

const check: (value: unknown, message: string) => asserts value = (value, message) => assert.ok(value, message);

const pune: Address = { line1: '12 FC Road', city: 'Pune', pin: '411004', stateName: 'Maharashtra', stateCode: '27' };
const blr: Address = { line1: '5 Indiranagar', city: 'Bengaluru', pin: '560038', stateName: 'Karnataka', stateCode: '29' };

const studio = (over: Partial<StudioProfile> = {}): StudioProfile => ({
  id: 'studio-1',
  legalName: 'Sample Studio LLP',
  address: pune,
  gstin: '27AAPFU0939F1ZV',
  gstRegistration: 'REGULAR',
  turnoverAbove5Cr: false,
  defaultTerms: [],
  defaultMilestones: [],
  numberPrefix: 'SS',
  ...over,
});

const MILESTONES: QuoteDraftInput['milestones'] = [
  { label: 'Booking', pct: 10, trigger: 'ON_SIGNING' },
  { label: 'Design sign-off', pct: 50, trigger: 'ON_APPROVAL' },
  { label: 'Before dispatch', pct: 35, trigger: 'ON_DELIVERY' },
  { label: 'Handover', pct: 5, trigger: 'ON_HANDOVER' },
];

const input = (over: Partial<QuoteDraftInput> = {}): QuoteDraftInput => ({
  project: sample,
  rateCard: card,
  studio: studio(),
  recipient: { legalName: 'A. Client', address: pune },
  siteAddress: pune,
  lines: [],
  view: 'ROOM_WISE',
  milestones: MILESTONES,
  makeList: [{ category: 'Paint', brands: ['Asian Paints Royale'] }],
  inclusions: ['Putty, primer and two finish coats'],
  exclusions: ['Light fixtures', 'Civil changes'],
  terms: ['Valid 15 days'],
  docType: 'QUOTATION',
  issueDate: '2026-10-16',
  validityDays: 15,
  watermark: false,
  ...over,
});

/** Four lines with hand-computed amounts (see the test below). */
const controlledLines = (): QuoteLine[] => [
  {
    kind: 'TRADE', id: 'paint', lineNo: '', roomId: 'room-living', trade: 'PAINTING', description: 'Wall paint', unit: 'SQFT',
    rule: { kind: 'WALL_AREA', deductOpenings: true }, quantityBase: 0, quantityDisplay: 0, materialRate: 15_00, labourRate: 11_00,
    markupPct: 0, discountPct: 0, amount: 0, hsnSac: '995473', gstRatePct: 18, supplyNature: 'WORKS_CONTRACT', clientSupplied: false, optional: false,
  },
  {
    kind: 'TRADE', id: 'protect', lineNo: '', trade: 'MISC', description: 'Site protection', unit: 'LS', rule: { kind: 'FIXED', quantity: 1 },
    quantityBase: 0, quantityDisplay: 0, materialRate: 5_000_00, labourRate: 0, markupPct: 0, discountPct: 0, amount: 0,
    hsnSac: '9954', gstRatePct: 18, supplyNature: 'WORKS_CONTRACT', clientSupplied: false, optional: false,
  },
  {
    kind: 'TRADE', id: 'sofa', lineNo: '', roomId: 'room-living', trade: 'LOOSE_FURNITURE', description: 'Sofa', unit: 'NOS', rule: { kind: 'MANUAL' },
    quantityBase: 1, quantityDisplay: 1, materialRate: 55_000_00, labourRate: 0, markupPct: 0, discountPct: 0, amount: 0,
    hsnSac: '9403', gstRatePct: 18, supplyNature: 'GOODS', clientSupplied: false, optional: false,
  },
  {
    kind: 'TRADE', id: 'wallpaper', lineNo: '', roomId: 'room-bedroom', trade: 'DECOR', description: 'Wallpaper (optional)', unit: 'SQFT', rule: { kind: 'MANUAL' },
    quantityBase: 0, quantityDisplay: 100, materialRate: 90_00, labourRate: 30_00, markupPct: 0, discountPct: 0, amount: 0,
    hsnSac: '9954', gstRatePct: 18, supplyNature: 'WORKS_CONTRACT', clientSupplied: false, optional: true,
  },
];

const controlled = (over: Partial<QuoteDraftInput> = {}) =>
  buildQuote(input({ lines: controlledLines(), designFee: { basis: 'PCT_OF_PROJECT', value: 10 }, discount: { label: 'Festive', amount: 10_000_00 }, ...over }));

const fullLines = (): QuoteLine[] => {
  const f = sample.floors[0];
  const k = f.rooms.find((r) => r.id === 'room-kitchen')!;
  const item = defaultModularItem(k, f.walls.find((w) => w.id === 'ext-n')!, 'KITCHEN', { floor: f });
  return [...toQuoteLines(autoLines(sample, card)), modularQuoteLine(item, sample)];
};

/** The reconciliation every document must satisfy. */
function reconciles(doc: QuotationDocument, label: string) {
  const sum = doc.sections.reduce((s, x) => s + x.subtotal, 0);
  for (const s of doc.sections) {
    assert.equal(s.subtotal, s.lines.reduce((t, l) => t + (l.optional ? 0 : l.amount), 0), `${label}: ${s.title} subtotal`);
  }
  assert.equal(sum + (doc.designFee?.amount ?? 0) - (doc.discount?.amount ?? 0), doc.taxableValue, `${label}: Σ sections + fee − discount = taxable`);
  if (doc.taxLines.length) assert.equal(doc.taxLines.reduce((s, t) => s + t.taxableValue, 0), doc.taxableValue, `${label}: tax lines cover the taxable value`);
  assert.equal(doc.taxLines.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0), doc.totalTax, `${label}: total tax`);
  assert.equal(doc.taxableValue + doc.totalTax + doc.roundOff, doc.grandTotal, `${label}: taxable + tax + round-off = grand`);
  assert.equal(doc.grandTotal % 100, 0, `${label}: whole rupees`);
  check(Math.abs(doc.roundOff) <= 50, `${label}: round-off within 50 paise`);
  assert.equal(doc.paymentSchedule.reduce((s, m) => s + m.amount, 0), doc.grandTotal, `${label}: milestones sum to the grand total`);
  assert.equal(doc.amountInWords, amountInWords(doc.grandTotal), `${label}: words`);
  for (const m of doc.paymentSchedule) assert.equal(m.amount % 100, 0, `${label}: ${m.label} in whole rupees`);
  for (const s of doc.sections) for (const l of s.lines) check(Number.isSafeInteger(l.amount), `${label}: ${l.id} amount is integer paise`);
}

describe('buildQuote: controlled quote, hand-computed', () => {
  const doc = controlled();

  test('lines are re-derived and priced', () => {
    const lines = doc.sections.flatMap((s) => s.lines);
    const paint = lines.find((l) => l.id === 'paint')!;
    assert.equal(paint.kind === 'TRADE' && paint.quantityDisplay, 506.23, 'wall area from the plan, not the input');
    assert.equal(paint.amount, 13_161_98, '506.23 × ₹26');
    assert.equal(lines.find((l) => l.id === 'protect')!.amount, 5_000_00, 'LS');
    assert.equal(lines.find((l) => l.id === 'sofa')!.amount, 55_000_00, 'manual');
    assert.equal(lines.find((l) => l.id === 'wallpaper')!.amount, 12_000_00, 'optional is priced');
  });

  test('sections: rooms in plan order, then whole house; optional excluded from subtotals', () => {
    assert.deepEqual(doc.sections.map((s) => [s.title, s.subtotal]), [['Living Room', 13_161_98 + 55_000_00], ['Bedroom', 0], ['Whole house', 5_000_00]], 'sections');
    assert.deepEqual(doc.sections.flatMap((s) => s.lines.map((l) => l.lineNo)), ['1.01', '1.02', '2.01', '3.01'], 'numbering');
  });

  test('fee, discount, tax by HSN bucket, round-off, words, milestones', () => {
    // Pre-fee 73,161.98; 10% fee = 7,316.198 → 7,316.20; gross 80,478.18; −10,000 → taxable 70,478.18.
    assert.deepEqual(doc.designFee, { basis: 'PCT_OF_PROJECT', value: 10, amount: 7_316_20, sac: '998391', gstRatePct: 18 }, 'fee');
    assert.equal(doc.taxableValue, 70_478_18, 'taxable');
    // Discount 10,000 split pro rata across 9403 / 9954 / 9983 (largest remainder): 6,834.15 / 2,256.76 / 909.09.
    assert.deepEqual(doc.taxLines, [
      { hsnSac: '9403', taxableValue: 48_165_85, ratePct: 18, cgst: 4_334_93, sgst: 4_334_92, igst: 0 },
      { hsnSac: '9954', taxableValue: 15_905_22, ratePct: 18, cgst: 1_431_47, sgst: 1_431_47, igst: 0 },
      { hsnSac: '9983', taxableValue: 6_407_11, ratePct: 18, cgst: 576_64, sgst: 576_64, igst: 0 },
    ], 'tax lines (995473 painting truncates to 9954 under ₹5 cr)');
    assert.equal(doc.totalTax, 12_686_07, 'tax');
    assert.equal(doc.roundOff, -25, '83,164.25 → 83,164');
    assert.equal(doc.grandTotal, 83_164_00, 'grand');
    assert.equal(doc.amountInWords, 'Rupees Eighty-Three Thousand One Hundred Sixty-Four Only', 'words');
    assert.deepEqual(doc.paymentSchedule.map((m) => m.amount), [8_316_00, 41_582_00, 29_107_00, 4_159_00], 'milestones; remainder on the last');
    reconciles(doc, 'controlled');
  });

  test('document fields', () => {
    assert.equal(doc.financialYear, '2026-27', 'FY');
    assert.equal(doc.validUntil, '2026-10-31', '15 days');
    assert.equal(doc.placeOfSupplyStateCode, '27', 'place of supply');
    assert.equal(doc.isInterState, false, 'intra-state');
    assert.equal(doc.status, 'DRAFT', 'draft');
    assert.equal(doc.version, 1, 'v1');
    assert.equal(doc.warnings, undefined, 'no warnings');
    assert.equal(doc.compositionDeclaration, undefined, 'no declaration');
  });

  test('inter-state: same totals, all IGST', () => {
    const inter = controlled({ siteAddress: blr });
    assert.equal(inter.isInterState, true, 'Pune studio, Bengaluru site');
    assert.equal(inter.placeOfSupplyStateCode, '29', 'site state');
    assert.equal(inter.totalTax, doc.totalTax, 'same tax');
    check(inter.taxLines.every((t) => t.cgst === 0 && t.sgst === 0 && t.igst > 0), 'IGST only');
    reconciles(inter, 'inter');
  });

  test('turnover above ₹5 cr keeps 6-digit codes apart', () => {
    const big = controlled({ studio: studio({ turnoverAbove5Cr: true }) });
    assert.deepEqual(big.taxLines.map((t) => t.hsnSac), ['9403', '9954', '995473', '998391'], 'six-digit buckets');
    assert.equal(big.taxableValue, doc.taxableValue, 'same taxable');
    reconciles(big, 'big');
  });

  test('design fee per sq ft and lump sum', () => {
    const area = controlled({ designFee: { basis: 'PER_SQFT', value: 50_00 }, areaBasis: { kind: 'CARPET', sqft: 750 } });
    assert.equal(area.designFee!.amount, 37_500_00, '750 sq ft × ₹50');
    const plan = controlled({ designFee: { basis: 'PER_SQFT', value: 50_00 } });
    assert.equal(plan.designFee!.amount, 43_055_50, 'plan floor area 80 m² = 861.11 sq ft × ₹50');
    const ls = controlled({ designFee: { basis: 'LUMP_SUM', value: 75_000_00 } });
    assert.equal(ls.designFee!.amount, 75_000_00, 'lump sum');
    for (const d of [area, plan, ls]) reconciles(d, `fee ${d.designFee!.basis}`);
  });
});

describe('buildQuote: full sample BOQ', () => {
  const lines = fullLines();
  const room = buildQuote(input({ lines, designFee: { basis: 'PCT_OF_PROJECT', value: 8 }, discount: { label: 'Round', amount: 4_321_99 } }));
  const trade = buildQuote(input({ lines, view: 'TRADE_WISE', designFee: { basis: 'PCT_OF_PROJECT', value: 8 }, discount: { label: 'Round', amount: 4_321_99 } }));

  test('room-wise and trade-wise produce the same totals and tax', () => {
    reconciles(room, 'room-wise');
    reconciles(trade, 'trade-wise');
    for (const k of ['taxableValue', 'totalTax', 'roundOff', 'grandTotal'] as const) assert.equal(trade[k], room[k], k);
    assert.deepEqual(trade.taxLines, room.taxLines, 'tax lines');
    assert.equal(trade.sections.flatMap((s) => s.lines).length, room.sections.flatMap((s) => s.lines).length, 'same lines');
  });

  test('section order', () => {
    assert.deepEqual(room.sections.map((s) => s.title), ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Entry Hall', 'Whole house'], 'room-wise');
    const order = trade.sections.map((s) => TRADE_ORDER.indexOf(s.id.replace('trade:', '') as (typeof TRADE_ORDER)[number]));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'trade-wise follows TRADE_ORDER');
    check(trade.sections.some((s) => s.title === 'Modular kitchen'), 'modular kitchen section');
  });

  test('every template quotes and reconciles', () => {
    for (const m of index) {
      const p = load<Project>(`templates/${m.file}`);
      const d = buildQuote(input({ project: p, lines: toQuoteLines(autoLines(p, card)), designFee: { basis: 'PER_SQFT', value: 75_00 } }));
      reconciles(d, m.id);
      check(d.grandTotal > 0, `${m.id} has a total`);
    }
  });
});

describe('buildQuote: geometry and numbering across versions', () => {
  test('GEOMETRY lines follow the plan; MANUAL lines keep their quantity', () => {
    const moved: Project = structuredClone(sample);
    // Push the living room's west edge out by 1 m (and its wall).
    const f = moved.floors[0];
    const living = f.rooms.find((r) => r.id === 'room-living')!;
    living.polygon = [{ x: -1, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }, { x: -1, z: 5 }];
    const before = controlled();
    const after = controlled({ project: moved });
    const q = (d: QuotationDocument, id: string) => d.sections.flatMap((s) => s.lines).find((l) => l.id === id)!;
    const pb = q(before, 'paint');
    const pa = q(after, 'paint');
    check(pb.kind === 'TRADE' && pa.kind === 'TRADE' && pa.quantityDisplay !== pb.quantityDisplay, 'paint quantity changed with the plan');
    assert.equal(q(after, 'sofa').amount, q(before, 'sofa').amount, 'manual unchanged');
  });

  test('line numbers are stable for existing ids; new lines and sections take fresh numbers', () => {
    const v1 = controlled();
    const extra: QuoteLine = { ...(controlledLines()[2] as QuoteLine & { kind: 'TRADE' }), id: 'chair', description: 'Chair' };
    const kitchenLine: QuoteLine = { ...(controlledLines()[2] as QuoteLine & { kind: 'TRADE' }), id: 'stool', roomId: 'room-kitchen', description: 'Stool' };
    // v2 drops 'paint', adds a chair in the living room and a stool in the kitchen (a new section that sorts before Bedroom).
    const lines = [...controlledLines().filter((l) => l.id !== 'paint'), extra, kitchenLine];
    const v2 = buildQuote(input({ lines, designFee: { basis: 'PCT_OF_PROJECT', value: 10 } }), v1);
    const no = (id: string) => v2.sections.flatMap((s) => s.lines).find((l) => l.id === id)!.lineNo;
    assert.equal(no('sofa'), '1.02', 'sofa keeps 1.02');
    assert.equal(no('chair'), '1.03', 'paint’s 1.01 is not reused');
    assert.equal(no('wallpaper'), '2.01', 'bedroom keeps section 2');
    assert.equal(no('protect'), '3.01', 'whole house keeps section 3');
    assert.equal(no('stool'), '4.01', 'new kitchen section numbered after the highest');
    assert.deepEqual(v2.sections.map((s) => s.title), ['Living Room', 'Kitchen', 'Bedroom', 'Whole house'], 'display order stays plan order');
    const v3 = buildQuote(input({ lines, designFee: { basis: 'PCT_OF_PROJECT', value: 10 } }), v2);
    assert.deepEqual(v3.sections.flatMap((s) => s.lines.map((l) => l.lineNo)), v2.sections.flatMap((s) => s.lines.map((l) => l.lineNo)), 'rebuild is stable');
  });

  test('existing carries identity, status and approvals', () => {
    const v1 = controlled();
    const v2 = buildQuote(input({ lines: controlledLines() }), { ...v1, id: 'q1', version: 2, number: 'SS/Q/26-27/0001', status: 'ISSUED', approvals: [] });
    assert.deepEqual([v2.id, v2.version, v2.number, v2.status], ['q1', 2, 'SS/Q/26-27/0001', 'ISSUED'], 'carried over');
  });
});

describe('buildQuote: registration, validation, warnings', () => {
  test('composition: no tax lines, declaration, bill of supply', () => {
    const comp = studio({ gstRegistration: 'COMPOSITION' });
    const d = controlled({ studio: comp, docType: 'BILL_OF_SUPPLY' });
    assert.deepEqual(d.taxLines, [], 'no tax lines');
    assert.equal(d.totalTax, 0, 'no tax');
    assert.equal(d.compositionDeclaration, 'composition taxable person, not eligible to collect tax on supplies', 'declaration');
    reconciles(d, 'composition');
    assert.throws(() => controlled({ studio: comp, docType: 'TAX_INVOICE' }), /cannot issue a TAX_INVOICE/);
    assert.throws(() => controlled({ studio: comp, siteAddress: blr }), /composition supplier cannot make an inter-state supply/);
  });

  test('unregistered: plain invoice without GST; no VOs', () => {
    const un = studio({ gstRegistration: 'UNREGISTERED', gstin: undefined });
    const d = controlled({ studio: un, docType: 'PLAIN_INVOICE' });
    assert.deepEqual(d.taxLines, [], 'no tax lines');
    reconciles(d, 'unregistered');
    assert.equal(controlled({ studio: un }).totalTax, 0, 'quotation without GST');
    assert.throws(() => controlled({ studio: un, docType: 'VARIATION_ORDER' }), /cannot issue a VARIATION_ORDER/);
  });

  test('milestones must sum to 100%', () => {
    assert.throws(() => controlled({ milestones: [{ label: 'All', pct: 90, trigger: 'ON_SIGNING' }] }), /sum to 90%/);
    assert.throws(() => controlled({ milestones: [] }), /required/);
    assert.throws(() => controlled({ milestones: [{ label: 'A', pct: 110, trigger: 'ON_SIGNING' }, { label: 'B', pct: -10, trigger: 'ON_HANDOVER' }] }), /positive/);
    const thirds = controlled({ milestones: [1, 2, 3].map((i) => ({ label: `M${i}`, pct: 100 / 3, trigger: 'ON_APPROVAL' as const })) });
    reconciles(thirds, 'thirds');
  });

  test('impossible values throw; missing exclusions only warn', () => {
    assert.throws(() => controlled({ discount: { label: 'Too much', amount: 1_00_00_000_00 } }), /exceeds the subtotal/);
    assert.throws(() => buildQuote(input({ lines: [...controlledLines(), controlledLines()[0]] })), /Duplicate line id/);
    const bad = controlledLines();
    (bad[0] as QuoteLine & { kind: 'TRADE' }).unit = 'RFT';
    assert.throws(() => buildQuote(input({ lines: bad })), /gives M2 but the unit is RFT/);
    const w = controlled({ exclusions: [] });
    check(w.warnings?.some((x) => /exclusions/.test(x)), 'exclusions warning');
    assert.equal(w.grandTotal, controlled().grandTotal, 'still builds');
  });

  test('lines on a deleted room warn and land in Whole house', () => {
    const lines = controlledLines();
    (lines[2] as QuoteLine & { kind: 'TRADE' }).roomId = 'room-gone';
    const d = buildQuote(input({ lines }));
    check(d.warnings?.some((x) => /no longer in the plan/.test(x)), 'warning');
    check(d.sections.find((s) => s.title === 'Whole house')!.lines.some((l) => l.id === 'sofa'), 'moved to whole house');
  });
});

describe('canonical JSON and hash', () => {
  test('stable across key order; excludes approval-time fields', async () => {
    const doc = controlled();
    const reordered = Object.fromEntries(Object.entries(doc).reverse()) as unknown as QuotationDocument;
    assert.equal(canonicalJson(reordered), canonicalJson(doc), 'top-level order');
    const deep = { ...doc, supplier: Object.fromEntries(Object.entries(doc.supplier).reverse()) } as QuotationDocument;
    assert.equal(canonicalJson(deep), canonicalJson(doc), 'nested order');
    const h = await hashQuote(doc);
    check(/^[0-9a-f]{64}$/.test(h), `sha-256 hex: ${h}`);
    assert.equal(await hashQuote(reordered), h, 'same hash');
    const approved: QuotationDocument = {
      ...doc, status: 'APPROVED', lockedAt: '2026-10-20T10:00:00Z', hash: h, warnings: ['x'],
      approvals: [{ id: 'a1', decision: 'APPROVED', byName: 'A', byContact: '+91…', method: 'PORTAL_LINK', at: '2026-10-20T10:00:00Z', documentHash: h }],
    };
    assert.equal(await hashQuote(approved), h, 'approving does not change the hash');
    assert.deepEqual([...HASH_EXCLUDED_FIELDS], ['approvals', 'status', 'lockedAt', 'hash', 'warnings'], 'documented exclusions');
    assert.equal(await hashQuote(controlled()), h, 'rebuilding gives the same hash');
  });

  test('changes when content changes', async () => {
    const doc = controlled();
    const h = await hashQuote(doc);
    const lines = controlledLines();
    (lines[2] as QuoteLine & { kind: 'TRADE' }).materialRate = 55_001_00;
    assert.notEqual(await hashQuote(buildQuote(input({ lines, designFee: { basis: 'PCT_OF_PROJECT', value: 10 }, discount: { label: 'Festive', amount: 10_000_00 } }))), h, 'line change');
    assert.notEqual(await hashQuote({ ...doc, number: 'SS/Q/26-27/0001' }), h, 'the number is content');
    assert.notEqual(await hashQuote({ ...doc, terms: ['Valid 30 days'] }), h, 'terms are content');
    check(!canonicalJson(doc).includes('"approvals"'), 'approvals not in canonical JSON');
  });
});

describe('numbering', () => {
  test('format and Rule 46 length', () => {
    assert.equal(nextQuoteNumber('SS', 'QUOTATION', '2026-27', 41), 'SS/Q/26-27/0042', 'quotation');
    assert.equal(nextQuoteNumber('SS', 'PROFORMA', '2026-27', 0), 'SS/PI/26-27/0001', 'proforma');
    assert.equal(nextQuoteNumber('ss', 'TAX_INVOICE', '2026-27', 9), 'SS/TI/26-27/0010', 'upper-cased');
    assert.equal(nextQuoteNumber('SS', 'BILL_OF_SUPPLY', '2026-27', 1), 'SS/BS/26-27/0002', 'bill of supply');
    assert.equal(nextQuoteNumber('SS', 'PLAIN_INVOICE', '2026-27', 1), 'SS/IN/26-27/0002', 'plain invoice');
    assert.equal(nextQuoteNumber('SS', 'VARIATION_ORDER', '2026-27', 1), 'SS/VO/26-27/0002', 'variation order');
    assert.equal(nextQuoteNumber('Sharma & Sons', 'PROFORMA', '2026-27', 41), 'SH/PI/26-27/0042', 'long prefix shortened to fit 16');
    assert.equal(nextQuoteNumber('', 'QUOTATION', '2026-27', 41), 'Q/26-27/0042', 'no prefix');
    for (const t of ['QUOTATION', 'PROFORMA', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE', 'VARIATION_ORDER'] as const) {
      const n = nextQuoteNumber('STUDIO', t, '2026-27', 9998);
      check(n.length <= 16, `${n} ≤ 16`);
      check(/^[A-Z0-9/-]+$/.test(n), `${n} uses Rule 46 characters`);
    }
    assert.equal(nextQuoteNumber('SS', 'QUOTATION', '2026-27', 9999), 'SS/Q/26-27/10000', 'sequence grows past 4 digits');
    assert.throws(() => nextQuoteNumber('SS', 'QUOTATION', '26-27', 1), /Financial year/);
  });
});

describe('diffQuotes', () => {
  test('added, removed, changed and the total delta', () => {
    const a = controlled();
    const lines = controlledLines().filter((l) => l.id !== 'protect');
    (lines.find((l) => l.id === 'sofa') as QuoteLine & { kind: 'TRADE' }).materialRate = 60_000_00;
    lines.push({ ...(controlledLines()[2] as QuoteLine & { kind: 'TRADE' }), id: 'chair', description: 'Chair', materialRate: 8_000_00 });
    const b = buildQuote(input({ lines, designFee: { basis: 'PCT_OF_PROJECT', value: 10 }, discount: { label: 'Festive', amount: 10_000_00 }, docType: 'VARIATION_ORDER' }), a);
    const d = diffQuotes(a, b);
    assert.deepEqual(d.added.map((x) => [x.id, x.amount]), [['chair', 8_000_00]], 'added');
    assert.deepEqual(d.removed.map((x) => [x.id, x.amount]), [['protect', 5_000_00]], 'removed');
    assert.deepEqual(d.changed.map((x) => [x.id, x.fields, x.delta]), [['sofa', ['materialRate', 'amount'], 5_000_00]], 'changed');
    assert.equal(d.linesDelta, 8_000_00 - 5_000_00 + 5_000_00, 'lines delta');
    assert.equal(d.totalDelta, b.grandTotal - a.grandTotal, 'total delta');
    assert.equal(d.taxableDelta, b.taxableValue - a.taxableValue, 'taxable delta');
    const same = diffQuotes(a, controlled());
    assert.deepEqual([same.added, same.removed, same.changed, same.totalDelta], [[], [], [], 0], 'no change');
  });
});

describe('allocate', () => {
  test('parts sum exactly and are proportional', () => {
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33], 'thirds');
    assert.deepEqual(allocate(0, [5, 5]), [0, 0], 'nothing');
    const parts = allocate(1_000_00, [7_316_20, 12_345_67, 99_999_99]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 1_000_00, 'sums');
  });
});
