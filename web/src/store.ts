import { create } from 'zustand';
import catalogSeed from '@shared/catalog.seed.json';
import sampleProject from '@shared/sample-project.json';
import type {
  Catalog,
  EditPolicy,
  Material,
  PlanEdit,
  Project,
  Surface,
  Vec2,
  Wall,
} from '@shared/types';
import {
  acceptProposal as acceptProposalRule,
  applyEdits,
  canEditFinishes,
  createProposal,
  effectivePolicy,
  rejectProposal as rejectProposalRule,
} from '@shared/rules';
import { loadAuthor, loadSavedProject, saveAuthor, saveProject } from './lib/persist';

export const CATALOG: Catalog = catalogSeed as unknown as Catalog;

function cloneProject(): Project {
  return structuredClone(sampleProject) as unknown as Project;
}

const saved = loadSavedProject();

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
export type Screen = 'home' | 'studio';
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
  /** Clock time in hours (IST), 6..19. Drives the sun along its path for the site latitude. */
  sunHour: number;
}

/** A short, non-modal explanation, e.g. why a drag or a material click was refused. */
export interface Notice {
  text: string;
  tone: 'info' | 'warn';
  at: number;
}

/** Something the plan should select and frame, e.g. from the plan check list. */
export interface FocusRequest {
  kind: 'room' | 'wall';
  id: string;
  at: number;
}

interface StoreState {
  screen: Screen;
  /** Bumped each time a project is opened from the home screen; the 3D view plays its build-up on change. */
  openedAt: number;
  project: Project;
  /** The proposal whose diff the plan (and optionally the 3D view) is showing. */
  previewProposalId: string | null;
  previewIn3d: boolean;
  author: string;
  notice: Notice | null;
  focus: FocusRequest | null;
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
  /**
   * The most recent material application, so the UI can briefly mark the
   * surface and the card that changed. `at` is a fresh token per application.
   */
  lastApplied: AppliedMaterial | null;

