/**
 * 3xDezine — recommendation engine.
 *
 * Pure: `suggest(request, catalog)` does no I/O, so it is directly testable and
 * cheap enough to call on every edit.
 *
 * Explainability is a hard requirement (ARCHITECTURE.md > Recommendation
 * engine). Two consequences shape the whole file:
 *
 *  1. **Gates are not scores.** A material that cannot go on a floor is not a
 *     floor suggestion with a low score — it is excluded, and the exclusion is
 *     reported separately. Folding a hard constraint into a weighted sum makes
 *     it possible for a good-looking wall tile to out-score a real floor.
 *
 *  2. **Every score decomposes.** Each term is independently normalised to
 *     [0,1] and kept on the item, so `reason` can be generated from whichever
 *     terms actually drove the ranking rather than written by hand.
 *
 * Colour work is done in **OKLCH**, not HSL. HSL's hue is an artefact of the
 * sRGB cube: equal hue steps are not equal perceptual steps, and lightness is
 * not perceptual lightness, so an HSL "complementary" pair frequently is not
 * one. OKLCH is perceptually uniform, which is what makes a fixed 18-degree
 * tolerance mean the same thing everywhere on the wheel.
 */

import { converter, differenceEuclidean } from 'culori';

import { estimateCost } from './shared.ts';
import type {
  Catalog,
  Material,
  Project,
  StylePreset,
  Surface,
  SuggestionItem,
  SuggestionMode,
  SuggestionRequest,
  SuggestionResponse,
  Unit,
} from '../../shared/types.ts';

// ---------------------------------------------------------------------------
// Tunables. Named, so the README and the tests can refer to the same numbers.
// ---------------------------------------------------------------------------

export const TUNING = {
  /** Gaussian width of the hue-harmony window, in degrees. */
  HARMONY_SIGMA_DEG: 18,
  /** Lightness difference that counts as full tonal separation, in OKLCH L. */
  TONE_SPAN: 0.45,
  /** Chroma difference that counts as a complete mismatch, in OKLCH C. */
  CHROMA_SPAN: 0.2,
  /**
   * Oklab euclidean distance under which two materials read as the same
   * colour. Calibrated against the seed catalog: oak hardwood to oak laminate
   * is 0.009 and to strand-woven bamboo 0.039 (both true look-alikes), while
   * oak to polished concrete is 0.096 and to wool carpet 0.114 — visibly
   * different materials that a looser threshold would wrongly pair.
   */
  LOOKALIKE_DELTA_E: 0.06,
  /** A look-alike may give up at most this much durability (1..5 scale). */
  LOOKALIKE_MAX_DURABILITY_DROP: 1,
  /**
   * Floor for the normalised log-price denominator. It does double duty: it
   * stops the cheapest material in a category dividing by zero, and it sets
   * the dynamic range of the value score, which is exactly `PRICE_FLOOR`
   * (cheapest) to `PRICE_FLOOR`x (dearest). At 0.4 the cheapest material is
   * worth 2.5x the dearest at equal quality — a strong but not absurd tilt.
   */
  PRICE_FLOOR: 0.4,
  AESTHETIC_WEIGHTS: {
    harmony: 0.35,
    styleFit: 0.3,
    tone: 0.15,
    chroma: 0.1,
    aesthetic: 0.1,
  },
  QUALITY_WEIGHTS: { durability: 0.45, aesthetic: 0.3, sustainability: 0.25 },
  DEFAULT_LIMIT_PER_SURFACE: 5,
} as const;

/** Hue offsets, in degrees, that read as deliberate rather than accidental. */
const HARMONY_TARGETS: { offset: number; relation: HarmonyRelation }[] = [
  { offset: 0, relation: 'monochrome' },
  { offset: 30, relation: 'analogous' },
  { offset: -30, relation: 'analogous' },
  { offset: 120, relation: 'triadic' },
  { offset: -120, relation: 'triadic' },
  { offset: 180, relation: 'complementary' },
];

