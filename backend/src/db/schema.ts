/**
 * Drizzle schema for 3xDezine.
 *
 * Design note: the catalog is relational because it is *queried* — the
 * `/materials` endpoint filters by category, surface, tier, style tag and
 * price, so those are real columns (with Postgres `text[]` for the two tag
 * arrays) rather than JSON blobs. Sub-objects that are only ever read whole
 * (`color`, `texture`, `pbr`) stay as `jsonb`.
 *
 * A project's geometry is the opposite case: it is a document that is always
 * written and read as a unit, is never filtered on, and whose shape is owned
 * by `shared/types.ts`. Shredding walls/rooms/openings into tables would buy
 * nothing and would make the schema a second, drifting copy of the contract.
 * So `projects.data` is `jsonb`.
 */

import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  ColorInfo,
  Floor,
  MaterialCategory,
  PbrInfo,
  RoofSpec,
  Surface,
  TextureInfo,
  Tier,
  Unit,
  ComponentType,
} from '../../../shared/types.ts';

export const materials = pgTable(
  'materials',
  {
  id: text('id').primaryKey(),
  name: text('name').notNull(),

  // --- queryable facets -------------------------------------------------
  category: text('category').$type<MaterialCategory>().notNull(),
  tier: text('tier').$type<Tier>().notNull(),
  pricePerUnit: doublePrecision('price_per_unit').notNull(),
  applicableSurfaces: text('applicable_surfaces').array().$type<Surface[]>().notNull(),
  styleTags: text('style_tags').array().$type<string[]>().notNull(),

  // --- the rest ---------------------------------------------------------
  subtype: text('subtype').notNull(),
  description: text('description').notNull(),
  color: jsonb('color').$type<ColorInfo>().notNull(),
  texture: jsonb('texture').$type<TextureInfo>().notNull(),
  pbr: jsonb('pbr').$type<PbrInfo>().notNull(),
  unit: text('unit').$type<Unit>().notNull(),
  wastageFactor: doublePrecision('wastage_factor').notNull(),
  finish: text('finish').notNull(),
  durabilityScore: integer('durability_score').notNull(),
  sustainabilityScore: integer('sustainability_score').notNull(),
  aestheticScore: integer('aesthetic_score').notNull(),

  // --- unit conversion, only meaningful for LITER materials -------------
  coveragePerUnit: doublePrecision('coverage_per_unit'),
  coatsRecommended: integer('coats_recommended'),

  // --- purchasable increment, omitted for continuous-measure materials --
  packSize: doublePrecision('pack_size'),
  packLabel: text('pack_label'),
  },
  (t) => [
    // These four back the `/materials` filters. The array columns get GIN
    // indexes because the predicate is containment (`@>`), which btree cannot
    // serve.
    index('materials_category_idx').on(t.category),
    index('materials_tier_idx').on(t.tier),
    index('materials_price_idx').on(t.pricePerUnit),
    index('materials_surfaces_idx').using('gin', t.applicableSurfaces),
    index('materials_style_tags_idx').using('gin', t.styleTags),
  ],
);

export const components = pgTable('components', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<ComponentType>().notNull(),
  description: text('description').notNull(),
  color: jsonb('color').$type<ColorInfo>().notNull(),
  price: doublePrecision('price').notNull(),
  widthM: doublePrecision('width_m').notNull(),
  heightM: doublePrecision('height_m').notNull(),
  depthM: doublePrecision('depth_m').notNull(),
  styleTags: text('style_tags').array().$type<string[]>().notNull(),
  modelKind: text('model_kind').notNull(),
});

export const stylePresets = pgTable('style_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  styleTags: text('style_tags').array().$type<string[]>().notNull(),
  palette: text('palette').array().$type<string[]>().notNull(),
  recommended: jsonb('recommended').$type<Partial<Record<Surface, string>>>().notNull(),
});

/** The geometry document stored in `projects.data`. */
export interface ProjectDocument {
  floors: Floor[];
  roof?: RoofSpec;
}

export const projects = pgTable('projects', {
  // Postgres 18 has uuidv7() natively: time-ordered, so index locality is good
  // and rows sort by creation without a separate sequence.
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('USD'),
  unitSystem: text('unit_system').$type<'metric' | 'imperial'>().notNull().default('metric'),
  contingencyBuffer: doublePrecision('contingency_buffer').notNull().default(0.08),
  data: jsonb('data').$type<ProjectDocument>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MaterialRow = typeof materials.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type StylePresetRow = typeof stylePresets.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
