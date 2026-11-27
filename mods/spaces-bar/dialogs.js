// The two switcher dialogs (Ctrl+Tab, Ctrl+Space) share one slot: opening one closes
// the other, so they never stack (Ctrl held for one plus Space or Tab would open the
// other over it). Each says how to close itself and forget its state.
//
// Closing one gives the keyboard back to the pane it came from (focused()'s pane, and
// a chat there through ushi-naruse's request): Herdr leaves it with nobody otherwise.
// Esc, and a click beside the dialog, are the app's: it closes the dialog without
// telling the mod, so a dialog that stops drawing (alive) counts as closed (watch).
import { openOverlay, closeOverlay, focused, run, setShared } from "herdr";

let current = null; // { kind, id, closed, alive }

/** Opens dialog `kind` (overlay options `opts`), closing the other one first. */
export function openDialog(kind, opts, closed) {
  if (current) { closeOverlay(current.id); current.closed?.(); }
  current = { kind, id: openOverlay(opts), closed, alive: Date.now() };
}

/** Which dialog is open, as far as this slot knows ("switch", "find" or null). */
export const openKind = () => current?.kind ?? null;

/** Stamped by the open dialog as it draws and on a timer: it is still there. */
export function alive() {
  if (current) current.alive = Date.now();
}

/** The keyboard back to the shown tab's focused pane (and its chat, if one is there). */
export function refocus() {
  const pane = focused()?.pane;
  if (pane) run("pane.focus", { pane });
  setShared("ushi-naruse.focus-request", Date.now());
}

/**
 * Forgets dialog `kind` once it has closed itself. `back`: the keyboard goes back to
 * the pane (a cancel); a switch to something gives it to what it shows instead.
 */
export function dialogClosed(kind, back = false) {
  if (current?.kind !== kind) return;
  current = null;
  if (back) refocus();
}

/** From the bar copy's timer: a dialog not seen drawing for 700 ms was closed by the app. */
export function watch() {
  if (!current || Date.now() - current.alive < 700) return;
  current.closed?.();
  current = null;
  refocus();
}
