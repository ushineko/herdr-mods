// Dock follower: one shared yazi and one shared lazygit (layout terminal
// blocks "dock-yazi" / "dock-lazygit") follow the shown tab's folder.
//
// Draws nothing; it sits in a 0px block of the layout so it renders whenever
// focus moves. On a tab change it:
//   - yazi:    `ya emit-to <id> cd <dir>` (yazi runs with a fixed --client-id)
//   - lazygit: only when the git repo changes, switches in place through its
//              Recent repositories menu (esc esc ctrl-r <name> Enter) and checks
//              the result by lazygit's working directory. If the repo isn't in
//              lazygit's recent list or the switch didn't take, it quits
//              lazygit, which its loop restarts in the new repo.
//
// The dock terminals are never killed: the app removes a layout block from the
// layout file when the terminal it shows ends. So each program runs in a
// restart loop reading its folder from a target file, and quitting one (by
// hand or from here) brings it straight back. Missing dock terminals (and the
// usage strip) are started, e.g. after a reboot.
//
// The dock terminals' names carry this window's suffix from
// `<app home>/dock.json` (see dock-tabs). Only this machine's terminals count
// as the local dock, usage strip and Claude terminals: terminals() also lists
// other machines' terminals, which may carry the same names.

import { View, div } from "gpui-kit";
import { focused, terminals, hc, exec, home, appHome, readTextFile, checking, nextCommand, notify, run, setWindowTitle, spaces, shared } from "herdr";
import * as fs from "fs/promises";
import { Inbox } from "./inbox.js"; // herdr-mods spec 005: agent requests

let YAZI = "dock-yazi";
let LAZYGIT = "dock-lazygit";
let namesLoaded = null;
function loadNames() {
  return (namesLoaded ??= readTextFile(`${appHome()}/dock.json`).then((t) => {
    let suffix = "";
    try { suffix = String(JSON.parse(t ?? "{}").suffix ?? ""); } catch {}
    YAZI = `dock-yazi${suffix}`; LAZYGIT = `dock-lazygit${suffix}`;
  }).catch(() => null));
}
// The user's login PATH, for the usage strip started with hc run (herdr-core
// started over SSH may have only /usr/bin:/bin).
let userPath = null;
async function withPath(argv) {
  userPath ??= exec("/bin/sh", ["-c", 'printf %s "$PATH"']).then((r) => r.stdout.trim()).catch(() => "");
  const p = await userPath;
  return p ? ["env", `PATH=${p}`, ...argv] : argv;
}
const USAGE = "usage";
// yazi DDS client id for the dock's yazi, one per session (both run on this machine).
const YAZI_ID = () => (/-work$/.test(appHome()) ? "90002" : "90001");
const DATA = () => `${appHome()}/data/dock`;
const TARGET = (name) => `${DATA()}/${name}.target`;
// lazygit's state file: XDG on Linux, Application Support on macOS.
const LG_STATES = () => [`${home()}/.local/state/lazygit/state.yml`, `${home()}/Library/Application Support/lazygit/state.yml`];

// A block whose terminal didn't exist yet stays empty until shown again.
const BLOCK = { [USAGE]: "usage-dock" };

const term = (name) => terminals().find((t) => t.name === name && t.state === "live" && !t.address.includes("/"));
const base = (p) => p.split("/").filter(Boolean).pop() ?? p;

async function setTarget(name, dir) {
  await fs.mkdir(DATA(), { recursive: true });
  await fs.writeFile(TARGET(name), dir);
}

// Write `text` to `path` on `machine` (hc file write reads stdin; no shell there).
async function writeRemote(machine, path, text) {
  const hcBin = `${home()}/.local/bin/herdr-core`;
  return exec("sh", ["-c", 'printf %s "$1" | "$2" file write --on "$3" "$4"', "sh", text, hcBin, machine, path], { timeout: 30000 });
}

async function start(name, argv, cwd) {
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", cwd, "--", ...(await withPath(argv))]);
  if (r.code !== 0) {
    notify({ title: `Dock: starting ${name} failed`, body: (r.stderr || r.stdout).trim().slice(0, 300), level: "error" });
    return;
  }
  run("layout.hide", { id: BLOCK[name] });
  run("layout.show", { id: BLOCK[name] });
}

