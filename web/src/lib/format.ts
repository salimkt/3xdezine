import type { Unit } from '@shared/types';

export function money(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function moneyPrecise(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
