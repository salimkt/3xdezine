/**
 * One door to the shared business engines for the web client. The client
 * computes previews locally with exactly the engines the server runs; the
 * server recomputes and is authoritative for saved and issued documents.
 */
import { GST_STATES as ALL_STATES, gstState, validateGstin } from '@shared/gst';

export { formatINR, amountInWords, toSqft, toRft, SQFT_PER_SQM, FT_PER_M } from '@shared/money';
export { allowedDocTypes, chargesGst, placeOfSupply, validateGstin } from '@shared/gst';

/** States a new address may use (merged/retired codes are only for reading old GSTINs). */
export const GST_STATES = ALL_STATES.filter((s) => s.active);

export function stateName(code: string): string {
  return gstState(code)?.name ?? '';
}

export function checkGstin(gstin: string): { ok: boolean; stateCode?: string; pan?: string; message?: string } {
  const r = validateGstin(gstin);
  return { ok: r.valid, stateCode: r.stateCode, pan: r.pan, message: r.reason };
}
