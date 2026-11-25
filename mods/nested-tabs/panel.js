// The yazi + lazygit panel: a port of the herdr TUI's prefix+y /
// prefix+shift+Y (~/.config/herdr/scripts/herdr-panel-toggle.sh).
//
// One pane named "panel:yazi" beside the main pane (right, ~32% wide) or under
// it (portrait, half the height). yazi is its shown tab; lazygit runs behind
// it as a nested tab. Quitting yazi ends the pane's own terminal and so the
// whole panel; quitting lazygit closes just its tab. Pressing the key again
// with a panel open in the tab closes it.
//
// Commands are typed into the panes' shells with a leading space, so zsh's
// hist_ignore_space keeps them out of history.

import { panes, focused, run, hc, home, notify, settings, terminals } from "herdr";
import * as S from "./stack.js";

const YAZI = "panel:yazi";
const PANEL_SHARE = 0.32; // landscape: the panel's share of the main pane's width

const isPanel = (p) => (p.name ?? "").startsWith("panel:");
const HINT = {
  win: { yazi: "winget install sxyazi.yazi", lazygit: "winget install JesseDuffield.lazygit" },
  posix: { yazi: "install yazi (brew / your package manager)", lazygit: "install lazygit (brew / your package manager)" },
};

// A pane on another machine may run PowerShell: quote and test for the tool
// in its syntax. The command runs the tool and closes the shell after it
// (so quitting the tool closes its panel tab); a missing tool prints how to
// install it and leaves the shell open.
function runTool(win, tool, args) {
  const hint = (win ? HINT.win : HINT.posix)[tool];
  if (win) {
    const q = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(" ");
    return ` if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} ${q}; exit } else { Write-Host '${tool} is not installed here: ${hint}' -ForegroundColor Yellow }`;
  }
  const q = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
  return ` if command -v ${tool} >/dev/null 2>&1; then ${tool} ${q}; exit; else printf '\\033[33m%s\\033[0m\\n' '${tool} is not installed here: ${hint}'; fi`;
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
  // A remote pane's split lands on the same machine (and its nested tab too).
  const remote = main.terminal.includes("/");
  const dir = main.cwd || (remote ? "" : home());
  const win = /^[A-Za-z]:[\\/]/.test(dir)
    || /pwsh|powershell/i.test(String(terminals().find((t) => t.address === main.terminal)?.agent ?? ""));
  const width = (sizes.get(main.pane)?.width ?? 0) / (Number(settings().zoom) || 1);
  const portrait = mode === "portrait";

  const before = new Set(panes().map((p) => p.pane));
  run("pane.split", { direction: portrait ? "down" : "right", pane: main.pane });
  let np = null;
  // A remote split is an SSH round trip: allow it longer to appear.
  for (let i = 0; i < (remote ? 150 : 50) && !np; i++) {
    await cx.sleep(100);
    np = panes().find((p) => p.tab === f.tab && !before.has(p.pane) && p.terminal);
  }
  if (!np) {
    notify({ title: "Panel: the new pane didn't appear", level: "error" });
    return;
  }

  run("pane.rename", { pane: np.pane, name: YAZI });
  if (!portrait && width > 0) run("pane.resize", { pane: np.pane, direction: "right", px: Math.round(width * (0.5 - PANEL_SHARE)) });

  await S.add(np.pane, np.terminal, runTool(win, "lazygit", []), { show: false, ...(dir ? { cwd: dir } : {}) });
  // A unique DDS client id, so `ya emit-to <id>` can address this yazi.
  const cid = String(Date.now());
  const r = await hc(["send", np.terminal, runTool(win, "yazi", ["--client-id", cid, ...(dir ? [dir] : [])])]);
  if (r.code !== 0) notify({ title: "Panel: starting yazi failed", body: (r.stderr || r.stdout).trim(), level: "error" });
  run("pane.focus", { pane: main.pane });
}
