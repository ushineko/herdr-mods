// The per-tab nav + git panel: a port of the herdr TUI's prefix+y /
// prefix+shift+Y (~/.config/herdr/scripts/herdr-panel-toggle.sh).
//
// Since spec 004 (herdr-mods) the panel is the native nav and git mods, not yazi and
// lazygit: "panel:nav" beside the main pane (right, ~32% wide) or under it
// (portrait, half the height), and "panel:git" under nav. Both follow the focused
// terminal themselves, on any machine. Pressing the key again with a panel open in
// the tab closes both.

import { panes, focused, run, notify, settings } from "herdr";

const PANEL_SHARE = 0.32; // landscape: the panel's share of the main pane's width

const isPanel = (p) => (p.name ?? "").startsWith("panel:");

// Split `pane` with a mod and wait for the new mod pane to appear in `tab`.
async function splitMod(cx, pane, tab, direction, mod) {
  const before = new Set(panes().map((p) => p.pane));
  run("pane.split", { direction, pane, mod });
  for (let i = 0; i < 50; i++) {
    await cx.sleep(100);
    const np = panes().find((p) => p.tab === tab && !before.has(p.pane) && p.mod === mod);
    if (np) return np;
  }
  return null;
}

export async function toggle(cx, mode, sizes) {
  const f = focused();
  if (!f?.pane) return;
  const inTab = panes().filter((p) => p.tab === f.tab);
  const open = inTab.filter(isPanel);
  if (open.length) {
    for (const p of open) run("pane.close", { pane: p.pane });
    return;
  }

  // Split the focused pane, unless focus is in a panel: then the tab's first other pane.
  const cur = inTab.find((p) => p.pane === f.pane);
  const main = cur && !isPanel(cur) && cur.terminal ? cur : inTab.find((p) => !isPanel(p) && p.terminal);
  if (!main) return;
  const width = (sizes.get(main.pane)?.width ?? 0) / (Number(settings().zoom) || 1);
  const portrait = mode === "portrait";

  const nav = await splitMod(cx, main.pane, f.tab, portrait ? "down" : "right", "nav");
  if (!nav) { notify({ title: "Panel: nav didn't appear", level: "error" }); return; }
  run("pane.rename", { pane: nav.pane, name: "panel:nav" });
  if (!portrait && width > 0) run("pane.resize", { pane: nav.pane, direction: "right", px: Math.round(width * (0.5 - PANEL_SHARE)) });

  const git = await splitMod(cx, nav.pane, f.tab, portrait ? "right" : "down", "git");
  if (git) run("pane.rename", { pane: git.pane, name: "panel:git" });
  else notify({ title: "Panel: git didn't appear", level: "error" });
  run("pane.focus", { pane: main.pane });
}
