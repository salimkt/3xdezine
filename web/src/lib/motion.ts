import { useEffect, useRef, useState } from 'react';

/**
 * The motion vocabulary, shared by every JS-driven animation in the client.
 *
 * CSS transitions read `--ease` / `--dur*` from `styles.css`; these constants
 * mirror them so a tweened viewBox and a transitioned grid track move on the
 * same clock. Keep the two in step.
 */
export const DUR = {
  /** `--dur`: hover, press, colour changes. */
  fast: 130,
  /** `--dur-med`: zoom steps, layout, selection. */
  med: 260,
  /** `--dur-slow`: numbers counting to a new value. */
  slow: 400,
  /** Camera flights. Longer than UI motion because the eye has to track space. */
  flight: 480,
} as const;

// --- easing ---------------------------------------------------------------

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeOutQuart: Easing = (t) => 1 - (1 - t) ** 4;
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- reduced motion -------------------------------------------------------

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Read on every call rather than cached, so the OS setting (or a test that
 * stubs `matchMedia`) takes effect on the very next animation.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

// --- tweens ---------------------------------------------------------------

export interface TweenOptions {
  duration: number;
  ease?: Easing;
  /** Called every frame with the eased progress in [0, 1]. */
  onUpdate: (eased: number, raw: number) => void;
  onComplete?: () => void;
}

/**
 * A rAF tween. Returns its cancel function. Under reduced motion it jumps
 * straight to the end state synchronously — callers need no special case.
 */
export function tween({ duration, ease = easeOutCubic, onUpdate, onComplete }: TweenOptions) {
  if (duration <= 0 || prefersReducedMotion()) {
    onUpdate(1, 1);
    onComplete?.();
    return () => undefined;
  }
  let frame = 0;
  let cancelled = false;
  const start = performance.now();
  const step = (now: number) => {
    if (cancelled) return;
    const raw = clamp((now - start) / duration, 0, 1);
    onUpdate(ease(raw), raw);
    if (raw < 1) frame = requestAnimationFrame(step);
    else onComplete?.();
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

/**
 * One animation channel per target: starting a tween cancels whatever the
 * channel was running, so rapid clicks retarget instead of queueing or fighting.
 */
export class TweenSlot {
  private stop: (() => void) | null = null;
  private token: object | null = null;

  get running() {
    return this.token !== null;
  }

  run(options: TweenOptions) {
    this.cancel();
    const token = {};
    this.token = token;
    const stop = tween({
      ...options,
      onComplete: () => {
        if (this.token === token) {
          this.token = null;
          this.stop = null;
        }
        options.onComplete?.();
      },
    });
    // A reduced-motion tween has already finished by the time it returns.
    if (this.token === token) this.stop = stop;
  }

  cancel() {
    this.stop?.();
    this.stop = null;
    this.token = null;
  }
}

// --- hooks ----------------------------------------------------------------

/**
 * A number that counts to its new value instead of jumping, so a repricing is
 * something the user sees happen. Starts at the initial value — no count-up
 * from zero on mount.
 */
export function useAnimatedNumber(target: number, duration: number = DUR.slow): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const slot = useRef<TweenSlot | null>(null);

  useEffect(() => {
    slot.current ??= new TweenSlot();
    const from = current.current;
    if (from === target) return;
    slot.current.run({
      duration,
      ease: easeOutCubic,
      onUpdate: (t) => {
        const value = t >= 1 ? target : lerp(from, target, t);
        current.current = value;
        setShown(value);
      },
    });
  }, [target, duration]);

  useEffect(() => () => slot.current?.cancel(), []);

  return shown;
}
