import { clamp } from './motion';

/**
 * Where the sun is, for a clock time at the site. Defaults to Mumbai
 * (19.08°N, 72.88°E); India runs on one time zone at 82.5°E, so solar noon in
 * Mumbai lands near 12:39 IST, and that offset is applied.
 *
 * Accuracy target: the shadows have to read right, not predict an eclipse.
 * Declination uses Cooper's approximation; the equation of time is ignored.
 */
export const SITE = { latitudeDeg: 19.08, longitudeDeg: 72.88, zoneMeridianDeg: 82.5 };

export const SUN_MIN_HOUR = 6;
export const SUN_MAX_HOUR = 19;

const RAD = Math.PI / 180;

export interface SunState {
  /** Unit vector toward the sun, in world space (x east, y up, z south). */
  dir: { x: number; y: number; z: number };
  altitudeDeg: number;
  azimuthDeg: number;
  /** 0 at high sun, 1 at the horizon — drives colour and exposure. */
  warmth: number;
  /** 0..1 multiplier on the configured sun intensity. */
  strength: number;
  /** 0 in daylight, 1 once the sun is 6° below the horizon (civil dusk). */
  twilight: number;
  color: string;
}

export function dayOfYear(date = new Date()) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const NOON: [number, number, number] = [0xff, 0xf3, 0xe0];
const GOLDEN: [number, number, number] = [0xff, 0x9e, 0x5a];

export function sunAt(clockHour: number, day = dayOfYear()): SunState {
  const phi = SITE.latitudeDeg * RAD;
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const solarHour = clockHour - (SITE.zoneMeridianDeg - SITE.longitudeDeg) / 15;
  const H = 15 * (solarHour - 12) * RAD;

  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  // Measured from south, positive toward west; +180° makes it a compass bearing.
  const azFromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const az = azFromSouth + Math.PI;

  const east = Math.sin(az) * Math.cos(alt);
  const north = Math.cos(az) * Math.cos(alt);
  const altDeg = alt / RAD;
  const warmth = 1 - smoothstep(3, 32, altDeg);
  // Fades in over the first degrees above the horizon; air mass dims it low.
  const strength = smoothstep(-0.5, 6, altDeg) * (0.5 + 0.5 * smoothstep(4, 40, altDeg));

  return {
    // Keep the light a hair above the horizon so the shadow camera never flips.
    dir: normalise({ x: east, y: Math.max(Math.sin(alt), 0.035), z: -north }),
    altitudeDeg: altDeg,
    azimuthDeg: ((az / RAD) % 360 + 360) % 360,
    warmth,
    strength,
    twilight: 1 - smoothstep(-6, 1, altDeg),
    color: mix(NOON, GOLDEN, warmth ** 1.3),
  };
}

function normalise(v: { x: number; y: number; z: number }) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function formatClock(hour: number) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const hh = m === 60 ? h + 1 : h;
  return `${String(hh).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}
