import { create } from 'zustand';
import type { Entitlements, PlanId, StudioProfile } from '@shared/business';

/**
 * Business state the shell needs before any business chunk has loaded: which
 * plan the account is on, the studio profile, and which business dialog is
 * open. Plain data only — the engines (quote, trades, modular, plans) live in
 * the lazy chunks that use them, so none of them reach the first paint.
 *
 * `entitlements: null` means "not known", which every consumer treats as FREE:
 * the no-cloud build never learns anything else, and that is correct.
 */

export type BizDialog = 'settings' | 'ratecard' | 'pricing' | null;

export interface PricingIntent {
  /** Why the pricing page opened, shown as its lead ("You have 2 active projects..."). */
  reason?: string;
  /** Offer a Project Pass for this cloud project. */
  projectId?: string;
}

interface BizState {
  entitlements: Entitlements | null;
  /** Studio profile: from the cloud when signed in, else from this browser. */
  studio: StudioProfile | null;
  studioSource: 'none' | 'local' | 'cloud';
  dialog: BizDialog;
  pricing: PricingIntent;
  /** The studio's Quote tab. */
  quoteOpen: boolean;
}

const STUDIO_KEY = 'dezine.studio.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadLocalStudio(): StudioProfile | null {
  try {
    const raw = storage()?.getItem(STUDIO_KEY);
    return raw ? (JSON.parse(raw) as StudioProfile) : null;
  } catch {
    return null;
  }
}

export function saveLocalStudio(studio: StudioProfile) {
  try {
    storage()?.setItem(STUDIO_KEY, JSON.stringify(studio));
  } catch {
    /* quota — the profile lasts this session */
  }
}

const initialStudio = typeof window === 'undefined' ? null : loadLocalStudio();

export const useBiz = create<BizState>(() => ({
  entitlements: null,
  studio: initialStudio,
  studioSource: initialStudio ? 'local' : 'none',
  dialog: null,
  pricing: {},
  quoteOpen: false,
}));

export function openPricing(intent: PricingIntent = {}) {
  useBiz.setState({ dialog: 'pricing', pricing: intent });
}

export const PLAN_LABEL: Record<PlanId, string> = {
  FREE: 'Free',
  PROJECT_PASS: 'Project Pass',
  SOLO: 'Solo',
  STUDIO: 'Studio',
  BUSINESS: 'Business',
};

export function currentPlan(): PlanId {
  return useBiz.getState().entitlements?.plan ?? 'FREE';
}

// ---------------------------------------------------------------------------
// The client approval route: #/q/<token>
// ---------------------------------------------------------------------------

/** `#/q/<token>` — a hash route, so it survives the Pages base path untouched. */
export function quoteTokenFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const m = /^#\/q\/([A-Za-z0-9_-]{6,})/.exec(location.hash);
  return m ? m[1] : null;
}

export function quoteShareUrl(token: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/q/${token}`;
}
