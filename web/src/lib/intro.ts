import { clamp, easeOutCubic, prefersReducedMotion } from './motion';

/**
 * The "build-up" that plays when a plan is opened from the home screen: floor
 * slabs settle in, walls rise from the slab in a ripple out from the centre,
 * doors, windows and furniture follow, and the camera swings down into the
 * framed orbit view.
 *
 * Module state rather than React state: every wall reads it per frame inside
 * `useFrame`, and nothing about it should cause a re-render. The clock only
 * starts once the renderer has presented a frame, so a cold start's shader
 * compile never eats the animation.
 */
export const INTRO_MS = 1500;

interface IntroState {
  /** An intro is wanted (or running). */
  pending: boolean;
  /** performance.now() at the first presented frame; -1 until then. */
  start: number;
  /** Bumped per request, so rigs can tell one intro from the next. */
  seq: number;
}

const state: IntroState = { pending: false, start: -1, seq: 0 };
export type SkipSource = 'canvas' | 'other';
const skipListeners = new Set<(source: SkipSource) => void>();

export function requestIntro() {
  state.seq++;
  state.start = -1;
  state.pending = !prefersReducedMotion();
}

export function introSeq() {
  return state.seq;
}

export function introPending() {
  return state.pending;
}

/** Starts the clock; a no-op when nothing is pending or it already runs. */
export function beginIntro(now: number) {
  if (state.pending && state.start < 0) state.start = now;
}

export function introStarted() {
  return state.pending && state.start >= 0;
}

/** Raw progress 0..1; 1 whenever no intro is running. */
export function introProgress(now: number): number {
  if (!state.pending) return 1;
  if (state.start < 0) return 0;
  const t = (now - state.start) / INTRO_MS;
  if (t >= 1) {
    state.pending = false;
    return 1;
  }
  return Math.max(0, t);
}

export function introRemainingMs(now: number) {
  return state.pending && state.start >= 0 ? Math.max(0, INTRO_MS - (now - state.start)) : 0;
}

export function skipIntro(source: SkipSource = 'other') {
  if (!state.pending) return;
  state.pending = false;
  for (const listener of skipListeners) listener(source);
}

export function onIntroSkip(listener: (source: SkipSource) => void) {
  skipListeners.add(listener);
  return () => void skipListeners.delete(listener);
}

/** A phase of the intro: 0 before `from`, 1 after `to`, eased between. */
export function phase(raw: number, from: number, to: number) {
  if (raw >= 1) return 1;
  return easeOutCubic(clamp((raw - from) / (to - from), 0, 1));
}

