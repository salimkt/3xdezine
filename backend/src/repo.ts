/**
 * Database access, plus the row -> domain mappings.
 *
 * Postgres columns are nullable where the contract says "optional", so every
 * mapper turns `null` back into an absent key. Leaving a `null` in would make
 * the response serializer reject it, and would mean the wire format differs
 * from `shared/types.ts`.
 */

import { and, arrayContains, arrayOverlaps, asc, eq, ilike, lte, or } from 'drizzle-orm';

import { getDb } from './db/client.ts';
import {
  components,
  materials,
  projects,
  stylePresets,
  type ComponentRow,
  type MaterialRow,
  type ProjectDocument,
  type ProjectRow,
  type StylePresetRow,
} from './db/schema.ts';
import { catalogMeta } from './shared.ts';
import type {
  Catalog,
  ComponentProduct,
  Material,
  Project,
  StylePreset,
} from '../../shared/types.ts';
import type { MaterialQueryDto, ProjectSummaryDto } from './schemas.ts';

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Drops a key entirely when the column is NULL. */
function opt<T>(value: T | null): { v: T } | undefined {
  return value === null || value === undefined ? undefined : { v: value };
}

export function toMaterial(row: MaterialRow): Material {
  const coverage = opt(row.coveragePerUnit);
  const coats = opt(row.coatsRecommended);
  const packSize = opt(row.packSize);
  const packLabel = opt(row.packLabel);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subtype: row.subtype,
    description: row.description,
    color: row.color,
    texture: row.texture,
    pbr: row.pbr,
    unit: row.unit,
    pricePerUnit: row.pricePerUnit,
    wastageFactor: row.wastageFactor,
    finish: row.finish,
    tier: row.tier,
    durabilityScore: row.durabilityScore,
    sustainabilityScore: row.sustainabilityScore,
    aestheticScore: row.aestheticScore,
    styleTags: row.styleTags,
    applicableSurfaces: row.applicableSurfaces,
    ...(coverage ? { coveragePerUnit: coverage.v } : {}),
    ...(coats ? { coatsRecommended: coats.v } : {}),
    ...(packSize ? { packSize: packSize.v } : {}),
    ...(packLabel ? { packLabel: packLabel.v } : {}),
  };
}

export function toComponent(row: ComponentRow): ComponentProduct {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    color: row.color,
    price: row.price,
    widthM: row.widthM,
    heightM: row.heightM,
    depthM: row.depthM,
    styleTags: row.styleTags,
    modelKind: row.modelKind,
  };
}

