// The agent inbox (spec 005 R2-R5): requests written by herdr-open / herdr-nav
// (bin/herdr-request) into ~/.cache/herdr-mods/inbox/<session>/ on any machine this
// window reaches. Each is claimed once (a rename), checked, and carried out in the
// space of the terminal that asked.
import { exec, hc, watchFolder, window, home, appHome, notify, panes, spaces, setShared, checking } from "herdr";
import { parseRequest, terminalAddress, splitClaimed } from "./lib/requests.js";
import { openInViewer } from "./lib/open.js";
import { openExternal } from "./lib/external-open.js";
import { editFile } from "./lib/edit-open.js";

const POLL = 2000;
const MACHINES_TTL = 60000;

// Claims every request in the session's inbox: renamed aside (so another window cannot
// take it too), printed, removed. Requests are separated by U+001E.
const CLAIM_SH = `d="$HOME/.cache/herdr-mods/inbox/$1"
[ -d "$d" ] || exit 0
for f in "$d"/*.json; do
  [ -f "$f" ] || continue
  c="$f.claimed.$$"
  mv "$f" "$c" 2>/dev/null || continue
  cat "$c"; printf '\\036'; rm -f "$c"
done`;
// The same for this computer on Windows (untested until the Herdr app runs there).
const CLAIM_PS = `$d = Join-Path $env:USERPROFILE ('.cache\\herdr-mods\\inbox\\' + $args[0])
if (-not (Test-Path -LiteralPath $d)) { exit 0 }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
foreach ($f in Get-ChildItem -LiteralPath $d -Filter *.json -File) {
  $c = $f.FullName + '.claimed.' + $PID
  try { [IO.File]::Move($f.FullName, $c) } catch { continue }
  [Console]::Out.Write([IO.File]::ReadAllText($c) + [char]0x1e)
  Remove-Item -LiteralPath $c -Force
}`;

export class Inbox {
  constructor(cx) {
    this.session = /-work$/.test(appHome()) ? "work" : "default";
    this.machines = { at: 0, list: [] };
    if (checking()) return;
    const local = `${home()}/.cache/herdr-mods/inbox/${this.session}`;
    const windows = window()?.platform === "windows";
    // This computer: on every change in the inbox, and once at start.
    cx.spawn(async (cx) => {
      if (!windows) await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1" "${1%/*}"', "inbox", local]).catch(() => null);
      await this.claim(null, this.session, cx);
      for (;;) {
        try { await watchFolder(local); } catch { await cx.sleep(POLL); }
        await this.claim(null, this.session, cx);
      }
    });
    // Other machines this window has added: polled while the window is visible.
    cx.timer.every(POLL, (cx) => { if (window()?.visible !== false) this.pollRemote(cx); });
  }

  async remoteMachines() {
    if (Date.now() - this.machines.at < MACHINES_TTL) return this.machines.list;
    const r = await hc(["machine", "ls", "--json"]).catch(() => null);
    let list = [];
    try { list = (JSON.parse(r?.stdout ?? "{}").machines ?? []).filter((m) => m.state === "connected").map((m) => ({ name: m.name, session: m.session ?? "default" })); } catch { /* keep none */ }
    this.machines = { at: Date.now(), list };
    return list;
  }

  pollRemote(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        for (const m of await this.remoteMachines()) await this.claim(m.name, m.session, cx);
      } finally { this.polling = false; }
    });
  }

  async claim(on, session, cx) {
    const windows = !on && window()?.platform === "windows";
    const r = await (windows
      ? exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${CLAIM_PS} } '${session.replace(/'/g, "''")}'`])
      : exec("sh", ["-c", CLAIM_SH, "claim", session], { on })).catch(() => null);
    if (!r || r.code !== 0) return;
    for (const text of splitClaimed(r.stdout)) this.handle(text, on, cx);
  }

  // The space of the terminal that asked, else the shown one.
  spaceOf(address) {
    const pane = address && panes().find((p) => p.terminal === address);
    return (pane && spaces().find((s) => s.tabs.some((t) => t.id === pane.tab))) ?? spaces().find((s) => s.active) ?? null;
  }

  handle(text, on, cx) {
    const parsed = parseRequest(text);
    if (!parsed.ok) {
      if (!parsed.stale) notify({ title: "herdr-mods: request refused", body: parsed.error, level: "warning" });
      return;
    }
    const q = parsed.req;
    const space = this.spaceOf(terminalAddress(on, q.terminal));
    const where = on ? ` · ${on}` : "";
    const name = (q.path ?? "").split(/[\\/]/).pop();
    switch (q.action) {
      case "open":
      case "diff":
        openInViewer(cx, {
          path: q.path, on, line: q.line, space: space?.id, focus: Boolean(space?.active),
          diff: q.action === "diff" ? { repo: q.repo, staged: q.staged } : null,
        });
        notify({ title: q.action === "diff" ? `Diff: ${name}` : `Opened ${name}`, body: `${q.path}${where}`, level: "info", timeout: 2500 });
        break;
      case "external":
        openExternal(q.path, on);
        break;
      case "edit":
        editFile({ path: q.path, on, line: q.line, space: space?.id, focus: Boolean(space?.active) });
        break;
      case "nav":
      case "reveal":
      case "follow":
        setShared("nav.request", { action: q.action, path: q.path, on, at: Date.now() });
        if (q.action === "follow") setShared("git.request", { action: "follow", at: Date.now() });
        notify({ title: q.action === "follow" ? "nav and git follow the terminal" : `nav → ${name || q.path}`, body: q.path ? `${q.path}${where}` : "", level: "info", timeout: 2500 });
        break;
      case "worktree":
        setShared("git.request", { action: "worktree", path: q.path, on, at: Date.now() });
        setShared("nav.request", { action: "nav", path: q.path, on, at: Date.now() });
        notify({ title: `git → worktree ${name}`, body: `${q.path}${where}`, level: "info", timeout: 2500 });
        break;
    }
  }
}