// Escape out of any popup, then press `keys`. A pause between them: an esc
// arriving right before a key reads as Alt+key (lazygit 0.56 on macOS ignored
// "esc esc q" sent in one go).
async function escThen(cx, addr, keys) {
  await hc(["keys", addr, "esc", "esc"]);
  await cx.sleep(150);
  return hc(["keys", addr, ...keys]);
}

async function repoRoot(dir) {
  try {
    const r = await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"], { timeout: 5000 });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

async function recentRepos() {
  let text = "";
  for (const p of LG_STATES()) {
    text = (await readTextFile(p).catch(() => null)) ?? "";
    if (text) break;
  }
  const out = [];
  let inList = false;
  for (const line of text.split("\n")) {
    if (/^recentrepos:/.test(line)) { inList = true; continue; }
    if (inList) {
      const m = line.match(/^\s+-\s+(.+?)\s*$/);
      if (m) out.push(m[1].replace(/^["']|["']$/g, ""));
      else if (/^\S/.test(line)) break;
    }
  }
  return out;
}

// The folder lazygit is in now: it changes directory when it switches repo.
// The terminal's own process is the restart loop's shell, so look at its
// lazygit child.
async function lazygitDir() {
  try {
    const info = await hc(["get", LAZYGIT, "--json"]);
    const pid = info.code === 0 ? JSON.parse(info.stdout).pid : null;
    if (!pid) return null;
    const child = await exec("pgrep", ["-P", String(pid), "-x", "lazygit"], { timeout: 3000 });
    const lg = child.stdout.trim().split("\n")[0];
    if (!lg) return null;
    // /proc on Linux; lsof elsewhere (macOS has no /proc).
    const cwd = await exec("readlink", [`/proc/${lg}/cwd`], { timeout: 3000 }).catch(() => null);
    if (cwd?.code === 0 && cwd.stdout.trim()) return cwd.stdout.trim();
    const ls = await exec("lsof", ["-a", "-p", lg, "-d", "cwd", "-Fn"], { timeout: 3000 });
    const n = ls.stdout.split("\n").find((l) => l.startsWith("n"));
    return n ? n.slice(1) : null;
  } catch { return null; }
}

export default class DockFollow extends View {
  init(_props, cx) {
    this.lastKey = null;  // machine + folder last followed
    this.want = null;   // latest folder asked for
    this.busy = false;
    if (checking()) return;
    this.inbox = new Inbox(cx);
    // Which session this window is, for the taskbar and KWin rules: both
    // windows share the app id "herdr-app", so the title tells them apart.
    setWindowTitle(/-work$/.test(appHome()) ? "Herdr (work)" : "Herdr (default)");
    // Start the dock right away (in ~), even before a pane has focus.
    this.want = { dir: home(), machine: null };
    cx.spawn(async (cx) => this.follow(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "sync") { this.lastKey = null; this.check(cx); }
        else if (c === "resume") await this.resumeAgents(cx, true);
      }
    });
    // A `cd` in the shown pane redraws nothing: look once a second.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1000);
        this.check(cx);
      }
    });
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

  // The usage strip is started here; yazi and lazygit belong to the dock
  // (dock-tabs starts them when a dock opens), so a closed one stays closed.
  async ensure() {
    if (!term(USAGE)) await start(USAGE, ["hayami-tui", "--sections", "usage", "--arrangement", "row"], home());
  }

  async switchLazygit(root, cx) {
    const now = await lazygitDir();
    if (now === root) return;
    await setTarget(LAZYGIT, root);
    // Not running (the loop is showing "not a repository"): it reads the
    // target within 2 s. Keys sent now would be queued for the next lazygit.
    if (!now) return;
    if ((await recentRepos()).includes(root)) {
      // Back out of any popup, open Recent repositories, filter by name, pick it.
      await escThen(cx, LAZYGIT, ["ctrl+r"]);
      await cx.sleep(150);
      await hc(["send", LAZYGIT, base(root)]);
      for (let i = 0; i < 8; i++) {
        await cx.sleep(100);
        if ((await lazygitDir()) === root) return;
      }
      await hc(["keys", LAZYGIT, "esc"]);
    }
    // Not reachable in place: quit, and the loop starts it in the target repo.
    await escThen(cx, LAZYGIT, ["q"]);
  }

  // A remote machine's dock (set up by dock-tabs, which records the machine's
  // target files in shared "dock.machines"): write the new folder into the
  // target file there and quit the tool, so its loop restarts in it. yazi
  // moves on every folder change, lazygit only when the git repo changes.
  async followRemote(cx, machine, dir) {
    const info = (shared("dock.machines") ?? {})[machine];
    if (!info) return;  // the dock hasn't been opened on this machine yet
    const seen = (this.remote ??= {})[machine] ??= {};
    const live = (name) => terminals().some((t) => t.state === "live" && t.name === name && t.address.startsWith(machine + "/"));
    if (info.yazi && dir !== seen.dir && live(YAZI)) {
      const w = await writeRemote(machine, info.yazi, dir);
      if (w.code === 0) { await escThen(cx, `${machine}/${YAZI}`, ["q"]); seen.dir = dir; }
    }
    if (info.lazygit && live(LAZYGIT)) {
      const r = await hc(["exec", "--on", machine, "git", "-C", dir, "rev-parse", "--show-toplevel"]);
      const root = r.code === 0 ? r.stdout.trim() : null;
      // seen.root: the repo lazygit is open on (null/undefined: it is showing
      // "not a repository", e.g. right after start in the home folder). Only a
      // running lazygit gets the quit keys; otherwise they'd wait for the next one.
      if (root && root !== seen.root) {
        const w = await writeRemote(machine, info.lazygit, root);
        if (w.code === 0) {
          if (seen.root) await escThen(cx, `${machine}/${LAZYGIT}`, ["q"]);
          seen.root = root;
        }
      } else if (!root && seen.root) {
        const w = await writeRemote(machine, info.lazygit, dir);
        if (w.code === 0) { await escThen(cx, `${machine}/${LAZYGIT}`, ["q"]); seen.root = null; }
      }
    }
  }

  async follow(cx) {
    if (this.busy) return;
    this.busy = true;
    try {
      await loadNames();
    while (this.want) {
        const { dir, machine } = this.want;
        this.want = null;
        if (machine) { await this.followRemote(cx, machine, dir); continue; }
        const root = await repoRoot(dir);
        await this.ensure();
        await setTarget(YAZI, dir);
        if (term(YAZI)) await exec("ya", ["emit-to", YAZI_ID(), "cd", dir], { timeout: 5000 }).catch(() => null);
        if (root && term(LAZYGIT)) await this.switchLazygit(root, cx);
        else if (!root && term(LAZYGIT)) {
          // Left the repo: show the loop's "not a repository" screen there.
          await setTarget(LAZYGIT, dir);
          if (await lazygitDir()) await escThen(cx, LAZYGIT, ["q"]);
        }
      }
    } catch (e) {
      notify({ title: "Dock: follow failed", body: String(e), level: "error" });
    } finally { this.busy = false; }
  }

  // The dock follows what is shown: the focused pane of the shown tab (its
  // shown nested tab, if any) and that terminal's CURRENT folder, which
  // herdr-core tracks on every machine. A tab switch, a nested-tab switch, a
  // pane focus change and a `cd` all count. Focus inside the dock itself has
  // no pane and changes nothing.
  check(cx) {
    if (checking()) return;
    const f = focused();
    if (!f?.pane) return;
    // A space on another machine moves that machine's dock, not this one's.
    const machine = spaces().find((s) => s.active)?.machine ?? null;
    if (f.shown) {
      // A nested tab is shown: focused().cwd is its pane's own terminal, so ask
      // herdr-core for the shown terminal's current folder (an SSH round trip
      // on another machine: not more than every 3 s there).
      const now = Date.now();
      if (this.shownLookup || (machine && now - (this.shownAt ?? 0) < 3000)) return;
      this.shownLookup = true;
      this.shownAt = now;
      cx.spawn(async (cx) => {
        try {
          const r = await hc(["get", f.shown, "--json"]);
          const dir = r.code === 0 ? JSON.parse(r.stdout).foreground?.cwd : null;
          if (dir) this.consider(cx, machine, dir);
        } catch {} finally { this.shownLookup = false; }
      });
      return;
    }
    if (f.cwd) this.consider(cx, machine, f.cwd);
  }

  consider(cx, machine, dir) {
    const key = `${machine ?? ""}\n${dir}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.want = { dir, machine };
    cx.spawn(async (cx) => this.follow(cx));
  }

  render(cx) {
    this.check(cx);
    return div();
  }
}
