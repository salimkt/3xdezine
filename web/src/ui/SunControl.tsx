import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { SUN_MAX_HOUR, SUN_MIN_HOUR, formatClock, sunAt } from '../lib/sun';
import { prefersReducedMotion } from '../lib/motion';
import { IconPause, IconPlay, IconSun } from './icons';

/** Hours of daylight swept per second of playback. */
const PLAY_RATE = 1.6;

/**
 * Time of day for the site. Dragging sets the clock; the light eases after it,
 * so shadows sweep through the windows rather than jumping. Play runs the day
 * forward to dusk.
 */
export function SunControl() {
  const hour = useStore((s) => s.render.sunHour);
  const patchRender = useStore((s) => s.patchRender);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    if (!playing) return;
    if (prefersReducedMotion()) {
      patchRender({ sunHour: SUN_MAX_HOUR });
      setPlaying(false);
      return;
    }
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const current = useStore.getState().render.sunHour;
      const next = Math.min(SUN_MAX_HOUR, current + dt * PLAY_RATE);
      patchRender({ sunHour: next });
      if (next >= SUN_MAX_HOUR) setPlaying(false);
      else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, patchRender]);

  const sun = sunAt(hour);
  const fraction = (hour - SUN_MIN_HOUR) / (SUN_MAX_HOUR - SUN_MIN_HOUR);

  return (
    <div className="sun-control" style={{ ['--sun-warmth' as string]: sun.warmth.toFixed(3) }}>
      <button
        className="sun-play"
        onClick={() => {
          if (!playing && hour >= SUN_MAX_HOUR - 0.01) patchRender({ sunHour: SUN_MIN_HOUR });
          setPlaying((p) => !p);
        }}
        title={playing ? 'Pause the day' : 'Play the day through to dusk'}
        aria-label={playing ? 'Pause' : 'Play the day'}
      >
        {playing ? <IconPause size={11} /> : <IconPlay size={11} />}
      </button>
      <IconSun size={13} className="sun-icon" />
      <label className="sun-track">
        <span className="sr-only">Time of day</span>
        <input
          type="range"
          min={SUN_MIN_HOUR}
          max={SUN_MAX_HOUR}
          step={0.05}
          value={hour}
          style={{ ['--fill' as string]: `${(fraction * 100).toFixed(1)}%` }}
          onChange={(event) => {
            setPlaying(false);
            patchRender({ sunHour: Number(event.target.value) });
          }}
          aria-valuetext={`${formatClock(hour)}, sun ${Math.max(0, sun.altitudeDeg).toFixed(0)} degrees up`}
        />
      </label>
      <span className="sun-time mono" title={`Mumbai, 19°N · sun ${sun.altitudeDeg.toFixed(0)}° up, bearing ${sun.azimuthDeg.toFixed(0)}°`}>
        {formatClock(hour)}
      </span>
    </div>
  );
}
