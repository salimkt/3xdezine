/** Shape validation for PlanEdit[] arriving from clients. */
import type { Opening, PlanEdit } from './domain/types.ts';
import { invalid } from './http.ts';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => isObj(v) && isNum(v.x) && isNum(v.z);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

export const MAX_EDITS = 50;

export function parseEdits(v: unknown): PlanEdit[] {
  if (!Array.isArray(v) || v.length === 0) throw invalid('`edits` must be a non-empty list.');
  if (v.length > MAX_EDITS) throw invalid(`A proposal can hold at most ${MAX_EDITS} edits.`);
  return v.map((e, i): PlanEdit => {
    const bad = () => invalid(`Edit ${i + 1} is malformed.`);
    if (!isObj(e)) throw bad();
    switch (e.kind) {
      case 'MOVE_CORNER':
        if (!isVec(e.from) || !isVec(e.to)) throw bad();
        return { kind: 'MOVE_CORNER', from: { x: (e.from as any).x, z: (e.from as any).z }, to: { x: (e.to as any).x, z: (e.to as any).z } };
      case 'MOVE_OPENING':
        if (!isId(e.openingId) || !isNum(e.t)) throw bad();
        return { kind: 'MOVE_OPENING', openingId: e.openingId, t: e.t };
      case 'RESIZE_OPENING':
        if (!isId(e.openingId) || !isNum(e.widthM) || e.widthM <= 0) throw bad();
        return { kind: 'RESIZE_OPENING', openingId: e.openingId, widthM: e.widthM };
      case 'REMOVE_OPENING':
        if (!isId(e.openingId)) throw bad();
        return { kind: 'REMOVE_OPENING', openingId: e.openingId };
      case 'ADD_OPENING': {
        const o = e.opening;
        if (!isObj(o) || !isId(o.id) || !isId(o.wallId) || !isNum(o.t) || !isNum(o.widthM) || !isNum(o.heightM) || !isNum(o.sillM)) throw bad();
        if (o.componentId !== undefined && !isId(o.componentId)) throw bad();
        const opening: Opening = { id: o.id, wallId: o.wallId, t: o.t, widthM: o.widthM, heightM: o.heightM, sillM: o.sillM };
        if (o.componentId) opening.componentId = o.componentId as string;
        return { kind: 'ADD_OPENING', opening };
      }
      default:
        throw invalid(`Edit ${i + 1} has an unknown kind.`);
    }
  });
}
