/**
 * Bridge to `shared/`, the cross-client domain contract.
 *
 * There are no npm workspaces wiring `backend/` to `shared/`, so everything
 * here is imported by relative path and run through `tsx`
 * (`allowImportingTsExtensions` + `module: nodenext`). Re-exporting through
 * this one module means the relative depth is written down exactly once.
 */

import { readFileSync } from 'node:fs';

import type { Catalog, Project } from '../../shared/types.ts';

export { estimateCost, polygonArea, wallLength } from '../../shared/cost.ts';
export type * from '../../shared/types.ts';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../shared/${name}`, import.meta.url), 'utf8'));

/** The on-disk seed catalog. Source of truth for `meta`, and for the seeder. */
export function readSeedCatalog(): Catalog {
  return read('catalog.seed.json') as Catalog;
}

export function readSampleProject(): Project {
  return read('sample-project.json') as Project;
}

/**
 * `Catalog.meta` (currency, price basis, the scoring legend) is static
 * configuration that ships with the contract rather than per-row data, so it
 * is read from the seed file instead of being shredded into a table.
 */
export const catalogMeta = readSeedCatalog().meta;
