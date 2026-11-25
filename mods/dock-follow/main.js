// dock-follow: the window's housekeeping, in a 0px block of the terminals-dock layout
// (it draws nothing). The name is kept so the layouts' block id does not change.
//
// Since spec 004 (herdr-mods) the dock shows the native nav and git panels, which
// follow the focused terminal themselves; this mod no longer drives yazi or lazygit.
// What it does:
//   - starts the usage strip (hayami-tui) when it is missing, e.g. after a reboot;
//   - sets the window title, so the two njv-cachyos windows (default, work) differ;
//   - resumes Claude conversations a herdr-core restart ended (see resumeAgents);
//   - reads the agent request inbox (inbox.js, spec 005).
//
// Only this machine's terminals count as the usage strip and Claude terminals:
// terminals() also lists other machines' terminals, which may carry the same names.

import { View, div } from "gpui-kit";
import { terminals, hc, exec, home, appHome, checking, nextCommand, notify, run, setWindowTitle } from "herdr";
import { Inbox } from "./inbox.js"; // herdr-mods spec 005: agent requests

// The user's login PATH, for the usage strip started with hc run (herdr-core
// started over SSH may have only /usr/bin:/bin).
let userPath = null;
async function withPath(argv) {
  userPath ??= exec("/bin/sh", ["-c", 'printf %s "$PATH"']).then((r) => r.stdout.trim()).catch(() => "");
  const p = await userPath;
  return p ? ["env", `PATH=${p}`, ...argv] : argv;
}
const USAGE = "usage";
// A block whose terminal didn't exist yet stays empty until shown again.
const BLOCK = { [USAGE]: "usage-dock" };
const USAGE_CHECK = 10000;

const term = (name) => terminals().find((t) => t.name === name && t.state === "live" && !t.address.includes("/"));

async function start(name, argv, cwd) {
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", cwd, "--", ...(await withPath(argv))]);
  if (r.code !== 0) {
    notify({ title: `Dock: starting ${name} failed`, body: (r.stderr || r.stdout).trim().slice(0, 300), level: "error" });
    return;
  }
  run("layout.hide", { id: BLOCK[name] });
  run("layout.show", { id: BLOCK[name] });
}

export default class DockFollow extends View {
  init(_props, cx) {
    if (checking()) return;
    this.inbox = new Inbox(cx);
    // Which session this window is, for the taskbar and KWin rules: both
    // windows share the app id "herdr-app", so the title tells them apart.
    setWindowTitle(/-work$/.test(appHome()) ? "Herdr (work)" : "Herdr (default)");
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "resume") await this.resumeAgents(cx, true);
      }
    });
    // The usage strip: now, and whenever it has gone.
    this.ensure();
    cx.timer.every(USAGE_CHECK, () => this.ensure());
    // Resume Claude conversations a herdr-core restart (reboot) ended: now,
    // and whenever the core has restarted since the last look.
    this.coreStart = 0;
    cx.spawn(async (cx) => {
      await cx.sleep(3000);
      for (;;) {
        try { await this.resumeAgents(cx, false); } catch (e) { console.log("resumeAgents", String(e)); }
        await cx.sleep(30000);
      }
    });
  }

  // When this window's herdr-core started (epoch ms), from `hc server status`.
  async coreStarted() {
    const r = await hc(["server", "status", "--json"]);
    if (r.code !== 0) return 0;
    const s = JSON.parse(r.stdout);
    return s.uptime_ms != null ? Date.now() - s.uptime_ms : 0;
  }

  // A terminal the herdr-app-claude-tag.sh hook labelled with a conversation
  // before the core (re)started, and which no longer runs Claude, lost that
  // Claude to the restart: type the resume into its restored shell. `force`
  // (palette "Resume Claude conversations") skips the core-restart check.
  async resumeAgents(cx, force) {
    const started = await this.coreStarted();
    if (!force && (!started || Math.abs(started - this.coreStart) < 5000)) return;
    this.coreStart = started;
    const work = /-work$/.test(appHome());
    const resumed = [];
    for (const t of terminals()) {
      const sid = t.labels?.["claude.session"];
      // This machine's terminals only: another machine's labels belong to
      // the app (and core restarts) over there.
      if (!sid || t.state !== "live" || t.address.includes("/")) continue;
      if (t.agent === "claude-code" || t.program?.key === "claude") continue;
      const at = Number(t.labels?.["claude.at"] ?? 0);
      if (!force && at >= started) continue;
      if (!/^[0-9a-f-]{8,}$/i.test(sid)) continue;
      const profile = t.labels?.["claude.profile"];
      const cmd = profile === "work" ? "claude-work" : profile === "max" ? "claude-max" : work ? "claude-work" : "claude-max";
      await hc(["label", t.address, `claude.at=${Date.now()}`]);
      await hc(["send", t.address, ` ${cmd} --resume ${sid}`]);
      resumed.push(t.where || t.address);
    }
    if (resumed.length) notify({ title: `Resumed ${resumed.length} Claude session${resumed.length > 1 ? "s" : ""}`, body: resumed.join(", "), level: "info" });
  }


  async ensure() {
    if (this.starting || term(USAGE)) return;
    this.starting = true;
    try { await start(USAGE, ["hayami-tui", "--sections", "usage", "--arrangement", "row"], home()); }
    finally { this.starting = false; }
  }

  render() {
    return div();
  }
}