export type HarmonyRelation =
  | 'monochrome'
  | 'analogous'
  | 'triadic'
  | 'complementary'
  | 'neutral';

export const ALL_SURFACES: Surface[] = [
  'FLOOR',
  'WALL',
  'CEILING',
  'EXTERIOR_WALL',
  'ROOF',
];

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const toOklch = converter('oklch');
const toOklab = converter('oklab');
const oklabDistance = differenceEuclidean('oklab');

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  L: number;
  /** Chroma. 0 is grey; sRGB tops out around 0.37. */
  C: number;
  /** Hue in degrees, or `undefined` when the colour is achromatic. */
  h: number | undefined;
}

export function oklchOf(hex: string): Oklch {
  const c = toOklch(hex);
  if (!c) return { L: 0.5, C: 0, h: undefined };
  // culori leaves `h` undefined for greys; below this chroma the hue angle is
  // numerically unstable anyway and carries no visual meaning.
  const chroma = c.c ?? 0;
  return { L: c.l ?? 0.5, C: chroma, h: chroma < 0.01 ? undefined : c.h };
}

/** Shortest distance between two hue angles, 0..180 degrees. */
export function hueDistance(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

export interface HarmonyResult {
  score: number;
  relation: HarmonyRelation;
  /** Degrees from the nearest harmony target. `undefined` when achromatic. */
  deltaDeg: number | undefined;
  /** Raw hue separation between anchor and candidate, for the reason text. */
  separationDeg: number | undefined;
}

/**
 * `Harmony = exp(-(delta_h / 18 degrees)^2)` against the NEAREST harmony target
 * of the anchor hue. A Gaussian rather than a step so that 19 degrees off is
 * nearly as good as 18, which is how it looks to a person.
 *
 * Greys have no hue and pair with everything, so an achromatic anchor or
 * candidate short-circuits to a fixed, deliberately un-decisive 0.8 rather than
 * inventing an angle.
 */
export function harmony(anchor: Oklch, candidate: Oklch): HarmonyResult {
  if (anchor.h === undefined || candidate.h === undefined) {
    return { score: 0.8, relation: 'neutral', deltaDeg: undefined, separationDeg: undefined };
  }

  let best = { delta: Infinity, relation: 'monochrome' as HarmonyRelation };
  for (const { offset, relation } of HARMONY_TARGETS) {
    const delta = hueDistance(candidate.h, anchor.h + offset);
    if (delta < best.delta) best = { delta, relation };
  }

  const score = Math.exp(-((best.delta / TUNING.HARMONY_SIGMA_DEG) ** 2));
  return {
    score,
    relation: best.relation,
    deltaDeg: best.delta,
    separationDeg: hueDistance(candidate.h, anchor.h),
  };
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------
// Aesthetic terms
// ---------------------------------------------------------------------------

export function styleFit(material: Material, style: StylePreset | undefined): number {
  if (!style || style.styleTags.length === 0) return 0;
  const wanted = new Set(style.styleTags);
  let hits = 0;
  for (const tag of material.styleTags) if (wanted.has(tag)) hits++;
  return hits / wanted.size;
}

export function styleHits(material: Material, style: StylePreset | undefined): number {
  if (!style) return 0;
  const wanted = new Set(style.styleTags);
  return material.styleTags.filter((t) => wanted.has(t)).length;
}

/** Tonal SEPARATION from the anchor: 1 means a full light/dark contrast. */
export function tone(anchor: Oklch, candidate: Oklch): number {
  return clamp01(Math.abs(candidate.L - anchor.L) / TUNING.TONE_SPAN);
}

/** Chroma AGREEMENT with the anchor: 1 means equally saturated. */
export function chromaAgreement(anchor: Oklch, candidate: Oklch): number {
  return 1 - clamp01(Math.abs(candidate.C - anchor.C) / TUNING.CHROMA_SPAN);
}

// ---------------------------------------------------------------------------
// Cost-efficiency terms
// ---------------------------------------------------------------------------

/**
 * The price a buyer actually pays per usable unit. Quoting the shelf price
 * ignores that a 12%-wastage tile costs 12% more than the shelf says to cover
 * the same square metre — which is precisely the comparison the user wants.
 */
export function effectivePrice(m: Material): number {
  return m.pricePerUnit * (1 + m.wastageFactor);
}

/**
 * How much of the pricing unit one square metre of finished surface consumes.
 * 1 for anything already priced per m²; for paint it is `coats / coverage`,
 * the same conversion the cost engine uses.
 */
export function unitsPerSqm(m: Material): number {
  if (m.unit !== 'LITER') return 1;
  return (m.coatsRecommended ?? 2) / (m.coveragePerUnit ?? 10);
}

/**
 * Effective price per square metre of finished surface — the only basis on
 * which two materials can honestly be compared.
 *
 * A litre of emulsion at $11 and a square metre of tile at $34 are not a 3x
 * difference: the litre covers 11 m² over two coats, so the paint is about
 * $2.10 per m² and the tile roughly eighteen times dearer. Ranking on
 * `pricePerUnit` alone silently compares litres with square metres and gets
 * every paint-versus-tile question backwards.
 */
export function effectiveCostPerSqm(m: Material): number {
  return effectivePrice(m) * unitsPerSqm(m);
}

export function quality(m: Material): number {
  const w = TUNING.QUALITY_WEIGHTS;
  return (
    w.durability * (m.durabilityScore / 5) +
    w.aesthetic * (m.aestheticScore / 5) +
    w.sustainability * (m.sustainabilityScore / 5)
  );
}

export interface CategoryStats {
  logMin: number;
  logMax: number;
}

/**
 * Price statistics computed over the **category-wide** population — every
 * material of that category in the catalog, not the filtered result set.
 *
 * This matters more than it looks. Normalising over the filtered set means the
 * same material scores 0.9 in one query and 0.4 in another purely because an
 * unrelated filter changed the min and max. Users read that as a bug, and they
 * are right to.
 *
 * Prices are logged first because material price distributions are strongly
 * right-skewed: one luxury marble at 165 next to a cluster of 26-46 would
 * otherwise squash the entire cluster into the bottom few percent of the range.
 */
export function buildCategoryStats(materials: Material[]): Map<string, CategoryStats> {
  const byCategory = new Map<string, Material[]>();
  for (const m of materials) {
    const bucket = byCategory.get(m.category);
    if (bucket) bucket.push(m);
    else byCategory.set(m.category, [m]);
  }

  const stats = new Map<string, CategoryStats>();
  for (const [category, group] of byCategory) {
    const logs = group.map((m) => Math.log(Math.max(effectiveCostPerSqm(m), 1e-6)));
    stats.set(category, { logMin: Math.min(...logs), logMax: Math.max(...logs) });
  }
  return stats;
}

/**
 * Min-max of log(price) within the category, floored at `PRICE_FLOOR` so that
 * the cheapest material in a category yields a large-but-finite value rather
 * than dividing by zero.
 */
export function normLogWith(price: number, logMin: number, logMax: number): number {
  const span = logMax - logMin;
  const t = span > 1e-9 ? (Math.log(Math.max(price, 1e-6)) - logMin) / span : 0;
  return TUNING.PRICE_FLOOR + (1 - TUNING.PRICE_FLOOR) * clamp01(t);
}

/**
 * `value = Quality / normLog(EffPrice)`, rescaled onto [0,1].
 *
 * The rescaling divisor is the fixed theoretical maximum (`1 / PRICE_FLOOR`),
 * NOT a min-max over the candidates. Min-maxing the value itself would pin the
 * best member of every category at exactly 1.0, which makes a cheap tile and a
 * cheap plank indistinguishable and makes the number meaningless across
 * categories. A fixed divisor keeps the score absolute: 0.8 means the same
 * thing for tile as for flooring, and it does not move when the result set does.
 */
export function costEfficiency(m: Material, stats: Map<string, CategoryStats>): number {
  const s = stats.get(m.category);
  if (!s) return 0.5;
  const value = quality(m) / normLogWith(effectiveCostPerSqm(m), s.logMin, s.logMax);
  return clamp01(value * TUNING.PRICE_FLOOR);
}

// ---------------------------------------------------------------------------
// Scoring a candidate
// ---------------------------------------------------------------------------

export interface Terms {
  harmony: number;
  styleFit: number;
  tone: number;
  chroma: number;
  aesthetic: number;
}

export interface Candidate {
  material: Material;
  surface: Surface;
  terms: Terms;
  aestheticScore: number;
  costScore: number;
  score: number;
  harmonyDetail: HarmonyResult;
  /** Present only when an anchor material exists for this surface. */
  anchor?: Material;
  /**
   * True when the anchor is the user's OWN current choice, false when it came
   * from the style preset. Only a user's choice can be "replaced", and only a
   * user's choice can be called "yours" in the reason text.
   */
  anchorIsUserChoice: boolean;
  deltaE?: number;
  lookAlike: boolean;
  savings?: number;
  savingsPct?: number;
}

export function aestheticScoreOf(terms: Terms): number {
  const w = TUNING.AESTHETIC_WEIGHTS;
  return (
    w.harmony * terms.harmony +
    w.styleFit * terms.styleFit +
    w.tone * terms.tone +
    w.chroma * terms.chroma +
    w.aesthetic * terms.aesthetic
  );
}

export function combine(mode: SuggestionMode, aesthetic: number, cost: number): number {
  switch (mode) {
    case 'AESTHETIC':
      return aesthetic;
    case 'COST_EFFICIENCY':
      return cost;
    case 'BALANCED':
      return 0.5 * aesthetic + 0.5 * cost;
  }
}

// ---------------------------------------------------------------------------
// Reason text
// ---------------------------------------------------------------------------

const UNIT_LABEL: Record<Unit, string> = {
  SQM: 'm²',
  LITER: 'litre',
  LINEAR_M: 'linear m',
  EACH: 'item',
};

function durabilityPhrase(candidate: Material, anchor: Material): string {
  const delta = candidate.durabilityScore - anchor.durabilityScore;
  if (delta > 0) return 'and wears better';
  if (delta === 0) return 'at the same durability';
  return `for ${Math.abs(delta)} point${Math.abs(delta) > 1 ? 's' : ''} less durability`;
}

/**
 * Builds the human-readable justification from whichever terms actually
 * carried the ranking. "Cheaper" on its own is not advice; the point is to say
 * cheaper *than what*, *by how much*, and *at what cost to the other axes*.
 */
export function buildReason(c: Candidate, mode: SuggestionMode, style?: StylePreset): string {
  const m = c.material;
  const parts: { weight: number; text: string }[] = [];
  const unit = UNIT_LABEL[m.unit];
  /** "your oak floor" only when it really is theirs; otherwise name the style. */
  const ref = (anchor: Material): string =>
    c.anchorIsUserChoice
      ? `your ${anchor.name.toLowerCase()}`
      : `the ${(style?.name ?? 'reference').toLowerCase()} ${anchor.name.toLowerCase()}`;

  // A candidate that IS the anchor compares perfectly with itself, which says
  // nothing. Name it for what it is instead of pretending it harmonises.
  if (c.anchor && c.anchor.id === m.id) {
    return (
      `The ${(style?.name ?? 'reference').toLowerCase()} palette's own pick for this surface` +
      (styleHits(m, style) > 0 && style
        ? ` · matches ${styleHits(m, style)} of ${style.styleTags.length} '${style.name.toLowerCase()}' tags`
        : '') +
      ` · ${m.durabilityScore}/5 durability at ${m.pricePerUnit.toFixed(2)} per ${unit}`
    );
  }

  // --- colour -------------------------------------------------------------
  if (c.anchor && c.harmonyDetail.relation !== 'neutral' && c.harmonyDetail.separationDeg !== undefined) {
    const sep = Math.round(c.harmonyDetail.separationDeg);
    const anchorName = ref(c.anchor);
    const text =
      c.harmonyDetail.relation === 'monochrome'
        ? `Sits within ${sep}° of ${anchorName} (monochrome)`
        : `Hue sits ${sep}° from ${anchorName} (${c.harmonyDetail.relation})`;
    parts.push({ weight: TUNING.AESTHETIC_WEIGHTS.harmony * c.terms.harmony, text });
  } else if (c.anchor && c.harmonyDetail.relation === 'neutral') {
    parts.push({
      weight: TUNING.AESTHETIC_WEIGHTS.harmony * c.terms.harmony * 0.6,
      text: `Near-neutral colour, so it sits with ${ref(c.anchor)} without competing`,
    });
  }

  // --- style --------------------------------------------------------------
  if (style && style.styleTags.length > 0) {
    const hits = styleHits(m, style);
    if (hits > 0) {
      parts.push({
        weight: TUNING.AESTHETIC_WEIGHTS.styleFit * c.terms.styleFit,
        text: `matches ${hits} of ${style.styleTags.length} '${style.name.toLowerCase()}' tags`,
      });
    }
  }

  // --- tone / chroma ------------------------------------------------------
  if (c.anchor) {
    if (c.terms.tone > 0.55) {
      parts.push({
        weight: TUNING.AESTHETIC_WEIGHTS.tone * c.terms.tone,
        text: `gives strong light/dark contrast against ${ref(c.anchor)}`,
      });
    } else if (c.terms.tone < 0.2) {
      parts.push({
        weight: TUNING.AESTHETIC_WEIGHTS.tone * 0.5,
        text: `stays in the same tonal band as ${ref(c.anchor)}`,
      });
    }
    if (c.terms.chroma > 0.85) {
      parts.push({
        weight: TUNING.AESTHETIC_WEIGHTS.chroma * c.terms.chroma,
        text: 'carries the same colour intensity',
      });
    }
  }

  // --- money --------------------------------------------------------------
  if (c.savingsPct !== undefined && c.savingsPct > 0 && c.anchor) {
    // "per m² covered", not "per unit": the comparison is on finished surface,
    // so it stays true even when a litre of paint is up against a tile.
    const money = `${Math.round(c.savingsPct)}% cheaper per m² covered ${durabilityPhrase(m, c.anchor)}`;
    // In AESTHETIC mode price is context, not the argument — it should only
    // make the list when nothing visual outranks it.
    parts.push({
      weight: mode === 'AESTHETIC' ? 0.15 * c.costScore : 0.6 * c.costScore + 0.25,
      text: money,
    });
  } else if (mode !== 'AESTHETIC') {
    parts.push({
      weight: 0.5 * c.costScore,
      text:
        `scores ${Math.round(c.costScore * 100)}/100 on value — ` +
        `${m.durabilityScore}/5 durability and ${m.sustainabilityScore}/5 sustainability ` +
        `at ${m.pricePerUnit.toFixed(2)} per ${unit} (${Math.round(m.wastageFactor * 100)}% wastage)`,
    });
  }

  // --- intrinsic ----------------------------------------------------------
  if (m.aestheticScore >= 5) {
    parts.push({ weight: TUNING.AESTHETIC_WEIGHTS.aesthetic * 1.0, text: 'top-rated finish (5/5)' });
  }
  if (m.sustainabilityScore >= 5) {
    parts.push({ weight: 0.08, text: 'best-in-class sustainability (5/5)' });
  }

  const ordered = parts.sort((a, b) => b.weight - a.weight).slice(0, 3);
  if (ordered.length === 0) {
    // Never return an empty reason — the contract says so, and a blank
    // justification is worse than a dull one.
    return `${m.name}: ${m.tier.toLowerCase()} ${m.category.toLowerCase().replace('_', ' ')} at ${m.pricePerUnit.toFixed(2)} per ${unit}`;
  }

  const lead =
    c.lookAlike && c.anchor ? `Reads as the same colour as ${ref(c.anchor)} · ` : '';
  const text = ordered.map((p) => p.text).join(' · ');
  return lead + text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Applying suggestions to a project (for projectedTotal and budget trimming)
// ---------------------------------------------------------------------------

export function applyToProject(project: Project, picks: Map<Surface, string>): Project {
  const next: Project = structuredClone(project);
  for (const floor of next.floors) {
    for (const room of floor.rooms) {
      const f = picks.get('FLOOR');
      const c = picks.get('CEILING');
      if (f && room.floorMaterialId) room.floorMaterialId = f;
      if (c && room.ceilingMaterialId) room.ceilingMaterialId = c;
    }
    for (const wall of floor.walls) {
      const w = picks.get('WALL');
      const e = picks.get('EXTERIOR_WALL');
      if (w && wall.interiorMaterialId) wall.interiorMaterialId = w;
      if (e && wall.exterior && wall.exteriorMaterialId) wall.exteriorMaterialId = e;
    }
  }
  const r = picks.get('ROOF');
  if (r && next.roof?.materialId) next.roof.materialId = r;
  return next;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface SuggestOptions {
  limitPerSurface?: number;
}

/** Picks the style preset with the most tag overlap with the current choices. */
function inferStyle(catalog: Catalog, current: Partial<Record<Surface, string>>): StylePreset | undefined {
  const byId = new Map(catalog.materials.map((m) => [m.id, m]));
  const tags = new Set<string>();
  for (const id of Object.values(current)) {
    const m = id ? byId.get(id) : undefined;
    if (m) for (const t of m.styleTags) tags.add(t);
  }
  if (tags.size === 0) return catalog.styles[0];
  let best: { style: StylePreset; hits: number } | undefined;
  for (const style of catalog.styles) {
    const hits = style.styleTags.filter((t) => tags.has(t)).length;
    if (!best || hits > best.hits) best = { style, hits };
  }
  return best?.style;
}

export function suggest(
  request: SuggestionRequest,
  catalog: Catalog,
  options: SuggestOptions = {},
): SuggestionResponse & { exclusions: { surface: Surface; materialId: string; reason: string }[] } {
  const limit = options.limitPerSurface ?? TUNING.DEFAULT_LIMIT_PER_SURFACE;
  const byId = new Map(catalog.materials.map((m) => [m.id, m]));
  const current = request.current ?? {};

  const style = request.styleId
    ? catalog.styles.find((s) => s.id === request.styleId)
    : inferStyle(catalog, current);

  const surfaces = request.surfaces?.length ? request.surfaces : ALL_SURFACES;
  const stats = buildCategoryStats(catalog.materials);

  const exclusions: { surface: Surface; materialId: string; reason: string }[] = [];
  const perSurface = new Map<Surface, Candidate[]>();

  for (const surface of surfaces) {
    // --- anchor ---------------------------------------------------------
    const currentId = current[surface];
    const anchorMaterial =
      (currentId ? byId.get(currentId) : undefined) ??
      (style?.recommended[surface] ? byId.get(style.recommended[surface]!) : undefined);
    const anchorColor = anchorMaterial
      ? oklchOf(anchorMaterial.color.hex)
      : style?.palette[0]
        ? oklchOf(style.palette[0])
        : { L: 0.7, C: 0, h: undefined };
    const anchorIsUserChoice = Boolean(currentId && anchorMaterial?.id === currentId);
    const anchorLab = anchorMaterial ? toOklab(anchorMaterial.color.hex) : undefined;
    const anchorEffPrice = anchorMaterial ? effectiveCostPerSqm(anchorMaterial) : undefined;

    const scored: Candidate[] = [];

    for (const material of catalog.materials) {
      // --- GATE: hard constraint, evaluated before and outside scoring ---
      if (!material.applicableSurfaces.includes(surface)) {
        exclusions.push({
          surface,
          materialId: material.id,
          reason: `not applicable to ${surface} (valid: ${material.applicableSurfaces.join(', ')})`,
        });
        continue;
      }
      // Suggesting what the user already chose is not a suggestion.
      if (material.id === currentId) continue;

      const color = oklchOf(material.color.hex);
      const h = harmony(anchorColor, color);
      const terms: Terms = {
        harmony: h.score,
        styleFit: styleFit(material, style),
        tone: tone(anchorColor, color),
        chroma: chromaAgreement(anchorColor, color),
        aesthetic: material.aestheticScore / 5,
      };

      const aesthetic = aestheticScoreOf(terms);
      const cost = costEfficiency(material, stats);

      const candidate: Candidate = {
        material,
        surface,
        terms,
        aestheticScore: aesthetic,
        costScore: cost,
        score: combine(request.mode, aesthetic, cost),
        harmonyDetail: h,
        ...(anchorMaterial ? { anchor: anchorMaterial } : {}),
        anchorIsUserChoice,
        lookAlike: false,
      };

      // --- cheaper look-alike test ---------------------------------------
      // Savings and look-alikes are only meaningful against something the
      // user actually chose. A style preset's recommendation replaces nothing.
      if (anchorIsUserChoice && anchorMaterial && anchorLab && anchorEffPrice !== undefined) {
        const lab = toOklab(material.color.hex);
        const deltaE = lab ? oklabDistance(anchorLab, lab) : Infinity;
        const eff = effectiveCostPerSqm(material);
        candidate.deltaE = deltaE;
        if (eff < anchorEffPrice) {
          candidate.savings = anchorEffPrice - eff;
          candidate.savingsPct = ((anchorEffPrice - eff) / anchorEffPrice) * 100;
        }
        candidate.lookAlike =
          deltaE <= TUNING.LOOKALIKE_DELTA_E &&
          material.durabilityScore >=
            anchorMaterial.durabilityScore - TUNING.LOOKALIKE_MAX_DURABILITY_DROP &&
          eff < anchorEffPrice;
      }

      scored.push(candidate);
    }

    scored.sort((a, b) => b.score - a.score || a.material.pricePerUnit - b.material.pricePerUnit);
    perSurface.set(surface, scored.slice(0, limit));
  }

  // --- money figures --------------------------------------------------------
  let currentTotal: number | undefined;
  let projectedTotal: number | undefined;
  const picks = new Map<Surface, string>();
  for (const [surface, list] of perSurface) if (list[0]) picks.set(surface, list[0].material.id);

  if (request.project) {
    currentTotal = estimateCost(request.project, catalog).total;
    projectedTotal = estimateCost(applyToProject(request.project, picks), catalog).total;

    // --- budget: trim toward the cap -------------------------------------
    // Greedy, and deliberately so: swap in the cheapest still-ranked option on
    // whichever surface saves the most, until the projection fits or we run
    // out of moves. An exact knapsack here would be slower and no more
    // defensible, because the scores it optimises are themselves estimates.
    if (request.budget !== undefined && projectedTotal > request.budget) {
      const moves = [...perSurface.entries()]
        .flatMap(([surface, list]) =>
          list.map((c) => ({ surface, c, price: effectiveCostPerSqm(c.material) })),
        )
        .sort((a, b) => a.price - b.price);
      for (const move of moves) {
        if (projectedTotal <= request.budget) break;
        if (picks.get(move.surface) === move.c.material.id) continue;
        const trial = new Map(picks);
        trial.set(move.surface, move.c.material.id);
        const total = estimateCost(applyToProject(request.project, trial), catalog).total;
        if (total < projectedTotal) {
          picks.set(move.surface, move.c.material.id);
          projectedTotal = total;
        }
      }
      // Re-rank so the chosen material leads its surface's list.
      for (const [surface, list] of perSurface) {
        const chosen = picks.get(surface);
        const idx = list.findIndex((c) => c.material.id === chosen);
        if (idx > 0) perSurface.set(surface, [list[idx]!, ...list.filter((_, i) => i !== idx)]);
      }
    }
  }

  // --- shape the response ---------------------------------------------------
  const items: SuggestionItem[] = [];
  for (const [surface, list] of perSurface) {
    for (const c of list) {
      const m = c.material;
      items.push({
        surface,
        materialId: m.id,
        materialName: m.name,
        reason: buildReason(c, request.mode, style),
        score: round3(c.score),
        unitPrice: m.pricePerUnit,
        unit: m.unit,
        ...(c.anchor && c.anchorIsUserChoice
          ? { replaces: c.anchor.id, replacesName: c.anchor.name }
          : {}),
        ...(c.savings !== undefined ? { estimatedSavings: round2(c.savings) } : {}),
        ...(c.savingsPct !== undefined ? { estimatedSavingsPct: round2(c.savingsPct) } : {}),
        breakdown: {
          styleMatch: round3(c.terms.styleFit),
          colorHarmony: round3(c.terms.harmony),
          value: round3(c.costScore),
          durability: round3(m.durabilityScore / 5),
          sustainability: round3(m.sustainabilityScore / 5),
        },
      });
    }
  }

  return {
    mode: request.mode,
    ...(style ? { styleId: style.id } : {}),
    items,
    note: buildNote(request, items, perSurface, currentTotal, projectedTotal),
    ...(currentTotal !== undefined ? { currentTotal: round2(currentTotal) } : {}),
    ...(projectedTotal !== undefined ? { projectedTotal: round2(projectedTotal) } : {}),
    exclusions,
  };
}

function buildNote(
  request: SuggestionRequest,
  items: SuggestionItem[],
  perSurface: Map<Surface, Candidate[]>,
  currentTotal?: number,
  projectedTotal?: number,
): string {
  if (items.length === 0) {
    return 'No material in the catalog can be applied to the requested surfaces.';
  }

  const lookAlikes = [...perSurface.values()].flat().filter((c) => c.lookAlike);
  const bits: string[] = [];

  if (currentTotal !== undefined && projectedTotal !== undefined) {
    const delta = currentTotal - projectedTotal;
    const pct = currentTotal > 0 ? (delta / currentTotal) * 100 : 0;
    bits.push(
      delta > 0
        ? `Applying the top pick on every surface saves ${fmt(delta)} (${pct.toFixed(0)}%) off a buffered total of ${fmt(currentTotal)}.`
        : delta < 0
          ? `Applying the top pick on every surface adds ${fmt(-delta)} (${Math.abs(pct).toFixed(0)}%) to a buffered total of ${fmt(currentTotal)}.`
          : `Applying the top pick on every surface leaves the buffered total at ${fmt(currentTotal)}.`,
    );
    if (request.budget !== undefined) {
      bits.push(
        projectedTotal <= request.budget
          ? `Fits the ${fmt(request.budget)} budget.`
          : `Still ${fmt(projectedTotal - request.budget)} over the ${fmt(request.budget)} budget after trimming.`,
      );
    }
  }

  if (lookAlikes.length > 0) {
    const best = lookAlikes.reduce((a, b) => ((b.savingsPct ?? 0) > (a.savingsPct ?? 0) ? b : a));
    bits.push(
      `${lookAlikes.length} cheaper look-alike${lookAlikes.length > 1 ? 's' : ''} found; ` +
        `best is ${best.material.name} at ${(best.savingsPct ?? 0).toFixed(0)}% less per m² covered with no meaningful colour shift.`,
    );
  }

  if (bits.length === 0) {
    const label =
      request.mode === 'AESTHETIC'
        ? 'visual fit'
        : request.mode === 'COST_EFFICIENCY'
          ? 'quality per logged dollar'
          : 'an even split of looks and value';
    bits.push(`Ranked ${items.length} options by ${label}. Prices are material supply only.`);
  }

  return bits.join(' ');
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const fmt = (v: number): string =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
