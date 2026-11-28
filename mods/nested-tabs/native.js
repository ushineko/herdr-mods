// Native nested tabs (spec 023): on a fork window of the app (its spec 001), a
// stack is the app's own, and the strip drives it with commands. Elsewhere
// (a released window) stack.js's label-based nested tabs are used.

import { panes, run, hc, exec, window } from "herdr";
import * as S from "./stack.js";

// A short wait, with this computer's own sleep (the window may be Windows).
const pause = () => (window().platform === "windows"
  ? exec("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 100"])
  : exec("sh", ["-c", "sleep 0.1"]));

/** Shows a member and focuses it. */
export const show = (pane) => run("pane.show", { pane });

/** Closes a member (its terminal ends); its neighbour is shown. */
export const close = (pane) => run("pane.close", { pane });

/** Moves a member `by` places among its stack's members, wrapping. */
export const moveBy = (pane, by) => run("pane.move_in_stack", { pane, by });

/** Moves a member to position `index` (from 0) among its stack's members. */
export const moveTo = (pane, index) => run("pane.move_in_stack", { pane, index: index + 1 });

/** Takes a member out of its stack, beside it ("right" or "down"). */
export const unstack = (pane, direction) => run("pane.unstack", { pane, direction });

/**
 * A new member of `pane`'s stack (a stack of it, if it's in none): a shell in the
 * shown member's folder. With `command`, it's typed into the shell, as the
 * label-based + does, so the shell stays when the command ends.
 */
export async function add(pane, command) {
  const before = new Set(panes().map((p) => p.pane));
  run("pane.stack", { pane });
  if (!command) return;
  for (let i = 0; i < 40; i++) {
    const added = panes().find((p) => !before.has(p.pane) && p.terminal);
    if (added) {
      await hc(["send", added.terminal, command]);
      return;
    }
    await pause();
  }
}

// Panes whose label-based nested tabs are being converted (once each).
const converting = new Set();

/**
 * Turns the label-based nested tabs of pane `pane` (own terminal `base`) into
 * members of its native stack (spec 023 D2): the stand-in goes, each nested
 * terminal loses `nt.stack` and joins the stack, in the strip's order, and the
 * one that was shown is shown again.
 */
export async function convert(pane, base) {
  if (converting.has(pane)) return;
  converting.add(pane);
  try {
    const kids = S.members(pane, base).filter((m) => !m.base).map((m) => m.address);
    if (!kids.length) return;
    const shown = S.shownOf(pane, base);
    run("terminal.show", { pane });
    for (const addr of kids) {
      await hc(["label", addr, `${S.LABEL}=`]);
      run("terminal.keep", { terminal: addr, place: "stack", pane, focus: false });
    }
    const paneOf = (a) => panes().find((p) => p.terminal === a)?.pane;
    for (let i = 0; i < 50 && kids.some((a) => !paneOf(a)); i++) await pause();
    // Each keep lands after the shown member: put them back in the strip's order,
    // one at a time (run() doesn't keep calls in order).
    for (const [i, a] of kids.entries()) {
      const p = paneOf(a);
      if (p) moveTo(p, i + 1);
      await pause();
    }
    if (shown !== base && paneOf(shown)) run("pane.show", { pane: paneOf(shown), focus: false });
  } finally {
    converting.delete(pane);
  }
}
