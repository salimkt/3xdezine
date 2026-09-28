/**
 * Inline 16px icons. Small enough that a sprite or a dependency would cost more
 * than it saves, and they inherit `currentColor` so they pick up panel state.
 */
interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function IconCheck({ size = 10, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.4} className={className}>
      <path d="M3 8.5 6.2 11.6 13 4.6" />
    </svg>
  );
}

export function IconChevron({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function IconInfo({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.3v4" />
      <path d="M8 4.9v.5" />
    </svg>
  );
}

export function IconAlert({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 1.9 15 14H1z" />
      <path d="M8 6.4v3.4" />
      <path d="M8 11.7v.4" />
    </svg>
  );
}

export function IconDownload({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 1.9v8.4" />
      <path d="M4.6 7.2 8 10.5l3.4-3.3" />
      <path d="M2.4 13.4h11.2" />
    </svg>
  );
}

/** The Android robot head, reduced to strokes so it sits with the other icons. */
export function IconAndroid({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M11.05 2.2 11.9.75a.29.29 0 0 0-.5-.29l-.87 1.47A5.5 5.5 0 0 0 8 1.45c-.9 0-1.76.17-2.53.48L4.6.46a.29.29 0 0 0-.5.29l.85 1.45A4.63 4.63 0 0 0 2.5 6.1h11a4.63 4.63 0 0 0-2.45-3.9ZM5.3 4.62a.56.56 0 1 1 0-1.12.56.56 0 0 1 0 1.12Zm5.4 0a.56.56 0 1 1 0-1.12.56.56 0 0 1 0 1.12ZM2.5 6.9v5.28c0 .5.4.9.9.9h.86v2.06a.96.96 0 1 0 1.92 0v-2.06h1.9v2.06a.96.96 0 1 0 1.93 0v-2.06h.85c.5 0 .9-.4.9-.9V6.9Zm-1.54-.05a.96.96 0 0 0-.96.96v3.44a.96.96 0 1 0 1.92 0V7.81a.96.96 0 0 0-.96-.96Zm14.08 0a.96.96 0 0 0-.96.96v3.44a.96.96 0 1 0 1.92 0V7.81a.96.96 0 0 0-.96-.96Z" />
    </svg>
  );
}
