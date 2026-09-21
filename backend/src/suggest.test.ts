import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_SURFACES,
  TUNING,
  aestheticScoreOf,
  applyToProject,
  buildCategoryStats,
  chromaAgreement,
  combine,
  costEfficiency,
  effectiveCostPerSqm,
  effectivePrice,
  harmony,
  hueDistance,
  normLogWith,
  oklchOf,
  quality,
  styleFit,
  suggest,
  tone,
  unitsPerSqm,
} from './suggest.ts';
import { readSampleProject, readSeedCatalog } from './shared.ts';
import type { Catalog, Material, Surface } from '../../shared/types.ts';

const catalog: Catalog = readSeedCatalog();
const sample = readSampleProject();
const byId = new Map(catalog.materials.map((m) => [m.id, m]));
const must = (id: string): Material => {
  const m = byId.get(id);
  assert.ok(m, `seed catalog is missing ${id}`);
  return m;
};

// ---------------------------------------------------------------------------

describe('colour primitives', () => {
  test('hue distance is circular and never exceeds 180', () => {
    assert.equal(hueDistance(10, 350), 20);
    assert.equal(hueDistance(350, 10), 20);
    assert.equal(hueDistance(0, 180), 180);
    assert.equal(hueDistance(90, 90), 0);
  });

  test('oklch reports a hue for a chromatic colour and none for a grey', () => {
    const oak = oklchOf('#C8A165');
    assert.ok(oak.C > 0.05, 'warm oak is chromatic');
    assert.equal(typeof oak.h, 'number');
    assert.equal(oklchOf('#808080').h, undefined, 'mid grey has no meaningful hue');
  });

  test('OKLCH lightness is perceptual, so white > mid grey > black', () => {
    assert.ok(oklchOf('#FFFFFF').L > oklchOf('#808080').L);
    assert.ok(oklchOf('#808080').L > oklchOf('#000000').L);
  });
});

describe('harmony', () => {
  const anchor = { L: 0.7, C: 0.1, h: 30 };

  test('an exact harmony target scores 1', () => {
    for (const h of [30, 60, 0, 150, 270, 210]) {
      const r = harmony(anchor, { L: 0.7, C: 0.1, h });
      assert.ok(r.score > 0.999, `hue ${h} should be an exact target, got ${r.score}`);
    }
  });

  test('one sigma off target scores exp(-1)', () => {
    const r = harmony(anchor, { L: 0.7, C: 0.1, h: 30 + 180 + TUNING.HARMONY_SIGMA_DEG });
    assert.ok(Math.abs(r.score - Math.exp(-1)) < 1e-9, `got ${r.score}`);
  });

  test('names the nearest relation', () => {
    assert.equal(harmony(anchor, { L: 0.7, C: 0.1, h: 210 }).relation, 'complementary');
    assert.equal(harmony(anchor, { L: 0.7, C: 0.1, h: 58 }).relation, 'analogous');
    assert.equal(harmony(anchor, { L: 0.7, C: 0.1, h: 150 }).relation, 'triadic');
    assert.equal(harmony(anchor, { L: 0.7, C: 0.1, h: 32 }).relation, 'monochrome');
  });

  test('the worst possible hue still scores above zero, never NaN', () => {
    // Halfway between analogous and triadic is the widest gap on the wheel.
    const r = harmony(anchor, { L: 0.7, C: 0.1, h: 30 + 75 });
    assert.ok(Number.isFinite(r.score) && r.score >= 0 && r.score < 0.01, `got ${r.score}`);
  });

  test('an achromatic anchor short-circuits rather than inventing an angle', () => {
    const r = harmony({ L: 0.7, C: 0, h: undefined }, { L: 0.4, C: 0.2, h: 200 });
    assert.equal(r.relation, 'neutral');
    assert.equal(r.score, 0.8);
    assert.equal(r.deltaDeg, undefined);
  });
});

