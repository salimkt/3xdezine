/**
 * 3xDezine — shared domain contract.
 *
 * This file is the single source of truth for the data model shared by the
 * backend, the web client, and (mirrored as Kotlin data classes) the Android
 * client. Changing a shape here means changing it in all three places.
 *
 * Conventions:
 *  - All lengths are METRES. All areas are SQUARE METRES.
 *  - The floor plane is XZ (x = east, z = south). Y is up, matching glTF/three.js.
 *  - Money is a plain number in `Catalog.meta.baseCurrency` minor-unit-agnostic
 *    decimal form (e.g. 86.0 = $86.00). Currency conversion is a display concern.
 */

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type Surface = 'FLOOR' | 'WALL' | 'CEILING' | 'EXTERIOR_WALL' | 'ROOF';

export type MaterialCategory =
  | 'FLOORING'
  | 'TILE'
  | 'PAINT'
  | 'WALL_FINISH'
  | 'CEILING'
  | 'EXTERIOR_SIDING'
  | 'ROOFING';

/** Pricing unit. Quantities are converted into this unit by the cost engine. */
export type Unit = 'SQM' | 'LITER' | 'LINEAR_M' | 'EACH';

export type Tier = 'BUDGET' | 'STANDARD' | 'PREMIUM' | 'LUXURY';

export interface ColorInfo {
  name: string;
  /** Uppercase 6-digit hex, e.g. "#C8A165". */
  hex: string;
}

/**
 * Describes how a material is textured. `pattern` selects a renderer-side
 * material recipe; `assetHint` is the search term used by the texture fetch
 * script to resolve a real CC0 PBR map set. `tileSizeM` is the real-world size
 * of one texture repeat, which is what keeps scale believable across surfaces.
 */
export interface TextureInfo {
  pattern: string;
  assetHint: string;
  tileSizeM: number;
}

export interface PbrInfo {
  /** 0 = mirror, 1 = fully diffuse. */
  roughness: number;
  /** 0 for dielectrics (almost everything), ~1 for bare metal. */
  metalness: number;
}

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  subtype: string;
  description: string;
  color: ColorInfo;
  texture: TextureInfo;
  pbr: PbrInfo;
  unit: Unit;
  pricePerUnit: number;
  /** Default cutting/overage allowance, 0..1. Applied before project contingency. */
  wastageFactor: number;
  finish: string;
  tier: Tier;
  /** All 1..5. */
  durabilityScore: number;
  sustainabilityScore: number;
  aestheticScore: number;
  styleTags: string[];
  applicableSurfaces: Surface[];

  /** Required when `unit` is LITER: square metres covered per litre, per coat. */
  coveragePerUnit?: number;
  /** Required when `unit` is LITER. */
  coatsRecommended?: number;

  /**
   * Smallest purchasable increment, in `unit`. Tile ships by the box, paint by
   * the can, flooring by the pack. When set, the cost engine rounds the
   * buffered quantity UP to a whole multiple of this — you cannot buy 23.4 m²
   * of tile if it comes in 1.44 m² boxes.
   *
   * Omit for materials genuinely sold by continuous measure.
   */
  packSize?: number;
  /** Human label for a pack, e.g. "box", "can", "pack". Display only. */
  packLabel?: string;
}

export type ComponentType = 'DOOR' | 'WINDOW' | 'CABINET' | 'LIGHT' | 'FURNITURE';

export interface ComponentProduct {
  id: string;
  name: string;
  type: ComponentType;
  description: string;
  color: ColorInfo;
  price: number;
  widthM: number;
  heightM: number;
  depthM: number;
  styleTags: string[];
  /** Renderer-side geometry recipe, e.g. "door-flush", "window-casement". */
  modelKind: string;
}

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  styleTags: string[];
  /** Hex swatches that define the look. */
  palette: string[];
  recommended: Partial<Record<Surface, string>>;
}

export interface Catalog {
  meta: {
    version: string;
    baseCurrency: string;
    priceBasis: string;
    units: Record<string, string>;
    scoring: string;
  };
  materials: Material[];
  components: ComponentProduct[];
  styles: StylePreset[];
}

// ---------------------------------------------------------------------------
// Project geometry
// ---------------------------------------------------------------------------

/** A point on the floor plane, in metres. */
export interface Vec2 {
  x: number;
  z: number;
}

export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  heightM: number;
  thicknessM: number;
  /** Exterior walls get `exteriorMaterialId` on their outward face and are load-bearing in the UI. */
  exterior: boolean;
  /** Finish on the inward face(s). */
  interiorMaterialId?: string;
  /** Finish on the outward face. Only meaningful when `exterior` is true. */
  exteriorMaterialId?: string;
}

