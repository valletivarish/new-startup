/** Do-Not-Disturb (NCPR) lookup for a number before it is dialled. */

export interface DndChecker {
  check(e164: string): Promise<'dnd' | 'ok' | 'unknown'>;
}

// ponytail: no live NCPR lookup yet; swap in the telephony vendor's DND API when the account has it.
export function createNoopDndChecker(): DndChecker {
  return { check: async () => 'unknown' };
}