describe('aesthetic terms', () => {
  const style = catalog.styles.find((s) => s.id === 'modern-warm')!;

  test('styleFit is the overlap as a fraction of the style tag set', () => {
    // oak-hardwood: warm, classic, modern, natural vs modern/warm/minimal/natural
    assert.equal(styleFit(must('oak-hardwood'), style), 3 / 4);
    assert.equal(styleFit(must('bamboo-floor'), style), 4 / 4);
  });

  test('styleFit is 0 with no style, never NaN', () => {
    assert.equal(styleFit(must('oak-hardwood'), undefined), 0);
  });

  test('tone measures separation and saturates at the span', () => {
    const a = { L: 0.2, C: 0, h: undefined };
    assert.equal(tone(a, { L: 0.2, C: 0, h: undefined }), 0);
    assert.equal(tone(a, { L: 0.2 + TUNING.TONE_SPAN, C: 0, h: undefined }), 1);
    assert.equal(tone(a, { L: 1.0, C: 0, h: undefined }), 1, 'clamped, not >1');
  });

  test('chroma measures agreement and bottoms out at the span', () => {
    const a = { L: 0.5, C: 0.1, h: 0 };
    assert.equal(chromaAgreement(a, { L: 0.5, C: 0.1, h: 0 }), 1);
    assert.equal(chromaAgreement(a, { L: 0.5, C: 0.1 + TUNING.CHROMA_SPAN, h: 0 }), 0);
  });

  test('the aesthetic weights sum to 1, so the score is a true [0,1]', () => {
    const sum = Object.values(TUNING.AESTHETIC_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12, `weights sum to ${sum}`);
    assert.ok(
      Math.abs(aestheticScoreOf({ harmony: 1, styleFit: 1, tone: 1, chroma: 1, aesthetic: 1 }) - 1) <
        1e-12,
    );
    assert.equal(
      aestheticScoreOf({ harmony: 0, styleFit: 0, tone: 0, chroma: 0, aesthetic: 0 }),
      0,
    );
  });
});