/**
 * A hole in a wall. With a `componentId` it is a door or window; without one it
 * is a cased opening (a plain void, e.g. a kitchen pass-through).
 */
export interface Opening {
  id: string;
  wallId: string;
  componentId?: string;
  /** Position of the opening centre along the wall, 0..1 from `start` to `end`. */
  t: number;
  widthM: number;
  heightM: number;
  /** Height of the opening's bottom edge above the floor. 0 for doors. */
  sillM: number;
}

export interface Room {
  id: string;
  name: string;
  /** Ordered closed loop (do not repeat the first point). Counter-clockwise. */
  polygon: Vec2[];
  ceilingHeightM: number;
  floorMaterialId?: string;
  ceilingMaterialId?: string;
}

export interface PlacedComponent {
  id: string;
  componentId: string;
  position: Vec2;
  rotationDeg: number;
}

export interface Floor {
  id: string;
  name: string;
  /** 0 = ground floor. */
  level: number;
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  components: PlacedComponent[];
}

export interface RoofSpec {
  kind: 'GABLE' | 'HIP' | 'FLAT';
  pitchDeg: number;
  overhangM: number;
  materialId?: string;
}

export interface Project {
  id?: string;
  name: string;
  currency: string;
  unitSystem: 'metric' | 'imperial';
  /**
   * Project-wide contingency applied on top of per-material wastage, 0..1.
   * This is the "a bit buffered" safety margin on the headline total.
   */
  contingencyBuffer: number;
  floors: Floor[];
  roof?: RoofSpec;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Cost engine
// ---------------------------------------------------------------------------

export interface CostLineItem {
  surface: Surface | 'COMPONENT';
  materialId: string;
  materialName: string;
  /** Human-readable location, e.g. "Living Room — floor". */
  location: string;
  /** Measured quantity before wastage, in `unit`. */
  rawQuantity: number;
  unit: Unit;
  wastageFactor: number;
  /** rawQuantity * (1 + wastageFactor), rounded up to a purchasable amount. */
  bufferedQuantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface CostBreakdown {
  currency: string;
  lineItems: CostLineItem[];
  /** Sum of line items. Already includes per-material wastage. */
  materialsSubtotal: number;
  /** The project-wide contingency fraction that was applied. */
  contingencyBuffer: number;
  contingencyAmount: number;
  /** materialsSubtotal + contingencyAmount. The headline, buffered number. */
  total: number;
  /** Totals grouped by surface, for the cost breakdown chart. */
  perSurface: Record<string, number>;
  /** Measured areas, surfaced so the UI can sanity-check the estimate. */
  quantities: {
    floorAreaSqm: number;
    wallAreaSqm: number;
    ceilingAreaSqm: number;
    exteriorWallAreaSqm: number;
    roofAreaSqm: number;
    openingAreaSqm: number;
  };
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

export type SuggestionMode = 'AESTHETIC' | 'COST_EFFICIENCY' | 'BALANCED';

export interface SuggestionRequest {
  mode: SuggestionMode;
  /** A StylePreset id, or omit to infer the style from `current`. */
  styleId?: string;
  /** Optional cap on the buffered project total; the engine trims toward it. */
  budget?: number;
  /** Restrict suggestions to these surfaces. Defaults to all. */
  surfaces?: Surface[];
  /** What the user has chosen so far, per surface. */
  current?: Partial<Record<Surface, string>>;
  /** Supply a project to get money figures rather than unit-price figures. */
  project?: Project;
}

export interface SuggestionItem {
  surface: Surface;
  materialId: string;
  materialName: string;
  /** Plain-language justification shown in the UI. Never empty. */
  reason: string;
  /** 0..1 composite score from the engine. */
  score: number;
  unitPrice: number;
  unit: Unit;
  /** The material this would replace, when `current` was supplied. */
  replaces?: string;
  replacesName?: string;
  /** Positive = cheaper than what it replaces. */
  estimatedSavings?: number;
  estimatedSavingsPct?: number;
  /** Component scores, exposed so the UI can explain the ranking. */
  breakdown: {
    styleMatch: number;
    colorHarmony: number;
    value: number;
    durability: number;
    sustainability: number;
  };
}

export interface SuggestionResponse {
  mode: SuggestionMode;
  styleId?: string;
  items: SuggestionItem[];
  /** Summary line, e.g. "Saves $2,140 (18%) with no drop in durability." */
  note: string;
  projectedTotal?: number;
  currentTotal?: number;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface MaterialQuery {
  category?: MaterialCategory;
  surface?: Surface;
  tier?: Tier;
  style?: string;
  maxPrice?: number;
  q?: string;
}
