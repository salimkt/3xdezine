import { base, type IconProps } from './icons';

/** Studio-only icons — see icons.tsx. */

export function IconCheck({ size = 10, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.4} className={className}>
      <path d="M3 8.5 6.2 11.6 13 4.6" />
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

export function IconPlus({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function IconMinus({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

/** Four corner brackets: "frame everything". */
export function IconFit({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.8 6V2.8H6M10 2.8h3.2V6M13.2 10v3.2H10M6 13.2H2.8V10" />
    </svg>
  );
}

export function IconLock({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

export function IconHome({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 7.4 8 2.8l5.5 4.6" />
      <path d="M4 6.3v6.9h8V6.3" />
    </svg>
  );
}

export function IconSun({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" />
    </svg>
  );
}

export function IconPlay({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 3.4v9.2l7.4-4.6z" fill="currentColor" />
    </svg>
  );
}

export function IconPause({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
    </svg>
  );
}