describe('cost efficiency', () => {
  test('effective price includes wastage', () => {
    const tile = must('ceramic-tile-grey');
    // The property is "shelf price scaled by the wastage allowance", whatever
    // the price and the currency happen to be, so both come from the catalog.
    assert.ok(tile.wastageFactor > 0, 'tile must carry a wastage allowance for this to mean much');
    assert.ok(
      Math.abs(effectivePrice(tile) - tile.pricePerUnit * (1 + tile.wastageFactor)) < 1e-9,
    );
    assert.ok(effectivePrice(tile) > tile.pricePerUnit);
  });

  test('quality weights sum to 1 and a perfect material scores 1', () => {
    const sum = Object.values(TUNING.QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    const perfect = {
      durabilityScore: 5,
      aestheticScore: 5,
      sustainabilityScore: 5,
    } as Material;
    assert.ok(Math.abs(quality(perfect) - 1) < 1e-12);
  });

  test('normLog is monotone in price and never returns zero', () => {
    const [lo, hi] = [Math.log(10), Math.log(1000)];
    const a = normLogWith(10, lo, hi);
    const b = normLogWith(100, lo, hi);
    const c = normLogWith(1000, lo, hi);
    assert.ok(a < b && b < c, `${a} < ${b} < ${c}`);
    assert.equal(a, TUNING.PRICE_FLOOR);
    assert.equal(c, 1);
    assert.ok(a > 0, 'a zero denominator would make value Infinity');
  });

  test('a degenerate single-price category does not divide by zero', () => {
    const v = normLogWith(50, Math.log(50), Math.log(50));
    assert.ok(Number.isFinite(v) && v > 0);
  });

  test('cheaper beats dearer at equal quality', () => {
    const stats = buildCategoryStats(catalog.materials);
    const cheap = { ...must('ceramic-tile-grey') };
    // "Dearer" is defined relative to the material under test, not as a fixed
    // amount of money that a re-price can overtake.
    const dear = { ...cheap, id: 'x', pricePerUnit: cheap.pricePerUnit * 4 };
    assert.ok(costEfficiency(cheap, stats) > costEfficiency(dear, stats));
  });

  test('higher quality beats lower at equal price', () => {
    const stats = buildCategoryStats(catalog.materials);
    const base = must('ceramic-tile-grey');
    const worse = { ...base, id: 'y', durabilityScore: 1, sustainabilityScore: 1, aestheticScore: 1 };
    assert.ok(costEfficiency(base, stats) > costEfficiency(worse, stats));
  });

  test('the value score stays inside [0,1] for every seeded material', () => {
    const stats = buildCategoryStats(catalog.materials);
    for (const m of catalog.materials) {
      const v = costEfficiency(m, stats);
      assert.ok(v >= 0 && v <= 1, `${m.id} scored ${v}`);
    }
  });

  test('price stats are category-wide, so an unrelated filter cannot move them', () => {
    // This is the bug the category-wide population exists to prevent: a score
    // that changes because some *other* material was filtered out reads to a
    // user as the engine being broken.
    // Only a material that sits strictly *inside* its category's price range
    // can demonstrate the sensitivity — one already at the range's floor is
    // pinned there whatever else is dropped. Which material that is depends on
    // the price list, so pick it at runtime instead of naming one.
    const peersOf = (m: Material) => catalog.materials.filter((x) => x.category === m.category);
    const subject = catalog.materials.find((m) => {
      if (!m.applicableSurfaces.includes('WALL')) return false;
      const peers = peersOf(m).map(effectiveCostPerSqm);
      const eff = effectiveCostPerSqm(m);
      return eff > Math.min(...peers) && eff < Math.max(...peers);
    });
    assert.ok(subject, 'the catalog needs a mid-priced WALL material for this test to say anything');

    const full = buildCategoryStats(catalog.materials);
    // Dropping the dearest member of the subject's own category collapses that
    // category's price range, and a population-relative score therefore moves...
    const dearest = peersOf(subject).reduce((a, b) =>
      effectiveCostPerSqm(b) > effectiveCostPerSqm(a) ? b : a,
    );
    const withoutDearest = buildCategoryStats(
      catalog.materials.filter((m) => m.id !== dearest.id),
    );
    assert.notEqual(
      costEfficiency(subject, full).toFixed(6),
      costEfficiency(subject, withoutDearest).toFixed(6),
      'the statistic really is population-sensitive, which is why scope matters',
    );

    // ...so suggest() must always use the full-catalog population. Same
    // material, differently-scoped requests, identical value score.
    const opts = { mode: 'COST_EFFICIENCY' as const, styleId: 'modern-warm' };
    const narrow = suggest({ ...opts, surfaces: ['WALL'] }, catalog, { limitPerSurface: 24 });
    const wide = suggest({ ...opts, surfaces: ['WALL', 'FLOOR', 'ROOF'] }, catalog, {
      limitPerSurface: 24,
    });
    const pick = (r: typeof narrow) =>
      r.items.find((i) => i.surface === 'WALL' && i.materialId === subject.id)!;
    assert.equal(pick(narrow).breakdown.value, pick(wide).breakdown.value);
    assert.equal(pick(narrow).score, pick(wide).score);
    assert.ok(Math.abs(pick(narrow).breakdown.value - costEfficiency(subject, full)) < 0.001);
  });

  test('paint is compared per square metre covered, not per litre', () => {
    // A litre of emulsion is nominally cheaper than a square metre of
    // anything, which makes the raw unit price meaningless across units.
    const paint = must('paint-warm-grey');
    const coats = paint.coatsRecommended!;
    const coverage = paint.coveragePerUnit!;
    assert.equal(paint.unit, 'LITER');
    assert.ok(coats > 0 && coverage > 1, 'a litre of emulsion covers several m²');

    // The conversion itself: litres per m² is coats over coverage, and it is
    // emphatically not 1 — that is the whole point of the function existing.
    assert.ok(Math.abs(unitsPerSqm(paint) - coats / coverage) < 1e-12);
    assert.notEqual(unitsPerSqm(paint), 1, 'a litre is not a square metre');
    assert.ok(
      Math.abs(
        effectiveCostPerSqm(paint) - effectivePrice(paint) * (coats / coverage),
      ) < 1e-9,
    );
    // Because one litre goes a long way, the per-m² cost must come in well
    // under the per-litre shelf price. Skipping the conversion inverts this.
    assert.ok(effectiveCostPerSqm(paint) < effectivePrice(paint));

    // Anything already priced per m² is untouched.
    const tile = must('ceramic-tile-grey');
    assert.equal(unitsPerSqm(tile), 1);
    assert.equal(effectiveCostPerSqm(tile), effectivePrice(tile));

    // And putting the two on a common basis WIDENS the gap between them: on
    // raw unit prices a tile looks only a few times dearer than a litre of
    // paint; per m² covered it is an order of magnitude dearer. Ranking on
    // pricePerUnit alone gets every paint-versus-tile question backwards.
    assert.ok(effectiveCostPerSqm(tile) > effectiveCostPerSqm(paint));
    assert.ok(
      effectiveCostPerSqm(tile) / effectiveCostPerSqm(paint) >
        effectivePrice(tile) / effectivePrice(paint),
      'converting to per-m² must widen the tile/paint gap, not preserve it',
    );
  });
});

describe('mode combination', () => {
  test('each mode selects the right axis', () => {
    assert.equal(combine('AESTHETIC', 0.8, 0.2), 0.8);
    assert.equal(combine('COST_EFFICIENCY', 0.8, 0.2), 0.2);
    assert.equal(combine('BALANCED', 0.8, 0.2), 0.5);
  });

  test('BALANCED really is the mean of the other two, per material', () => {
    const req = { styleId: 'modern-warm', surfaces: ['FLOOR'] as Surface[] };
    const opts = { limitPerSurface: 24 };
    const a = suggest({ ...req, mode: 'AESTHETIC' }, catalog, opts);
    const c = suggest({ ...req, mode: 'COST_EFFICIENCY' }, catalog, opts);
    const b = suggest({ ...req, mode: 'BALANCED' }, catalog, opts);
    const map = (r: typeof a) => new Map(r.items.map((i) => [i.materialId, i.score]));
    const [ma, mc, mb] = [map(a), map(c), map(b)];
    assert.ok(mb.size > 0);
    for (const [id, score] of mb) {
      assert.ok(
        Math.abs(score - 0.5 * (ma.get(id)! + mc.get(id)!)) < 0.002,
        `${id}: ${score} != mean(${ma.get(id)}, ${mc.get(id)})`,
      );
    }
  });
});

describe('gating', () => {
  test('a surface a material cannot take is an exclusion, never a low score', () => {
    const r = suggest({ mode: 'AESTHETIC', surfaces: ['FLOOR'] }, catalog, {
      limitPerSurface: 24,
    });
    for (const item of r.items) {
      assert.ok(
        must(item.materialId).applicableSurfaces.includes('FLOOR'),
        `${item.materialId} cannot go on a floor but was scored`,
      );
    }
    const excluded = new Set(r.exclusions.map((e) => e.materialId));
    assert.ok(excluded.has('gypsum-ceiling'), 'a ceiling-only material must be excluded');
    assert.ok(excluded.has('paint-navy'), 'a wall-only paint must be excluded');
    assert.ok(!excluded.has('oak-hardwood'));
  });

  test('every excluded material is accounted for exactly once per surface', () => {
    const r = suggest({ mode: 'AESTHETIC', surfaces: ['FLOOR'] }, catalog, {
      limitPerSurface: 24,
    });
    const applicable = catalog.materials.filter((m) => m.applicableSurfaces.includes('FLOOR'));
    assert.equal(r.exclusions.length, catalog.materials.length - applicable.length);
    assert.equal(r.items.length, applicable.length);
  });

  test('exclusion reasons say which surfaces the material IS good for', () => {
    const r = suggest({ mode: 'AESTHETIC', surfaces: ['ROOF'] }, catalog);
    const e = r.exclusions.find((x) => x.materialId === 'oak-hardwood')!;
    assert.match(e.reason, /not applicable to ROOF/);
    assert.match(e.reason, /FLOOR/);
  });

  test('the material already in use is not suggested back to the user', () => {
    const r = suggest(
      { mode: 'AESTHETIC', surfaces: ['FLOOR'], current: { FLOOR: 'oak-hardwood' } },
      catalog,
      { limitPerSurface: 24 },
    );
    assert.ok(!r.items.some((i) => i.materialId === 'oak-hardwood'));
  });
});

describe('explainability', () => {
  const modes = ['AESTHETIC', 'COST_EFFICIENCY', 'BALANCED'] as const;

  for (const mode of modes) {
    test(`${mode}: every item carries a non-empty reason and a full breakdown`, () => {
      const r = suggest(
        {
          mode,
          styleId: 'modern-warm',
          current: { FLOOR: 'oak-hardwood', WALL: 'paint-warm-grey' },
        },
        catalog,
      );
      assert.ok(r.items.length > 0);
      for (const i of r.items) {
        assert.ok(i.reason.trim().length > 0, `${i.materialId} has an empty reason`);
        assert.ok(
          i.reason.length > 20 && i.reason.toLowerCase() !== 'cheaper',
          `"${i.reason}" is not an explanation`,
        );
        for (const key of [
          'styleMatch',
          'colorHarmony',
          'value',
          'durability',
          'sustainability',
        ] as const) {
          const v = i.breakdown[key];
          assert.ok(
            typeof v === 'number' && v >= 0 && v <= 1,
            `${i.materialId}.breakdown.${key} = ${v}`,
          );
        }
        assert.ok(i.score >= 0 && i.score <= 1);
        assert.ok(ALL_SURFACES.includes(i.surface));
      }
    });
  }

  test('a money claim names what it is cheaper than, and by how much', () => {
    const r = suggest(
      {
        mode: 'COST_EFFICIENCY',
        styleId: 'modern-warm',
        surfaces: ['FLOOR'],
        current: { FLOOR: 'oak-hardwood' },
      },
      catalog,
    );
    const laminate = r.items.find((i) => i.materialId === 'laminate-oak')!;
    assert.equal(laminate.replaces, 'oak-hardwood');
    assert.equal(laminate.replacesName, 'European Oak Hardwood');
    assert.ok(laminate.estimatedSavings! > 0);
    assert.ok(laminate.estimatedSavingsPct! > 50);
    assert.match(laminate.reason, /cheaper per m²/);
    assert.match(laminate.reason, /durability/);
  });

  test('the note is never empty', () => {
    for (const mode of modes) {
      assert.ok(suggest({ mode }, catalog).note.trim().length > 0);
    }
  });

  test('savings are computed on effective price, so wastage counts', () => {
    const r = suggest(
      { mode: 'BALANCED', surfaces: ['FLOOR'], current: { FLOOR: 'oak-hardwood' } },
      catalog,
      { limitPerSurface: 24 },
    );
    const tile = r.items.find((i) => i.materialId === 'ceramic-tile-grey')!;
    const expected =
      effectiveCostPerSqm(must('oak-hardwood')) - effectiveCostPerSqm(must('ceramic-tile-grey'));
    assert.ok(Math.abs(tile.estimatedSavings! - expected) < 0.01);
    // Shelf prices differ by 86 - 34 = 52. The real gap is wider, because the
    // dearer material also carries more waste per usable m². Quoting the shelf
    // difference understates the saving.
    assert.ok(tile.estimatedSavings! > 52, `got ${tile.estimatedSavings}`);
  });

  test('a saving against paint is expressed per m² covered, not per litre', () => {
    const r = suggest(
      { mode: 'COST_EFFICIENCY', surfaces: ['WALL'], current: { WALL: 'paint-navy' } },
      catalog,
      { limitPerSurface: 24 },
    );
    const white = r.items.find((i) => i.materialId === 'paint-white-matte')!;
    const expected =
      effectiveCostPerSqm(must('paint-navy')) - effectiveCostPerSqm(must('paint-white-matte'));
    assert.ok(Math.abs(white.estimatedSavings! - expected) < 0.01);
    // Quoting the per-litre gap would overstate the saving by the coverage
    // factor. The reported figure must be the much smaller per-m² gap.
    const perLitreGap =
      effectivePrice(must('paint-navy')) - effectivePrice(must('paint-white-matte'));
    assert.ok(perLitreGap > 0);
    assert.ok(
      white.estimatedSavings! < perLitreGap,
      'a paint-to-paint saving is per m² covered, far less than the per-litre difference',
    );
    assert.match(white.reason, /per m² covered/);
    // Tile is nominally "34 vs 14.50" but is in truth far dearer per m².
    const tile = r.items.find((i) => i.materialId === 'ceramic-tile-grey')!;
    assert.equal(tile.estimatedSavings, undefined, 'tile is not cheaper than paint per m²');
  });
});

describe('cheaper look-alikes', () => {
  const r = suggest(
    {
      mode: 'COST_EFFICIENCY',
      styleId: 'modern-warm',
      surfaces: ['FLOOR'],
      current: { FLOOR: 'oak-hardwood' },
    },
    catalog,
    { limitPerSurface: 24 },
  );

  test('strand-woven bamboo qualifies: same colour, cheaper, one durability point down', () => {
    const bamboo = r.items.find((i) => i.materialId === 'bamboo-floor')!;
    assert.match(bamboo.reason, /same colour as your european oak hardwood/i);
    assert.ok(bamboo.estimatedSavings! > 0);
  });

  test('oak laminate does NOT qualify — it is a colour match but two grades softer', () => {
    // deltaE to oak is 0.009, well inside the window, and it is much cheaper.
    // The durability gate is the only thing stopping it, and it should:
    // recommending a 3/5 laminate as a "look-alike" for 5/5 hardwood is the
    // exact advice that gets a floor replaced in five years.
    const laminate = r.items.find((i) => i.materialId === 'laminate-oak')!;
    assert.equal(must('oak-hardwood').durabilityScore - must('laminate-oak').durabilityScore, 2);
    assert.doesNotMatch(laminate.reason, /same colour as/i);
    // It is still offered, just argued on price rather than on likeness.
    assert.match(laminate.reason, /cheaper/);
  });

  test('a visibly different material is not', () => {
    const marble = r.items.find((i) => i.materialId === 'marble-carrara')!;
    assert.doesNotMatch(marble.reason, /same colour as/i);
    const concrete = r.items.find((i) => i.materialId === 'polished-concrete')!;
    assert.doesNotMatch(concrete.reason, /same colour as/i);
  });

  test('a dearer material is never a cheaper look-alike', () => {
    const dear = suggest(
      { mode: 'BALANCED', surfaces: ['FLOOR'], current: { FLOOR: 'laminate-oak' } },
      catalog,
      { limitPerSurface: 24 },
    );
    const oak = dear.items.find((i) => i.materialId === 'oak-hardwood')!;
    assert.equal(oak.estimatedSavings, undefined, 'oak costs more than laminate');
    assert.doesNotMatch(oak.reason, /same colour as/i);
  });

  test('the note summarises the best look-alike', () => {
    assert.match(r.note, /look-alike/);
  });
});

describe('style resolution', () => {
  test('an explicit styleId wins', () => {
    assert.equal(suggest({ mode: 'AESTHETIC', styleId: 'industrial-loft' }, catalog).styleId, 'industrial-loft');
  });

  test('with no styleId the style is inferred from the current choices', () => {
    const r = suggest(
      { mode: 'AESTHETIC', current: { FLOOR: 'polished-concrete', WALL: 'exposed-brick' } },
      catalog,
    );
    assert.equal(r.styleId, 'industrial-loft');
  });

  test('a style-derived anchor is never described as the user\'s own', () => {
    // No `current`, so the anchor is the preset's recommendation. Saying "your
    // white render" about something the user has not picked is a lie, and
    // `replaces` would claim a swap that is not happening.
    const r = suggest(
      { mode: 'AESTHETIC', styleId: 'coastal-mediterranean', surfaces: ['EXTERIOR_WALL'] },
      catalog,
      { limitPerSurface: 24 },
    );
    for (const i of r.items) {
      assert.doesNotMatch(i.reason, /\byour\b/, `"${i.reason}"`);
      assert.equal(i.replaces, undefined);
      assert.equal(i.estimatedSavings, undefined);
    }
  });

  test('a user-chosen anchor is described as theirs, and is replaced', () => {
    const r = suggest(
      {
        mode: 'AESTHETIC',
        styleId: 'coastal-mediterranean',
        surfaces: ['EXTERIOR_WALL'],
        current: { EXTERIOR_WALL: 'stucco-white' },
      },
      catalog,
      { limitPerSurface: 24 },
    );
    assert.ok(r.items.length > 0);
    for (const i of r.items) assert.equal(i.replaces, 'stucco-white');
    assert.ok(r.items.some((i) => /\byour\b/.test(i.reason)));
  });

  test('the style\'s own recommendation explains itself as such, not as a match with itself', () => {
    const r = suggest(
      { mode: 'AESTHETIC', styleId: 'coastal-mediterranean', surfaces: ['ROOF'] },
      catalog,
      { limitPerSurface: 24 },
    );
    const clay = r.items.find((i) => i.materialId === 'clay-tile-roof')!;
    assert.match(clay.reason, /own pick for this surface/);
    assert.doesNotMatch(clay.reason, /0°/, 'comparing a colour with itself is not a reason');
  });

  test('an unknown styleId degrades to no style rather than throwing', () => {
    const r = suggest({ mode: 'AESTHETIC', styleId: 'no-such-style', surfaces: ['FLOOR'] }, catalog);
    assert.equal(r.styleId, undefined);
    assert.ok(r.items.length > 0);
    for (const i of r.items) assert.equal(i.breakdown.styleMatch, 0);
  });
});

describe('project-aware suggestions', () => {
  test('supplying a project yields real money figures', () => {
    const r = suggest(
      {
        mode: 'COST_EFFICIENCY',
        styleId: 'modern-warm',
        surfaces: ['FLOOR', 'WALL'],
        current: { FLOOR: 'oak-hardwood', WALL: 'paint-warm-grey' },
        project: sample,
      },
      catalog,
    );
    assert.ok(r.currentTotal! > 0);
    assert.ok(r.projectedTotal! > 0);
    assert.match(r.note, /\$/);
    // The note must describe the direction it actually went. Best value is not
    // the same as cheapest — a durable tile can out-score cheap paint on
    // quality-per-dollar and still raise the bill — so the engine has to say
    // "adds" when it adds rather than assuming every swap is a saving.
    const direction = r.projectedTotal! < r.currentTotal! ? /saves/ : /adds|leaves/;
    assert.match(r.note, direction);
  });

  test('the note reports a saving when the picks really are cheaper', () => {
    const r = suggest(
      {
        mode: 'COST_EFFICIENCY',
        surfaces: ['FLOOR'],
        current: { FLOOR: 'oak-hardwood' },
        project: sample,
      },
      catalog,
    );
    assert.ok(r.projectedTotal! < r.currentTotal!);
    assert.match(r.note, /saves \$/);
  });

  test('applyToProject only swaps surfaces that already had a material', () => {
    const swapped = applyToProject(sample, new Map<Surface, string>([['FLOOR', 'laminate-oak']]));
    for (const room of swapped.floors[0]!.rooms) {
      if (room.floorMaterialId) assert.equal(room.floorMaterialId, 'laminate-oak');
    }
    // Ceilings untouched.
    assert.equal(
      swapped.floors[0]!.rooms[0]!.ceilingMaterialId,
      sample.floors[0]!.rooms[0]!.ceilingMaterialId,
    );
    // And the input is not mutated.
    assert.equal(sample.floors[0]!.rooms[0]!.floorMaterialId, 'oak-hardwood');
  });

  test('a budget trims the projection toward the cap', () => {
    const base = suggest(
      { mode: 'AESTHETIC', styleId: 'classic-elegant', project: sample },
      catalog,
    );
    const capped = suggest(
      { mode: 'AESTHETIC', styleId: 'classic-elegant', project: sample, budget: 25_000 },
      catalog,
    );
    assert.ok(
      capped.projectedTotal! < base.projectedTotal!,
      `budgeted ${capped.projectedTotal} should undercut ${base.projectedTotal}`,
    );
    assert.match(capped.note, /budget/);
  });
});

describe('robustness', () => {
  test('is deterministic', () => {
    const req = { mode: 'BALANCED' as const, styleId: 'modern-warm', project: sample };
    assert.deepEqual(suggest(req, catalog), suggest(req, catalog));
  });

  test('an empty catalog produces no items and still explains itself', () => {
    const empty: Catalog = { ...catalog, materials: [], components: [], styles: [] };
    const r = suggest({ mode: 'BALANCED' }, empty);
    assert.equal(r.items.length, 0);
    assert.ok(r.note.length > 0);
  });

  test('defaults to every surface when none are requested', () => {
    const r = suggest({ mode: 'AESTHETIC' }, catalog, { limitPerSurface: 1 });
    assert.deepEqual([...new Set(r.items.map((i) => i.surface))].sort(), [...ALL_SURFACES].sort());
  });

  test('respects limitPerSurface', () => {
    const r = suggest({ mode: 'AESTHETIC', surfaces: ['WALL'] }, catalog, { limitPerSurface: 2 });
    assert.equal(r.items.length, 2);
  });

  test('items come back in descending score order within a surface', () => {
    const r = suggest({ mode: 'BALANCED', surfaces: ['WALL'] }, catalog, { limitPerSurface: 24 });
    const scores = r.items.map((i) => i.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
});
