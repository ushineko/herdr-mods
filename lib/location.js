// Where the person is working: the focused tab pane's terminal folder and machine
// (spec 002 R1, 003 R1). Not pure: reads herdr's live data.
// Layout blocks (dock shells, the usage strip) and mod panes (nav, git, a viewer) do
// not count: callers keep the last location while one of those has focus.
import { spaces, panes, focused, terminals } from "herdr";

/** { cwd, on, space } for the focused terminal pane, or null. */
export function terminalLocation() {
  const f = focused();
  if (!f?.pane) return null;
  const pane = panes().find((p) => p.pane === f.pane);
  if (!pane) return null;
  if (!pane.terminal) return chatLocation(pane.pane, f.space);
  let cwd = pane.cwd;
  if (f.shown && f.shown !== pane.terminal) {
    const shown = terminals().find((t) => t.address === f.shown || t.id === f.shown);
    cwd = shown?.cwd ?? cwd;
  }
  if (!cwd) return null;
  const space = spaces().find((s) => s.id === f.space) ?? spaces().find((s) => s.active);
  return { cwd, on: space?.machine ?? null, space: space?.id ?? null };
}

// A chat pane (spec 008) stands for the agent it shows: that terminal carries the
// label ushi.chat=<chat pane>. Its program's folder, else its own.
// The label holds the pane id without its machine part (one form for every window).
function chatLocation(paneId, spaceId) {
  const local = (id) => String(id ?? "").slice(String(id ?? "").lastIndexOf("/") + 1);
  const t = terminals().find((x) => x.state === "live" && x.labels?.["ushi.chat"] && local(x.labels["ushi.chat"]) === local(paneId));
  const cwd = t?.foreground?.cwd || t?.cwd;
  if (!cwd) return null;
  const space = spaces().find((s) => s.id === spaceId) ?? spaces().find((s) => s.active);
  return { cwd, on: space?.machine ?? null, space: space?.id ?? null };
}

/**
 * A location to start from when no terminal pane has focus (a panel just opened or
 * reloaded): a terminal pane in the shown tab (the focused space's), else the space's folder.
 */
export function fallbackLocation() {
  const f = focused();
  const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
  if (!space) return null;
  const tab = f?.tab ?? space.tabs.find((t) => t.active)?.id;
  const pane = panes().find((p) => p.tab === tab && p.terminal && p.cwd);
  if (pane) return { cwd: pane.cwd, on: space.machine ?? null, space: space.id };
  return space.folder ? { cwd: space.folder, on: space.machine ?? null, space: space.id } : null;
}

/** The space shown in the window (the focused one), or null. */
export function shownSpace() {
  return focused()?.space ?? spaces().find((s) => s.active)?.id ?? null;
}
