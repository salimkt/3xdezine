import type { Address, Party, PaymentMilestone, StudioProfile } from '@shared/business';

/**
 * Starting values for a studio that hasn't filled in its profile yet, and for
 * a new quote. Every one is editable; they are here so a first quote is
 * credible rather than empty. Milestones follow the modular-factory pattern
 * in docs/research/04-workflows.md §4.1, tied to artefacts, not dates.
 */

export const DEFAULT_MILESTONES: Array<{ label: string; pct: number; trigger: PaymentMilestone['trigger'] }> = [
  { label: 'Booking, on signing this quotation', pct: 10, trigger: 'ON_SIGNING' },
  { label: 'Design sign-off / production start', pct: 50, trigger: 'ON_APPROVAL' },
  { label: 'Before dispatch of material to site', pct: 35, trigger: 'ON_DELIVERY' },
  { label: 'On handover and snag-list closure', pct: 5, trigger: 'ON_HANDOVER' },
];

export const DEFAULT_TERMS: string[] = [
  'Rates are exclusive of GST unless stated; GST is charged as applicable on the date of invoice.',
  'Quantities are derived from the drawing and will be re-measured on site; billing is on actual measured quantities at the quoted rates.',
  'Any change in scope, specification or brand after approval is carried out only through a written, client-approved variation order.',
  'Work starts on receipt of the booking amount and site handover; timelines run from design sign-off.',
  'Material and finish samples, once approved, are binding. Natural materials (stone, veneer) vary in grain and shade.',
  'Warranty: 1 year on workmanship; hardware and appliances as per manufacturer’s warranty.',
];

export const DEFAULT_EXCLUSIONS: string[] = [
  'Civil and structural work not listed above (breaking, core cutting, new walls)',
  'Society / building permissions, deposits and NOCs',
  'Loose furniture, soft furnishings, décor and appliances unless itemised',
  'Electrical fixtures (lights, fans) and sanitary ware unless itemised',
  'Debris removal beyond the building premises',
];

export const DEFAULT_INCLUSIONS: string[] = [
  'Design, 3D views and working drawings for the rooms listed',
  'Supply, installation and finishing of all items listed above',
  'Site supervision and final cleaning before handover',
];

export const EMPTY_ADDRESS: Address = { line1: '', city: '', pin: '', stateName: 'Maharashtra', stateCode: '27' };

export const EMPTY_PARTY: Party = { legalName: '', address: EMPTY_ADDRESS };

export function defaultStudio(): StudioProfile {
  return {
    id: `local-${Math.random().toString(36).slice(2, 10)}`,
    legalName: '',
    address: { ...EMPTY_ADDRESS },
    gstRegistration: 'UNREGISTERED',
    turnoverAbove5Cr: false,
    defaultTerms: [...DEFAULT_TERMS],
    defaultMilestones: DEFAULT_MILESTONES.map(({ label, pct }) => ({ label, pct })),
    numberPrefix: 'QT',
  };
}

/** A studio profile with every required field present, whatever was stored. */
export function normaliseStudio(s: StudioProfile | null | undefined): StudioProfile {
  const d = defaultStudio();
  if (!s) return d;
  return {
    ...d,
    ...s,
    address: { ...d.address, ...(s.address ?? {}) },
    defaultTerms: s.defaultTerms?.length ? s.defaultTerms : d.defaultTerms,
    defaultMilestones: s.defaultMilestones?.length ? s.defaultMilestones : d.defaultMilestones,
    numberPrefix: s.numberPrefix || d.numberPrefix,
  };
}

/** Maps a studio's default milestones (label + pct) to quote milestones with triggers. */
export function milestonesFromStudio(studio: StudioProfile) {
  const triggers: PaymentMilestone['trigger'][] = ['ON_SIGNING', 'ON_APPROVAL', 'ON_DELIVERY', 'ON_HANDOVER'];
  return studio.defaultMilestones.map((m, i) => ({
    label: m.label,
    pct: m.pct,
    trigger: triggers[Math.min(i, triggers.length - 1)],
  }));
}
