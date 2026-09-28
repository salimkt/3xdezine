import type { Unit } from '@shared/types';

/**
 * Indian rupee figures group in lakhs and crores (12,92,447), not thousands.
 * Formatting an INR total with an en-US grouping reads as a foreign price list,
 * so the locale follows the currency rather than the other way round.
 */
function localeFor(currency: string): string {
  return currency === 'INR' ? 'en-IN' : 'en-US';
}

export function money(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat(localeFor(currency), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function moneyPrecise(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat(localeFor(currency), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Short form for chart labels and tight columns — `₹12.9L`, `$1.3M`. Falls back
 * to the full format wherever `notation: 'compact'` is unsupported.
 */
export function moneyCompact(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return money(value, currency);
  }
}

const UNIT_LABEL: Record<Unit, string> = {
  SQM: 'm²',
  LITER: 'L',
  LINEAR_M: 'lm',
  EACH: '×',
};

export function unitLabel(unit: Unit): string {
  return UNIT_LABEL[unit] ?? unit;
}

export function quantity(value: number, unit: Unit): string {
  if (unit === 'EACH') return `${value} ${UNIT_LABEL.EACH}`;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unitLabel(unit)}`;
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function metres(value: number): string {
  return `${value.toFixed(2)} m`;
}

export function area(value: number): string {
  return `${value.toFixed(1)} m²`;
}
