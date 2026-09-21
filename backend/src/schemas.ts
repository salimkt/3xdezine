/**
 * Zod mirrors of `shared/types.ts`.
 *
 * One declaration per shape drives three things at once: request validation,
 * response serialization, and the OpenAPI document. That is the whole point of
 * routing them through `fastify-type-provider-zod` — a schema that only
 * documents, or only validates, drifts.
 *
 * Zod 4 note: `z.date()` has no JSON Schema representation, so timestamps
 * cross the API boundary as `z.iso.datetime()` strings (UTC, `Z`-suffixed).
 */

import { z } from 'zod';

import type {
  ApiError,
  Catalog,
  ComponentProduct,
  CostBreakdown,
  Material,
  Project,
  StylePreset,
  SuggestionRequest,
  SuggestionResponse,
} from '../../shared/types.ts';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SurfaceSchema = z
  .enum(['FLOOR', 'WALL', 'CEILING', 'EXTERIOR_WALL', 'ROOF'])
  .describe('A finishable surface of the building.');

export const MaterialCategorySchema = z.enum([
  'FLOORING',
  'TILE',
  'PAINT',
  'WALL_FINISH',
  'CEILING',
  'EXTERIOR_SIDING',
  'ROOFING',
]);

export const UnitSchema = z
  .enum(['SQM', 'LITER', 'LINEAR_M', 'EACH'])
  .describe('Pricing unit. The cost engine converts measured areas into this.');

export const TierSchema = z.enum(['BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY']);

export const ComponentTypeSchema = z.enum([
  'DOOR',
  'WINDOW',
  'CABINET',
  'LIGHT',
  'FURNITURE',
]);

export const SuggestionModeSchema = z.enum([
  'AESTHETIC',
  'COST_EFFICIENCY',
  'BALANCED',
]);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const score = z.number().int().min(1).max(5);

export const ColorInfoSchema = z.object({
  name: z.string(),
  hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'expected a 6-digit hex colour, e.g. "#C8A165"'),
});

export const TextureInfoSchema = z.object({
  pattern: z.string(),
  assetHint: z.string(),
  tileSizeM: z.number().positive().describe('Real-world size of one texture repeat, in metres.'),
});

export const PbrInfoSchema = z.object({
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
});

export const MaterialSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: MaterialCategorySchema,
    subtype: z.string(),
    description: z.string(),
    color: ColorInfoSchema,
    texture: TextureInfoSchema,
    pbr: PbrInfoSchema,
    unit: UnitSchema,
    pricePerUnit: z.number().nonnegative(),
    wastageFactor: z.number().min(0).max(1),
    finish: z.string(),
    tier: TierSchema,
    durabilityScore: score,
    sustainabilityScore: score,
    aestheticScore: score,
    styleTags: z.array(z.string()),
    applicableSurfaces: z.array(SurfaceSchema),
    coveragePerUnit: z.number().positive().optional(),
    coatsRecommended: z.number().int().positive().optional(),
    packSize: z
      .number()
      .positive()
      .optional()
      .describe('Smallest purchasable increment, in `unit`. Omitted for continuous measure.'),
    packLabel: z.string().optional(),
  })
  .meta({ id: 'Material' });

export const ComponentProductSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: ComponentTypeSchema,
    description: z.string(),
    color: ColorInfoSchema,
    price: z.number().nonnegative(),
    widthM: z.number().positive(),
    heightM: z.number().positive(),
    depthM: z.number().positive(),
    styleTags: z.array(z.string()),
    modelKind: z.string(),
  })
  .meta({ id: 'ComponentProduct' });

export const StylePresetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    styleTags: z.array(z.string()),
    palette: z.array(z.string()),
    recommended: z.partialRecord(SurfaceSchema, z.string()),
  })
  .meta({ id: 'StylePreset' });