export function toStylePreset(row: StylePresetRow): StylePreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    styleTags: row.styleTags,
    palette: row.palette,
    recommended: row.recommended,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    unitSystem: row.unitSystem,
    contingencyBuffer: row.contingencyBuffer,
    floors: row.data.floors ?? [],
    ...(row.data.roof ? { roof: row.data.roof } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectSummary(row: ProjectRow): ProjectSummaryDto {
  const floors = row.data.floors ?? [];
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    unitSystem: row.unitSystem,
    contingencyBuffer: row.contingencyBuffer,
    floorCount: floors.length,
    roomCount: floors.reduce((n, f) => n + f.rooms.length, 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listMaterials(query: MaterialQueryDto = {}): Promise<Material[]> {
  const { orm } = getDb();
  const clauses = [];

  if (query.category) clauses.push(eq(materials.category, query.category));
  if (query.tier) clauses.push(eq(materials.tier, query.tier));
  // Containment on the text[] column, which the GIN index serves.
  if (query.surface) clauses.push(arrayContains(materials.applicableSurfaces, [query.surface]));
  if (query.maxPrice !== undefined) clauses.push(lte(materials.pricePerUnit, query.maxPrice));

  if (query.style) {
    // `style` accepts either a raw tag ("warm") or a StylePreset id
    // ("modern-warm"), because both are things a client naturally has to hand.
    // Overlap (`&&`), not containment: one shared tag is a match.
    const tags = await resolveStyleTags(query.style);
    clauses.push(arrayOverlaps(materials.styleTags, tags));
  }

  if (query.q) {
    const needle = `%${query.q}%`;
    clauses.push(
      or(
        ilike(materials.name, needle),
        ilike(materials.description, needle),
        ilike(materials.subtype, needle),
      )!,
    );
  }

  const rows = await orm
    .select()
    .from(materials)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(asc(materials.category), asc(materials.pricePerUnit));

  return rows.map(toMaterial);
}

/** A style id expands to that preset's tags; anything else is taken literally. */
async function resolveStyleTags(style: string): Promise<string[]> {
  const { orm } = getDb();
  const [preset] = await orm
    .select({ styleTags: stylePresets.styleTags })
    .from(stylePresets)
    .where(eq(stylePresets.id, style))
    .limit(1);
  return preset ? preset.styleTags : [style];
}

export async function getMaterial(id: string): Promise<Material | undefined> {
  const { orm } = getDb();
  const [row] = await orm.select().from(materials).where(eq(materials.id, id)).limit(1);
  return row ? toMaterial(row) : undefined;
}

export async function listComponents(): Promise<ComponentProduct[]> {
  const { orm } = getDb();
  const rows = await orm.select().from(components).orderBy(asc(components.type), asc(components.price));
  return rows.map(toComponent);
}

export async function listStyles(): Promise<StylePreset[]> {
  const { orm } = getDb();
  const rows = await orm.select().from(stylePresets).orderBy(asc(stylePresets.id));
  return rows.map(toStylePreset);
}

export async function loadCatalog(): Promise<Catalog> {
  const [mats, comps, styles] = await Promise.all([
    listMaterials(),
    listComponents(),
    listStyles(),
  ]);
  return { meta: catalogMeta, materials: mats, components: comps, styles };
}

/**
 * The catalog is read on every cost estimate and every suggestion request, and
 * it only changes when someone re-seeds. Caching it turns those endpoints into
 * pure CPU work, which is what ARCHITECTURE.md asks of `/cost/estimate`.
 */
const CATALOG_TTL_MS = 60_000;
let cached: { at: number; catalog: Catalog } | undefined;

export async function getCachedCatalog(now = Date.now()): Promise<Catalog> {
  if (cached && now - cached.at < CATALOG_TTL_MS) return cached.catalog;
  const catalog = await loadCatalog();
  cached = { at: now, catalog };
  return catalog;
}

export function invalidateCatalogCache(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function toDocument(project: Project): ProjectDocument {
  return { floors: project.floors, ...(project.roof ? { roof: project.roof } : {}) };
}

export async function listProjects(): Promise<ProjectSummaryDto[]> {
  const { orm } = getDb();
  const rows = await orm.select().from(projects).orderBy(asc(projects.createdAt));
  return rows.map(toProjectSummary);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const { orm } = getDb();
  const [row] = await orm.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ? toProject(row) : undefined;
}

export async function createProject(project: Project): Promise<Project> {
  const { orm } = getDb();
  const [row] = await orm
    .insert(projects)
    .values({
      name: project.name,
      currency: project.currency,
      unitSystem: project.unitSystem,
      contingencyBuffer: project.contingencyBuffer,
      data: toDocument(project),
    })
    .returning();
  return toProject(row!);
}

export async function updateProject(
  id: string,
  project: Project,
): Promise<Project | undefined> {
  const { orm } = getDb();
  const [row] = await orm
    .update(projects)
    .set({
      name: project.name,
      currency: project.currency,
      unitSystem: project.unitSystem,
      contingencyBuffer: project.contingencyBuffer,
      data: toDocument(project),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();
  return row ? toProject(row) : undefined;
}

export async function deleteProject(id: string): Promise<boolean> {
  const { orm } = getDb();
  const rows = await orm
    .delete(projects)
    .where(eq(projects.id, id))
    .returning({ id: projects.id });
  return rows.length > 0;
}
