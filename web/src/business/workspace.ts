import { create } from 'zustand';
import type {
  Address,
  DocType,
  ModularItem,
  Party,
  PaymentMilestone,
  QuotationDocument,
  QuoteDraftInput,
  QuoteLine,
} from '@shared/business';
import { useStore } from '../store';
import { useCloud } from '../cloud/state';

/**
 * The quote being drafted for each project, plus the modular items drawn on
 * its plan. Plain data, no engines: the plan editor and the 3D view read the
 * modular items from here, and only the lazy business chunks price them.
 *
 * Kept per project in this browser (and, signed in, mirrored to a cloud DRAFT
 * row by "Save draft"). Modular items are not part of the plan document, so a
 * collaborator's geometry save never has to know about them.
 */

export interface QuoteDraft {
  lines: QuoteLine[];
  /** Kitchens, wardrobes… configured on this plan. A MODULAR line prices one. */
  modular: ModularItem[];
  view: QuotationDocument['view'];
  designFee?: QuoteDraftInput['designFee'];
  discount?: QuoteDraftInput['discount'];
  milestones: Array<{ label: string; pct: number; trigger: PaymentMilestone['trigger'] }>;
  makeList: QuotationDocument['makeList'];
  inclusions: string[];
  exclusions: string[];
  terms: string[];
  areaBasis?: QuotationDocument['areaBasis'];
  areaBasisKind: 'CARPET' | 'BUILT_UP';
  docType: DocType;
  validityDays: number;
  recipient: Party;
  siteAddress: Address;
  /** Lines were seeded from the rate card; re-seeding is an explicit action. */
  seeded: boolean;
  /** The cloud DRAFT this edits, once saved. */
  cloudQuoteId?: string;
  /** Drafting a variation order against this approved quote. */
  amendsId?: string;
  /** The approved document a variation order is drafted against (for the diff). */
  amendsDoc?: QuotationDocument;
  /** The working draft set aside while drafting a variation order, restored on leaving it. */
  stash?: Omit<QuoteDraft, 'stash'>;
  /** The last issued document and its approval-link token, for the share panel. */
  lastIssued?: { quoteId: string; token: string; number?: string };
  /** Revising this issued quote (the next version supersedes it). */
  supersedesId?: string;
  updatedAt: string;
}

export interface WallPick {
  roomId: string;
  type: 'KITCHEN' | 'WARDROBE';
  layout: NonNullable<ModularItem['layout']>;
  wallIds: string[];
}

interface WorkspaceState {
  drafts: Record<string, QuoteDraft>;
  /** Picking wall segments in the plan for a new modular run. */
  pick: WallPick | null;
  /** The modular item open in the configurator. */
  editingModularId: string | null;
  /** Items to draw instead of the project's own (the client approval page's 3D view). */
  previewItems: ModularItem[] | null;
}

const KEY = 'dezine.quotes.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load(): Record<string, QuoteDraft> {
  try {
    const raw = storage()?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, QuoteDraft>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export const useWorkspace = create<WorkspaceState>(() => ({
  drafts: typeof window === 'undefined' ? {} : load(),
  pick: null,
  editingModularId: null,
  previewItems: null,
}));

let pending: number | null = null;
useWorkspace.subscribe((state, prev) => {
  if (state.drafts === prev.drafts || pending !== null) return;
  pending = window.setTimeout(() => {
    pending = null;
    try {
      storage()?.setItem(KEY, JSON.stringify(useWorkspace.getState().drafts));
    } catch {
      /* quota — drafts last this session */
    }
  }, 500);
});

/** Which draft the open project uses: its cloud id, else the local plan. */
export function projectKey(): string {
  const active = useCloud.getState().active;
  if (active) return `cloud:${active.id}`;
  const p = useStore.getState().project;
  return `local:${p.id ?? p.templateId ?? 'plan'}`;
}

export function useProjectKey(): string {
  const activeId = useCloud((s) => s.active?.id);
  const pid = useStore((s) => s.project.id ?? s.project.templateId ?? 'plan');
  return activeId ? `cloud:${activeId}` : `local:${pid}`;
}

export function useDraft(): QuoteDraft | undefined {
  const key = useProjectKey();
  return useWorkspace((s) => s.drafts[key]);
}

const NO_ITEMS: ModularItem[] = [];

export function useModularItems(): ModularItem[] {
  const key = useProjectKey();
  return useWorkspace((s) => s.previewItems ?? s.drafts[key]?.modular ?? NO_ITEMS);
}

export function setDraft(key: string, draft: QuoteDraft) {
  useWorkspace.setState((s) => ({ drafts: { ...s.drafts, [key]: { ...draft, updatedAt: new Date().toISOString() } } }));
}

export function patchDraft(key: string, patch: Partial<QuoteDraft>) {
  const cur = useWorkspace.getState().drafts[key];
  if (!cur) return;
  setDraft(key, { ...cur, ...patch });
}
