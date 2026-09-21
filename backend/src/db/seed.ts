/**
 * Idempotent seed. Loads `shared/catalog.seed.json` and
 * `shared/sample-project.json` into Postgres.
 *
 * Every insert is `ON CONFLICT DO NOTHING`, so running this repeatedly is a
 * no-op rather than an error or a pile of duplicates. It deliberately does NOT
 * update existing rows: a seed that overwrites would silently discard edits
 * made through the API. Re-seed a changed catalog with `npm run db:reset`.
 */

import { closeDb, getDb } from './client.ts';
import { components, materials, projects, stylePresets } from './schema.ts';
import { readSampleProject, readSeedCatalog } from '../shared.ts';

/**
 * A fixed id for the demo apartment, so seeding twice cannot create a second
 * copy. It is a well-formed v7 UUID (version nibble 7, variant bits 10).
 */
export const SAMPLE_PROJECT_ID = '01923f00-0000-7000-8000-000000000001';

export interface SeedCounts {
  materials: number;
  components: number;
  styles: number;
  projects: number;
}

export async function seed(db = getDb().orm): Promise<SeedCounts> {
  const catalog = readSeedCatalog();
  const sample = readSampleProject();

  const insertedMaterials = await db
    .insert(materials)
    .values(
      catalog.materials.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        tier: m.tier,
        pricePerUnit: m.pricePerUnit,
        applicableSurfaces: m.applicableSurfaces,
        styleTags: m.styleTags,
        subtype: m.subtype,
        description: m.description,
        color: m.color,
        texture: m.texture,
        pbr: m.pbr,
        unit: m.unit,
        wastageFactor: m.wastageFactor,
        finish: m.finish,
        durabilityScore: m.durabilityScore,
        sustainabilityScore: m.sustainabilityScore,
        aestheticScore: m.aestheticScore,
        coveragePerUnit: m.coveragePerUnit ?? null,
        coatsRecommended: m.coatsRecommended ?? null,
        packSize: m.packSize ?? null,
        packLabel: m.packLabel ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: materials.id });

  const insertedComponents = await db
    .insert(components)
    .values(
      catalog.components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description,
        color: c.color,
        price: c.price,
        widthM: c.widthM,
        heightM: c.heightM,
        depthM: c.depthM,
        styleTags: c.styleTags,
        modelKind: c.modelKind,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: components.id });

  const insertedStyles = await db
    .insert(stylePresets)
    .values(
      catalog.styles.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        styleTags: s.styleTags,
        palette: s.palette,
        recommended: s.recommended,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: stylePresets.id });

  const insertedProjects = await db
    .insert(projects)
    .values({
      id: SAMPLE_PROJECT_ID,
      name: sample.name,
      currency: sample.currency,
      unitSystem: sample.unitSystem,
      contingencyBuffer: sample.contingencyBuffer,
      data: { floors: sample.floors, roof: sample.roof },
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });

  return {
    materials: insertedMaterials.length,
    components: insertedComponents.length,
    styles: insertedStyles.length,
    projects: insertedProjects.length,
  };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntrypoint) {
  try {
    const counts = await seed();
    const total =
      counts.materials + counts.components + counts.styles + counts.projects;
    console.log(
      total === 0
        ? 'seed: nothing to do, database already populated'
        : `seed: inserted ${counts.materials} materials, ${counts.components} components, ` +
            `${counts.styles} styles, ${counts.projects} projects`,
    );
  } catch (err) {
    console.error('seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
