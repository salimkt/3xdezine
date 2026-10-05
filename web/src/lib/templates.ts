import type { PlanTemplateMeta, Project } from '@shared/types';
import sampleProject from '@shared/sample-project.json';
import { polygonArea } from './planMath';

/**
 * Starter plans live in `shared/templates/` as ordinary Project JSON. They are
 * globbed lazily, so each one is its own few-KB chunk fetched only when a tile
 * needs to draw it — none of them sit in the first-paint bundle.
 */
const files = import.meta.glob<{ default: unknown }>('@shared/templates/*.json');

function findLoader(file: string) {
  const suffix = `/${file}`;
  const key = Object.keys(files).find((k) => k.endsWith(suffix));
  return key ? files[key] : undefined;
}

export const SAMPLE_TEMPLATE_ID = '__sample__';
export const BLANK_TEMPLATE_ID = '__blank__';

function metaFor(project: Project, id: string, extra: Partial<PlanTemplateMeta>): PlanTemplateMeta {
  const rooms = project.floors[0]?.rooms ?? [];
  const bhk = rooms.filter((r) => /bed|master|guest|kid/i.test(r.name)).length;
  return {
    id,
    name: project.name,
    tagline: '',
    category: 'APARTMENT',
    bhk,
    builtUpSqm: Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) * 10) / 10,
    rooms: rooms.length,
    styleId: 'scandi-minimal',
    file: '',
    ...extra,
  };
}

/** Shown only if `shared/templates/` has not shipped (or fails to load). */
function fallbackIndex(): PlanTemplateMeta[] {
  return [
    metaFor(sampleProject as unknown as Project, SAMPLE_TEMPLATE_ID, {
      tagline: 'The reference plan the studio was tuned on.',
      styleId: 'modern-warm',
    }),
  ];
}

let indexPromise: Promise<PlanTemplateMeta[]> | null = null;

export function loadTemplateIndex(): Promise<PlanTemplateMeta[]> {
  indexPromise ??= (async () => {
    const loader = findLoader('index.json');
    if (!loader) return fallbackIndex();
    try {
      const list = (await loader()).default as PlanTemplateMeta[];
      return Array.isArray(list) && list.length ? list : fallbackIndex();
    } catch {
      return fallbackIndex();
    }
  })();
  return indexPromise;
}

const projectCache = new Map<string, Promise<Project>>();

/** Resolves to a fresh clone every call; the cached copy is never handed out. */
export async function loadTemplate(meta: PlanTemplateMeta): Promise<Project> {
  let promise = projectCache.get(meta.id);
  if (!promise) {
    promise = (async () => {
      if (meta.id === SAMPLE_TEMPLATE_ID) return sampleProject as unknown as Project;
      if (meta.id === BLANK_TEMPLATE_ID) return blankProject();
      const loader = findLoader(meta.file);
      if (!loader) throw new Error(`template ${meta.file} missing`);
      return (await loader()).default as Project;
    })();
    projectCache.set(meta.id, promise);
    promise.catch(() => projectCache.delete(meta.id));
  }
  const project = structuredClone(await promise);
  project.templateId = meta.id;
  delete project.id;
  delete project.proposals;
  return project;
}

/**
 * The smallest plan the rules engine accepts: one 4.0 × 3.6 m habitable room
 * (14.4 m², over the 9.5 m² minimum and wider than 2.4 m), a door and a window
 * sized for a warm-humid climate (a sixth of the floor). Finishes come from the catalog defaults.
 */
export function blankProject(): Project {
  const W = 4;
  const D = 3.6;
  const wall = (id: string, sx: number, sz: number, ex: number, ez: number) => ({
    id,
    start: { x: sx, z: sz },
    end: { x: ex, z: ez },
    heightM: 2.85,
    thicknessM: 0.23,
    exterior: true,
    interiorMaterialId: 'paint-warm-grey',
    exteriorMaterialId: 'stucco-white',
  });
  return {
    name: 'Blank plan',
    currency: 'INR',
    unitSystem: 'metric',
    contingencyBuffer: 0.08,
    roof: { kind: 'FLAT', pitchDeg: 0, overhangM: 0.3, materialId: 'asphalt-shingle' },
    floors: [
      {
        id: 'floor-0',
        name: 'Ground Floor',
        level: 0,
        walls: [
          wall('ext-n', 0, 0, W, 0),
          wall('ext-e', W, 0, W, D),
          wall('ext-s', W, D, 0, D),
          wall('ext-w', 0, D, 0, 0),
        ],
        rooms: [
          {
            id: 'room-1',
            name: 'Living Room',
            polygon: [
              { x: 0, z: 0 },
              { x: 0, z: D },
              { x: W, z: D },
              { x: W, z: 0 },
            ],
            ceilingHeightM: 2.85,
            floorMaterialId: 'oak-hardwood',
            ceilingMaterialId: 'paint-white-matte',
          },
        ],
        openings: [
          { id: 'op-door', wallId: 'ext-s', componentId: 'door-panel-white', t: 0.5, widthM: 0.9, heightM: 2.1, sillM: 0 },
          { id: 'op-win', wallId: 'ext-n', componentId: 'window-casement', t: 0.5, widthM: 1.6, heightM: 1.5, sillM: 0.9 },
        ],
        components: [],
      },
    ],
  };
}

export const BLANK_META: PlanTemplateMeta = metaFor(blankProject(), BLANK_TEMPLATE_ID, {
  name: 'Blank plan',
  tagline: 'One room, four walls — start from the envelope.',
  category: 'STUDIO',
  bhk: 0,
});
