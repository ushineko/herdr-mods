// The other windows on this computer (njv-cachyos runs two: default and work, each
// its own herdr-core session): reading their agents for the inbox, and showing
// something in one of them. Shared by the inbox and the Ctrl+Tab switcher.
import { spaces, exec, shared } from "herdr";

// The other windows on this computer (another herdr-core session with its window
// open: njv-cachyos's default and work) and their agents, for the inbox: its own and
// those on the machines its core has added (so a window whose core has none still
// hears of them). One JSON line per window: { session, home, agents: [hc get, ...] },
// agents that aren't idle only. A session is asked only when its core's socket and its window's are there:
// asking hc about a session that isn't running would start a core for it. POSIX.
export const SIBLINGS = String.raw`
import glob, json, os, subprocess, sys
own, config = sys.argv[1], sys.argv[2]
hc = os.path.expanduser("~/.local/bin/hc")
if not os.path.exists(hc): hc = "hc"
for sock in sorted(glob.glob("/run/user/%d/herdr-core/*.sock" % os.getuid())):
    name = os.path.basename(sock)[:-5]
    if ".holder." in name or name == own: continue
    home = os.path.join(config, "herdr-app" if name == "default" else "herdr-app-" + name)
    if not os.path.exists(os.path.join(home, "herdr-app.sock")): continue
    env = dict(os.environ, HC_SESSION=name)
    run = lambda *a: subprocess.run([hc, *a, "--json"], env=env, capture_output=True, text=True, timeout=8).stdout
    try: terms = json.loads(run("ls")).get("terminals", [])
    except Exception: continue
    agents = []
    for t in terms:
        if t.get("status") not in ("blocked", "done", "working", "error"): continue
        try: agents.append(json.loads(run("get", t["address"])))
        except Exception: pass
    print(json.dumps({"session": name, "home": home, "agents": agents}))
`;

// The other windows on this computer and their agents (see SIBLINGS). Shared state
// belongs to this window's app home, so each window keeps its own list.
export const SIBLINGS_KEY = "spaces-bar.siblings";
// Agents on a machine this window has added itself are left out: its own inbox has them.
export const siblings = () => {
  const mine = new Set(spaces().map((s) => s.machine).filter(Boolean));
  const list = Array.isArray(shared(SIBLINGS_KEY)) ? shared(SIBLINGS_KEY) : [];
  return list.map((w) => ({ ...w, agents: w.agents.filter((a) => !a.machine || !mine.has(a.machine)) }));
};

// Runs the app commands in $2 (lines "<command> <json args>", lib/inbox.js showSteps)
// in the window of app home $1 (session $3), in order, and brings that window to the
// front. On KDE a KWin script activates it by its title ("Herdr (<session>)", which
// dock-follow sets): under Wayland KWin won't let another program raise it. Elsewhere,
// launching the session again (an open window's second launch only raises it).
const RAISE = String.raw`H=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app")
printf '%s\n' "$2" | while read -r cmd args; do HERDR_APP_HOME="$1" "$H" "do" "$cmd" "$args" >/dev/null 2>&1; done
case $3 in *[!a-z0-9-]*|'') exit 0 ;; esac
Q=$(command -v qdbus6 || command -v qdbus)
if [ -n "$Q" ] && case "$XDG_CURRENT_DESKTOP" in *KDE*) true ;; *) false ;; esac; then
  d=$TMPDIR; [ -n "$d" ] || d=/tmp
  f=$(mktemp "$d/herdr-raise.XXXXXX") && mv "$f" "$f.js" && f="$f.js"
  printf 'for (const w of workspace.windowList()) if (w.caption === "Herdr (%s)") { w.minimized = false; workspace.activeWindow = w; }\n' "$3" > "$f"
  "$Q" org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript herdr-raise >/dev/null 2>&1
  id=$("$Q" org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "$f" herdr-raise 2>/dev/null)
  [ -n "$id" ] && "$Q" org.kde.KWin "/Scripting/Script$id" org.kde.kwin.Script.run >/dev/null 2>&1
  sleep 0.5
  "$Q" org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript herdr-raise >/dev/null 2>&1
  rm -f -- "$f"
  exit 0
fi
L=$(command -v herdr-app-session || echo "$HOME/.local/bin/herdr-app-session")
if [ -x "$L" ]; then HERDR_APP_HOME="$1" HC_SESSION="$3" nohup "$L" "$3" >/dev/null 2>&1 &
else HERDR_APP_HOME="$1" HC_SESSION="$3" nohup "$H" >/dev/null 2>&1 &
fi`;

/** Runs `steps` ([[command, args], ...]) in another window (`w`: { home, session }) and raises it. */
export function showInWindow(w, steps) {
  const lines = steps.map(([c, args]) => `${c} ${JSON.stringify(args)}`).join("\n");
  return exec("sh", ["-c", RAISE, "sh", w.home, lines, w.session]).catch(() => {});
}