export const CatalogSchema = z
  .object({
    meta: z.object({
      version: z.string(),
      baseCurrency: z.string(),
      priceBasis: z.string(),
      units: z.record(z.string(), z.string()),
      scoring: z.string(),
      // Provenance for every seeded price. Omitting this from the schema makes
      // Zod strip it from the response, which would quietly hide where the
      // numbers came from — the opposite of what a cost tool should do.
      priceSources: z
        .array(
          z.object({
            name: z.string(),
            url: z.string().optional(),
            anchored: z.string().optional(),
          }),
        )
        .optional(),
    }),
    materials: z.array(MaterialSchema),
    components: z.array(ComponentProductSchema),
    styles: z.array(StylePresetSchema),
  })
  .meta({ id: 'Catalog' });

// ---------------------------------------------------------------------------
// Project geometry
// ---------------------------------------------------------------------------

export const Vec2Schema = z
  .object({ x: z.number(), z: z.number() })
  .describe('A point on the floor plane, in metres. Y is up, so the plan is XZ.');

export const WallSchema = z.object({
  id: z.string(),
  start: Vec2Schema,
  end: Vec2Schema,
  heightM: z.number().positive(),
  thicknessM: z.number().positive(),
  exterior: z.boolean(),
  interiorMaterialId: z.string().optional(),
  exteriorMaterialId: z.string().optional(),
});

export const OpeningSchema = z.object({
  id: z.string(),
  wallId: z.string(),
  componentId: z.string().optional(),
  t: z.number().min(0).max(1).describe('Centre of the opening along the wall, 0..1.'),
  widthM: z.number().positive(),
  heightM: z.number().positive(),
  sillM: z.number().min(0),
});

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z
    .array(Vec2Schema)
    .min(3)
    .describe('Closed loop; the first point is NOT repeated.'),
  ceilingHeightM: z.number().positive(),
  floorMaterialId: z.string().optional(),
  ceilingMaterialId: z.string().optional(),
});

export const PlacedComponentSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  position: Vec2Schema,
  rotationDeg: z.number(),
});

export const FloorSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int(),
  walls: z.array(WallSchema),
  rooms: z.array(RoomSchema),
  openings: z.array(OpeningSchema),
  components: z.array(PlacedComponentSchema),
});

export const RoofSpecSchema = z.object({
  kind: z.enum(['GABLE', 'HIP', 'FLAT']),
  pitchDeg: z.number().min(0).max(85),
  overhangM: z.number().min(0),
  materialId: z.string().optional(),
});

export const ProjectSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    currency: z.string(),
    unitSystem: z.enum(['metric', 'imperial']),
    contingencyBuffer: z.number().min(0).max(1),
    floors: z.array(FloorSchema),
    roof: RoofSpecSchema.optional(),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'Project' });

/** What `GET /projects` returns: metadata without the geometry payload. */
export const ProjectSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    unitSystem: z.enum(['metric', 'imperial']),
    contingencyBuffer: z.number(),
    floorCount: z.number().int(),
    roomCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ProjectSummary' });

// ---------------------------------------------------------------------------
// Cost engine
// ---------------------------------------------------------------------------

export const CostLineItemSchema = z.object({
  surface: z.union([SurfaceSchema, z.literal('COMPONENT')]),
  materialId: z.string(),
  materialName: z.string(),
  location: z.string(),
  rawQuantity: z.number(),
  unit: UnitSchema,
  wastageFactor: z.number(),
  bufferedQuantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
});

export const CostBreakdownSchema = z
  .object({
    currency: z.string(),
    lineItems: z.array(CostLineItemSchema),
    materialsSubtotal: z.number(),
    contingencyBuffer: z.number(),
    contingencyAmount: z.number(),
    total: z.number(),
    perSurface: z.record(z.string(), z.number()),
    quantities: z.object({
      floorAreaSqm: z.number(),
      wallAreaSqm: z.number(),
      ceilingAreaSqm: z.number(),
      exteriorWallAreaSqm: z.number(),
      roofAreaSqm: z.number(),
      openingAreaSqm: z.number(),
    }),
  })
  .meta({ id: 'CostBreakdown' });

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

