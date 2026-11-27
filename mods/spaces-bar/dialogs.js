// The two switcher dialogs (Ctrl+Tab, Ctrl+Space) share one slot: opening one closes
// the other, so they never stack (Ctrl held for one plus Space or Tab would open the
// other over it). Each says how to close itself and forget its state.
import { openOverlay, closeOverlay } from "herdr";

let current = null; // { kind, id, closed }

/** Opens dialog `kind` (overlay options `opts`), closing the other one first. */
export function openDialog(kind, opts, closed) {
  if (current) { closeOverlay(current.id); current.closed?.(); }
  current = { kind, id: openOverlay(opts), closed };
}

/** Which dialog is open, as far as this slot knows ("switch", "find" or null). */
export const openKind = () => current?.kind ?? null;

/** Forgets dialog `kind` once it has closed itself. */
export function dialogClosed(kind) {
  if (current?.kind === kind) current = null;
}
