import { create } from 'zustand';
import catalogSeed from '@shared/catalog.seed.json';
import sampleProject from '@shared/sample-project.json';
import type { Catalog, Material, Project, Surface, Vec2, Wall } from '@shared/types';

export const CATALOG: Catalog = catalogSeed as unknown as Catalog;

function cloneProject(): Project {
  return structuredClone(sampleProject) as unknown as Project;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type SelectionKind = 'wall' | 'room' | 'roof' | null;

export interface Selection {
  kind: SelectionKind;
  id: string | null;
}

/** Which surface of the current selection a material click would paint. */
export type SurfaceTarget = Surface;

export type ViewMode = '2d' | '3d' | 'split';
export type CameraMode = 'orbit' | 'walk';
export type ToneMappingMode = 'AGX' | 'NEUTRAL';
export type QualityMode = 'high' | 'balanced' | 'performance';
export type Backend = 'webgpu' | 'webgl' | 'pending';

export interface RenderSettings {
  hdri: string;
  toneMapping: ToneMappingMode;
  quality: QualityMode;
  exposure: number;
  envIntensity: number;
  sunIntensity: number;
  showGrid: boolean;
  showCeilings: boolean;
}

interface StoreState {
  project: Project;
  catalog: Catalog;
  catalogSource: 'bundled' | 'api';

  selection: Selection;
  surfaceTarget: SurfaceTarget;

  view: ViewMode;
  cameraMode: CameraMode;
  backend: Backend;
  /** False until the first frame has actually been presented. */
  rendererReady: boolean;
  render: RenderSettings;

  // actions
  select: (kind: SelectionKind, id: string | null) => void;
  setSurfaceTarget: (s: SurfaceTarget) => void;
  applyMaterial: (materialId: string) => void;
  moveWallEndpoint: (wallId: string, which: 'start' | 'end', to: Vec2) => void;
  setContingency: (value: number) => void;
  setWallHeight: (wallId: string, heightM: number) => void;
  setWallThickness: (wallId: string, thicknessM: number) => void;
  resetProject: () => void;
  setCatalog: (catalog: Catalog) => void;
  setView: (v: ViewMode) => void;
  setCameraMode: (m: CameraMode) => void;
  setBackend: (b: Backend) => void;
  setRendererReady: () => void;
  patchRender: (patch: Partial<RenderSettings>) => void;
}

const EPS = 1e-6;
const sameP = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS;

/**
 * Surfaces a material can be painted onto, for a given selection. Painting is
 * always explicit about which face it lands on — a wall has an inside and an
 * outside and they are priced separately.
 */
export function targetsFor(kind: SelectionKind, wall?: Wall): SurfaceTarget[] {
  if (kind === 'room') return ['FLOOR', 'CEILING'];
  if (kind === 'wall') return wall?.exterior ? ['WALL', 'EXTERIOR_WALL'] : ['WALL'];
  if (kind === 'roof') return ['ROOF'];
  return [];
}

export function materialsForSurface(catalog: Catalog, surface: Surface): Material[] {
  return catalog.materials.filter((m) => m.applicableSurfaces.includes(surface));
}

export const useStore = create<StoreState>((set, get) => ({
  project: cloneProject(),
  catalog: CATALOG,
  catalogSource: 'bundled',

  selection: { kind: 'room', id: 'room-living' },
  surfaceTarget: 'FLOOR',

  view: 'split',
  cameraMode: 'orbit',
  backend: 'pending',
  rendererReady: false,
  render: {
    // An outdoor sky probe, not the studio one: it doubles as the visible
    // background, puts real sunlight through the windows, and gives glazing
    // something worth reflecting. The studio probe stays available for
    // material-accurate preview.
    hdri: '/hdri/kloofendal_43d_clear_puresky.hdr',
    toneMapping: 'AGX',
    quality: 'balanced',
    exposure: 1.1,
    envIntensity: 1.0,
    sunIntensity: 2.6,
    // Off by default — a 200x200 CAD grid reads as a debug overlay and
    // undercuts the render. It stays one toggle away for plan work.
    showGrid: false,
    showCeilings: false,
  },

  select: (kind, id) =>
    set((state) => {
      const wall =
        kind === 'wall' ? state.project.floors[0]?.walls.find((w) => w.id === id) : undefined;
      const options = targetsFor(kind, wall);
      const keep = options.includes(state.surfaceTarget);
      return {
        selection: { kind, id },
        surfaceTarget: keep ? state.surfaceTarget : (options[0] ?? state.surfaceTarget),
      };
    }),

  setSurfaceTarget: (surfaceTarget) => set({ surfaceTarget }),

  applyMaterial: (materialId) =>
    set((state) => {
      const { selection, surfaceTarget } = state;
      const project = structuredClone(state.project);
      const floor = project.floors[0];
      if (!floor) return {};

      if (selection.kind === 'roof') {
        if (project.roof) project.roof.materialId = materialId;
        return { project };
      }
      if (selection.kind === 'room') {
        const room = floor.rooms.find((r) => r.id === selection.id);
        if (!room) return {};
        if (surfaceTarget === 'FLOOR') room.floorMaterialId = materialId;
        if (surfaceTarget === 'CEILING') room.ceilingMaterialId = materialId;
        return { project };
      }
      if (selection.kind === 'wall') {
        const wall = floor.walls.find((w) => w.id === selection.id);
        if (!wall) return {};
        if (surfaceTarget === 'EXTERIOR_WALL') wall.exteriorMaterialId = materialId;
        else wall.interiorMaterialId = materialId;
        return { project };
      }
      return {};
    }),

  /**
   * Drags one wall endpoint, carrying every coincident wall endpoint and room
   * vertex with it. Without that the plan tears open the moment you move a
   * corner, and the cost engine starts measuring a different building.
   */
  moveWallEndpoint: (wallId, which, to) =>
    set((state) => {
      const project = structuredClone(state.project);
      const floor = project.floors[0];
      if (!floor) return {};
      const wall = floor.walls.find((w) => w.id === wallId);
      if (!wall) return {};
      const from = { ...wall[which] };
      if (sameP(from, to)) return {};

      for (const w of floor.walls) {
        if (sameP(w.start, from)) w.start = { ...to };
        if (sameP(w.end, from)) w.end = { ...to };
      }
      for (const room of floor.rooms) {
        room.polygon = room.polygon.map((p) => (sameP(p, from) ? { ...to } : p));
      }
      return { project };
    }),

  setContingency: (value) =>
    set((state) => ({
      project: { ...state.project, contingencyBuffer: Math.max(0, Math.min(0.5, value)) },
    })),

  setWallHeight: (wallId, heightM) =>
    set((state) => {
      const project = structuredClone(state.project);
      const wall = project.floors[0]?.walls.find((w) => w.id === wallId);
      if (!wall) return {};
      wall.heightM = Math.max(1.8, Math.min(6, heightM));
      return { project };
    }),

  setWallThickness: (wallId, thicknessM) =>
    set((state) => {
      const project = structuredClone(state.project);
      const wall = project.floors[0]?.walls.find((w) => w.id === wallId);
      if (!wall) return {};
      wall.thicknessM = Math.max(0.05, Math.min(0.6, thicknessM));
      return { project };
    }),

  resetProject: () => set({ project: cloneProject() }),
  setCatalog: (catalog) => set({ catalog, catalogSource: 'api' }),
  setView: (view) => set({ view }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setBackend: (backend) => set({ backend }),
  setRendererReady: () => set({ rendererReady: true }),
  patchRender: (patch) => set({ render: { ...get().render, ...patch } }),
}));