export const SuggestionRequestSchema = z
  .object({
    mode: SuggestionModeSchema,
    styleId: z.string().optional(),
    budget: z.number().positive().optional(),
    surfaces: z.array(SurfaceSchema).optional(),
    current: z.partialRecord(SurfaceSchema, z.string()).optional(),
    project: ProjectSchema.optional(),
    /** Not in the shared contract; a pure convenience cap on list length. */
    limitPerSurface: z.number().int().min(1).max(24).optional(),
  })
  .meta({ id: 'SuggestionRequest' });

export const SuggestionBreakdownSchema = z.object({
  styleMatch: z.number(),
  colorHarmony: z.number(),
  value: z.number(),
  durability: z.number(),
  sustainability: z.number(),
});

export const SuggestionItemSchema = z
  .object({
    surface: SurfaceSchema,
    materialId: z.string(),
    materialName: z.string(),
    reason: z.string().min(1),
    score: z.number(),
    unitPrice: z.number(),
    unit: UnitSchema,
    replaces: z.string().optional(),
    replacesName: z.string().optional(),
    estimatedSavings: z.number().optional(),
    estimatedSavingsPct: z.number().optional(),
    breakdown: SuggestionBreakdownSchema,
  })
  .meta({ id: 'SuggestionItem' });

/** A candidate that never reached scoring, and why. Gates are not scores. */
export const SuggestionExclusionSchema = z.object({
  surface: SurfaceSchema,
  materialId: z.string(),
  reason: z.string(),
});

export const SuggestionResponseSchema = z
  .object({
    mode: SuggestionModeSchema,
    styleId: z.string().optional(),
    items: z.array(SuggestionItemSchema),
    note: z.string(),
    projectedTotal: z.number().optional(),
    currentTotal: z.number().optional(),
    /** Extension: gated-out candidates, so the UI can say why nothing matched. */
    exclusions: z.array(SuggestionExclusionSchema).optional(),
  })
  .meta({ id: 'SuggestionResponse' });

// ---------------------------------------------------------------------------
// Envelope + queries
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .meta({ id: 'ApiError' });

export const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    db: z.enum(['up', 'down']),
  })
  .meta({ id: 'Health' });

export const MaterialQuerySchema = z.object({
  category: MaterialCategorySchema.optional(),
  surface: SurfaceSchema.optional(),
  tier: TierSchema.optional(),
  style: z.string().optional().describe('A style tag, or a StylePreset id.'),
  maxPrice: z.coerce.number().positive().optional(),
  q: z.string().optional().describe('Free text over name, description and subtype.'),
});

export const IdParamSchema = z.object({ id: z.string().min(1) });

// ---------------------------------------------------------------------------
// Contract conformance: these fail to compile if a schema drifts from
// shared/types.ts. They cost nothing at runtime.
// ---------------------------------------------------------------------------

type Conforms<Contract, Inferred extends Contract> = Inferred;

export type MaterialDto = Conforms<Material, z.infer<typeof MaterialSchema>>;
export type ComponentDto = Conforms<ComponentProduct, z.infer<typeof ComponentProductSchema>>;
export type StyleDto = Conforms<StylePreset, z.infer<typeof StylePresetSchema>>;
export type CatalogDto = Conforms<Catalog, z.infer<typeof CatalogSchema>>;
export type ProjectDto = Conforms<Project, z.infer<typeof ProjectSchema>>;
export type CostBreakdownDto = Conforms<CostBreakdown, z.infer<typeof CostBreakdownSchema>>;
export type SuggestionRequestDto = Conforms<
  SuggestionRequest,
  Omit<z.infer<typeof SuggestionRequestSchema>, 'limitPerSurface'>
>;
export type SuggestionResponseDto = Conforms<
  SuggestionResponse,
  Omit<z.infer<typeof SuggestionResponseSchema>, 'exclusions'>
>;
export type ApiErrorDto = Conforms<ApiError, z.infer<typeof ApiErrorSchema>>;
export type ProjectSummaryDto = z.infer<typeof ProjectSummarySchema>;
export type SuggestionItemDto = z.infer<typeof SuggestionItemSchema>;
export type MaterialQueryDto = z.infer<typeof MaterialQuerySchema>;