  // actions
  goHome: () => void;
  openProject: (project: Project) => void;
  /** Replaces the whole project, keeping the selection — used for live drags. */
  setProject: (project: Project) => void;
  setPolicy: (patch: Partial<EditPolicy>) => void;
  applyPlanEdits: (edits: PlanEdit[]) => void;
  /** Files edits for review. Returns the new proposal id. */
  proposeEdits: (edits: PlanEdit[], note?: string) => string | null;
  acceptProposal: (id: string) => void;
  rejectProposal: (id: string) => void;
  previewProposal: (id: string | null) => void;
  setPreviewIn3d: (on: boolean) => void;
  setAuthor: (name: string) => void;
  notify: (text: string, tone?: Notice['tone']) => void;
  focusOn: (kind: FocusRequest['kind'], id: string) => void;
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

export interface AppliedMaterial {
  kind: Exclude<SelectionKind, null>;
  id: string | null;
  surface: SurfaceTarget;
  materialId: string;
  at: number;
}

let appliedSeq = 0;

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

let noticeSeq = 0;

export const useStore = create<StoreState>((set, get) => ({
  screen: 'home',
  openedAt: 0,
  project: saved?.project ?? cloneProject(),
  previewProposalId: null,
  previewIn3d: false,
  author: loadAuthor(),
  notice: null,
  focus: null,
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
    // Mid-afternoon: low enough for long shadows through the west glazing,
    // high enough that the interior is still in daylight.
    sunHour: 15.5,
  },
  lastApplied: null,

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

  goHome: () => set({ screen: 'home', previewProposalId: null, previewIn3d: false }),

  openProject: (project) =>
    set((state) => {
      const firstRoom = project.floors[0]?.rooms[0];
      return {
        project,
        screen: 'studio',
        openedAt: state.openedAt + 1,
        previewProposalId: null,
        previewIn3d: false,
        selection: firstRoom ? { kind: 'room', id: firstRoom.id } : { kind: null, id: null },
        cameraMode: 'orbit',
        surfaceTarget: 'FLOOR',
        lastApplied: null,
      };
    }),

  setProject: (project) => set({ project }),

  setPolicy: (patch) =>
    set((state) => ({
      project: { ...state.project, policy: { ...effectivePolicy(state.project), ...patch } },
    })),

  applyPlanEdits: (edits) => set((state) => ({ project: applyEdits(state.project, edits) })),

  proposeEdits: (edits, note) => {
    const state = get();
    const proposal = createProposal(
      state.project,
      edits,
      state.author.trim() || 'Anonymous',
      state.catalog,
      note?.trim() || undefined,
    );
    set({
      project: { ...state.project, proposals: [...(state.project.proposals ?? []), proposal] },
      previewProposalId: proposal.id,
    });
    return proposal.id;
  },

  // The rules engine throws on a proposal that is no longer pending (decided
  // in another tab, say); that is a notice, not a crash.
  acceptProposal: (id) =>
    set((state) => {
      try {
        return {
          project: acceptProposalRule(state.project, id),
          previewProposalId: state.previewProposalId === id ? null : state.previewProposalId,
          previewIn3d: false,
        };
      } catch (error) {
        return { notice: { text: (error as Error).message, tone: 'warn', at: ++noticeSeq } };
      }
    }),

  rejectProposal: (id) =>
    set((state) => {
      try {
        return {
          project: rejectProposalRule(state.project, id),
          previewProposalId: state.previewProposalId === id ? null : state.previewProposalId,
          previewIn3d: false,
        };
      } catch (error) {
        return { notice: { text: (error as Error).message, tone: 'warn', at: ++noticeSeq } };
      }
    }),

  previewProposal: (previewProposalId) =>
    set((state) => ({ previewProposalId, previewIn3d: previewProposalId ? state.previewIn3d : false })),
  setPreviewIn3d: (previewIn3d) => set({ previewIn3d }),

  setAuthor: (author) => {
    saveAuthor(author);
    set({ author });
  },

  notify: (text, tone = 'warn') => set({ notice: { text, tone, at: ++noticeSeq } }),
  focusOn: (kind, id) => set({ focus: { kind, id, at: Date.now() } }),

  applyMaterial: (materialId) =>
    set((state) => {
      const finishes = canEditFinishes(state.project);
      if (!finishes.allowed) {
        return { notice: { text: finishes.reason ?? 'Finishes are locked.', tone: 'warn', at: ++noticeSeq } };
      }
      const { selection, surfaceTarget } = state;
      const project = structuredClone(state.project);
      const floor = project.floors[0];
      if (!floor) return {};
      const applied = (): Partial<StoreState> => ({
        project,
        lastApplied: selection.kind
          ? {
              kind: selection.kind,
              id: selection.id,
              surface: surfaceTarget,
              materialId,
              at: ++appliedSeq,
            }
          : null,
      });

      if (selection.kind === 'roof') {
        if (project.roof) project.roof.materialId = materialId;
        return applied();
      }
      if (selection.kind === 'room') {
        const room = floor.rooms.find((r) => r.id === selection.id);
        if (!room) return {};
        if (surfaceTarget === 'FLOOR') room.floorMaterialId = materialId;
        if (surfaceTarget === 'CEILING') room.ceilingMaterialId = materialId;
        return applied();
      }
      if (selection.kind === 'wall') {
        const wall = floor.walls.find((w) => w.id === selection.id);
        if (!wall) return {};
        if (surfaceTarget === 'EXTERIOR_WALL') wall.exteriorMaterialId = materialId;
        else wall.interiorMaterialId = materialId;
        return applied();
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

  resetProject: () =>
    set((state) => {
      // Back to the plan this project was opened from, keeping its policy.
      const fresh = cloneProject();
      return { project: { ...fresh, policy: state.project.policy }, previewProposalId: null };
    }),
  setCatalog: (catalog) => set({ catalog, catalogSource: 'api' }),
  setView: (view) => set({ view }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setBackend: (backend) => set({ backend }),
  setRendererReady: () => set({ rendererReady: true }),
  patchRender: (patch) => set({ render: { ...get().render, ...patch } }),
}));

// The working project survives a reload, so the home screen can offer it back.
useStore.subscribe((state, prev) => {
  if (state.project !== prev.project) saveProject(state.project);
});
