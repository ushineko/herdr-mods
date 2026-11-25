#!/usr/bin/env bash
# Retake the README gallery (docs/gallery/*.png) in a demo Herdr window.
#
# The demo is its own app (HERDR_APP_HOME) on its own herdr-core session (HC_SESSION),
# so it shows none of your spaces, machines or usage strip, and your window is never
# touched. Its projects are made up, in /tmp/herdr-demo (no username in any path),
# with made-up git authors; its shells are plain bash with a "$ " prompt. Each image is
# OCR-checked for your user name, host name and home path before it is kept. Everything
# the demo made is removed on exit, including its Claude transcript.
#
# Needs: herdr-app and hc, git, node, magick (ImageMagick); claude for the chat shot
# (skipped without it); tesseract for the check (the run fails without it unless
# --no-check). macOS and Linux; the window is maximized, so shots follow the screen.
# Windows: untested (no Herdr app there).
#
# Usage: tools/gallery.sh [--no-check] [--keep]
#   --no-check  skip the OCR check (then look at every image yourself)
#   --keep      leave the demo running afterwards (stop it with its printed commands)
set -euo pipefail

prog=${0##*/}
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/docs/gallery"
check=true
keep=false
die() { printf '%s: %s\n' "$prog" "$*" >&2; exit 1; }
say() { printf '%s: %s\n' "$prog" "$*"; }

while (($#)); do
  case $1 in
    --no-check) check=false; shift ;;
    --keep) keep=true; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed -n 's/^# \{0,1\}//p'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

for t in herdr-app hc git node magick; do command -v "$t" >/dev/null || die "needs $t"; done
if $check; then command -v tesseract >/dev/null || die "needs tesseract for the check (or --no-check)"; fi
have_claude=false; command -v claude >/dev/null && have_claude=true

demo=/tmp/herdr-demo
real_home_app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
[[ -e $demo ]] && die "$demo exists; remove it first (a demo still running?)"

# Nothing of the calling session may reach the demo: a Claude Code session's markers
# turn off transcripts (the chat then shows nothing), and HC_TERMINAL_* would make hc
# act as if inside the caller's terminal.
while IFS= read -r v; do unset "$v"; done < <(env | cut -d= -f1 | grep -E '^(CLAUDE|HC_)' || true)
export HERDR_APP_HOME="$demo/.herdr-home" HC_SESSION=herdr-demo HERDR_TELEMETRY=0
# The demo core's saved spaces (a core restores them when it starts again), and
# Claude's caches for the demo folder.
core_state="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core/$HC_SESSION"
hc server stop >/dev/null 2>&1 || true
rm -rf -- "${core_state:?}"

app_pid=""
stop_app() { [[ -n $app_pid ]] || return 0; { kill "$app_pid"; wait "$app_pid"; } 2>/dev/null || true; app_pid=""; }
cleanup() {
  if $keep; then
    say "left running: HERDR_APP_HOME=$HERDR_APP_HOME HC_SESSION=$HC_SESSION; stop with: kill $app_pid; HC_SESSION=$HC_SESSION hc server stop; rm -rf $demo"
    return
  fi
  stop_app
  sleep 1
  hc server stop >/dev/null 2>&1 || true
  rm -rf -- "${demo:?}" "${core_state:?}"
  # The demo chat's transcript and caches (Claude names them after the project's path).
  rm -rf -- "$HOME"/.claude/projects/*herdr-demo* "$HOME/Library/Caches/claude-cli-nodejs/"*herdr-demo* \
    "${XDG_CACHE_HOME:-$HOME/.cache}/claude-cli-nodejs/"*herdr-demo* 2>/dev/null || true
}
trap cleanup EXIT

# A plain bash with a neutral prompt (the user's prompt may show user and host).
bash_cmd="exec env BASH_SILENCE_DEPRECATION_WARNING=1 PS1='\$ ' /bin/bash --norc --noprofile"
shell_argv='["env","BASH_SILENCE_DEPRECATION_WARNING=1","PS1=$ ","/bin/bash","--norc","--noprofile"]'
do_() { herdr-app "do" "$@" >/dev/null; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
pane_of() { herdr-app ls | json "next(t['pane'] for s in d['spaces'] for tb in s['tabs'] for t in tb['terminals'] if t['terminal']=='$1')"; }
tab_named() { herdr-app ls | json "next(t['id'] for s in d['spaces'] for t in s['tabs'] if t['name']=='$1')"; }
shot() { sleep "${2:-3}"; herdr-app shot "$work/$1.png" >/dev/null; }

# ---- made-up projects ------------------------------------------------------------
say "making the demo projects in $demo"
mkdir -p "$demo"
work="$demo/.shots"; mkdir -p "$work"
commit() { # author email date message
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_AUTHOR_DATE="$3" \
  GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" GIT_COMMITTER_DATE="$3" \
    git -c commit.gpgsign=false commit -q -m "$4"
}
( cd "$demo" && git init -q -b main acme-api && cd acme-api
  git config user.name "Ada Lovelace"; git config user.email ada@example.com
  mkdir -p src/routes src/db tests docs
  cat > README.md <<'EOF'
# acme-api

A small HTTP API for the **Acme** order system.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` | `/orders` | List orders, newest first |
| `POST` | `/orders` | Create an order |
| `GET` | `/orders/:id` | One order, with its items |

## Run

```sh
npm install
npm run dev      # http://localhost:3000
npm test
```

## Layout

- `src/routes/` request handlers
- `src/db/` the order store
- `tests/` unit tests
EOF
  printf '{ "name": "acme-api", "version": "0.3.0", "type": "module",\n  "scripts": { "dev": "node src/server.js", "test": "node --test tests/*.test.js" } }\n' > package.json
  printf 'import { createServer } from "node:http";\nimport { orders } from "./routes/orders.js";\n\ncreateServer((req, res) => orders(req, res)).listen(3000);\n' > src/server.js
  cat > src/routes/orders.js <<'EOF'
import { list, get } from "../db/store.js";

export function orders(req, res) {
  res.setHeader("content-type", "application/json");
  if (req.url === "/orders") return res.end(JSON.stringify(list()));
  const id = req.url.split("/")[2];
  res.end(JSON.stringify(get(id) ?? { error: "not found" }));
}
EOF
  cat > src/db/store.js <<'EOF'
const rows = [
  { id: "1001", customer: "Wile E.", items: 2, total: 49.5 },
  { id: "1002", customer: "Road R.", items: 1, total: 12.0 },
];
export const list = () => [...rows].reverse();
export const get = (id) => rows.find((r) => r.id === id);
EOF
  cat > tests/store.test.js <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { list, get } from "../src/db/store.js";
test("newest first", () => assert.equal(list()[0].id, "1002"));
test("one order", () => assert.equal(get("1001").customer, "Wile E."));
EOF
  echo "# Notes on the order store" > docs/store.md
  commit "Ada Lovelace" ada@example.com "2026-11-18T10:12:00" "Initial API: orders list and lookup"
  echo 'export const count = () => rows.length;' >> src/db/store.js
  commit "Grace Hopper" grace@example.com "2026-11-21T09:05:00" "store: count()"
  echo 'test("count", () => assert.equal(2, 2));' >> tests/store.test.js
  commit "Grace Hopper" grace@example.com "2026-11-22T17:30:00" "tests: count"
  sed -e 's/0.3.0/0.4.0/' package.json > package.json.new && mv package.json.new package.json
  commit "Ada Lovelace" ada@example.com "2026-11-24T11:20:00" "Release 0.4.0"
  printf '\nexport function create(req, res) {\n  // TODO: validate the body\n  res.statusCode = 201;\n  res.end("{}");\n}\n' >> src/routes/orders.js
  echo "- [ ] POST /orders validation" > TODO.md && git add TODO.md
  git worktree add -q -b feature/pagination ../acme-api.worktrees/pagination )
( cd "$demo" && git init -q -b main orbit-ui && cd orbit-ui
  mkdir -p src/components && printf '# orbit-ui\n\nA dashboard for satellite telemetry.\n' > README.md
  # shellcheck disable=SC2016 # JavaScript, written as is
  echo 'export const Gauge = ({ value }) => `<meter value="${value}"></meter>`;' > src/components/Gauge.js
  commit "Grace Hopper" grace@example.com "2026-11-20T08:00:00" "Scaffold the dashboard" )
mkdir -p "$demo/notes" && printf '# Ideas\n\n- a calmer status page\n' > "$demo/notes/ideas.md"

# ---- the demo app home -----------------------------------------------------------
say "making the demo app home"
mkdir -p "$HERDR_APP_HOME/layouts" "$HERDR_APP_HOME/data/git"
for f in settings.json keys.json seen.json update-notes.json; do [[ -f $real_home_app/$f ]] && cp "$real_home_app/$f" "$HERDR_APP_HOME/"; done
[[ -d $real_home_app/themes ]] && cp -R "$real_home_app/themes" "$HERDR_APP_HOME/"
[[ -f $real_home_app/layouts/terminals-dock.json ]] || die "no terminals-dock layout in $real_home_app"
# Your layout without the usage strip and dock-follow (it starts a usage terminal
# showing plan usage and spending), with the right dock shown.
python3 - "$real_home_app/layouts/terminals-dock.json" "$HERDR_APP_HOME/layouts/terminals-dock.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
def walk(n):
    if isinstance(n, dict) and "children" in n:
        n["children"] = [c for c in n["children"] if c.get("id") not in ("usage-dock", "dock-follow")]
        for c in n["children"]: walk(c)
    if isinstance(n, dict) and n.get("id") == "dock-right": n["hidden"] = False
    if isinstance(n, dict) and n.get("id") == "dock-bottom": n["hidden"] = True
walk(d)
json.dump(d, open(sys.argv[2], "w"), indent=2)
EOF
printf '{ "frame.welcomed": "skipped" }\n' > "$HERDR_APP_HOME/shared.json"   # no welcome screen
"$repo/install.sh" --home "$HERDR_APP_HOME" --no-agent >/dev/null
rm -rf "$HERDR_APP_HOME/mods/dock-follow"

start_app() {
  herdr-app >>"$work/app.log" 2>&1 &
  app_pid=$!
  for _ in $(seq 1 40); do herdr-app status >/dev/null 2>&1 && break; sleep 0.5; done
  herdr-app status >/dev/null 2>&1 || die "the demo app did not start (see $work/app.log)"
  sleep 2
  do_ layout.switch '{"name":"terminals-dock"}'
  do_ window.maximize '{}'
  sleep 2
}
say "starting the demo app"
start_app

# ---- scenes ----------------------------------------------------------------------
say "setting up the scenes"
for p in orbit-ui notes acme-api; do
  do_ space.new "{\"name\":\"$p\",\"folder\":\"$demo/$p\",\"argv\":$shell_argv}"
done
sleep 2
read -r api_tab base < <(herdr-app ls | json "' '.join([(s['tabs'][0]['id'], s['tabs'][0]['terminals'][0]['terminal']) for s in d['spaces'] if s['name']=='acme-api'][0])")
do_ tab.rename "{\"id\":\"$api_tab\",\"name\":\"acme-api\"}"
hc send "$base" "clear; node --test tests/*.test.js 2>&1 | tail -8; git status --short" >/dev/null
do_ pane.focus "{\"pane\":\"$(pane_of "$base")\"}"
sleep 1
existing=$(hc ls --json | json "' '.join(t['address'] for t in d['terminals'])")
do_ nested-tabs.add '{}'; sleep 2; do_ nested-tabs.add '{}'; sleep 2
read -r server tests < <(hc ls --json | json "' '.join(t['address'] for t in d['terminals'] if t['address'] not in '$existing'.split())")
for t in "$server" "$tests"; do hc send "$t" "$bash_cmd" >/dev/null; done
sleep 2
hc send "$server" "clear; npm run dev" >/dev/null
hc send "$tests" "clear; node --test tests/*.test.js 2>&1 | head -14" >/dev/null
hc label "$server" nt.title=server >/dev/null
hc label "$tests" nt.title=tests >/dev/null
do_ nested-tabs.prev '{}'; sleep 1; do_ nested-tabs.prev '{}'
space=$(herdr-app ls | json "next(s['id'] for s in d['spaces'] if s['name']=='acme-api')")
do_ tab.new "{\"space\":\"$space\",\"name\":\"README.md\",\"mod\":\"cria-file-preview\",\"props\":{\"file\":\"$demo/acme-api/README.md\"},\"focus\":false}"

if $have_claude; then
  say "starting a chat (a question about the demo code; nothing is edited)"
  do_ pane.focus "{\"pane\":\"$(pane_of "$base")\"}"
  before=$(hc ls --json | json "' '.join(t['address'] for t in d['terminals'])")
  do_ nested-tabs.chat '{}'
  agent=""
  for _ in $(seq 1 30); do
    agent=$(hc ls --json | json "next((t['address'] for t in d['terminals'] if t['address'] not in '$before'.split()), '')")
    # Claude is ready when it shows its trust question or its first input hint.
    [[ -n $agent ]] && hc read "$agent" 2>/dev/null | grep -q -E 'trust this folder|Try "' && break
    sleep 1
  done
  [[ -n $agent ]] || die "the chat's agent did not start"
  # A new folder asks whether to trust it: yes (the second choice).
  if hc read "$agent" | grep -q 'trust this folder'; then
    hc keys "$agent" down enter >/dev/null
    for _ in $(seq 1 20); do hc read "$agent" | grep -q 'Try "' && break; sleep 1; done
  fi
  hc send "$agent" "Read src/routes/orders.js and src/db/store.js, then suggest one small improvement to the orders route in two or three sentences, with a short code snippet. Don't edit any files." >/dev/null
  for _ in $(seq 1 36); do
    sleep 5
    s=$(hc get "$agent" --json | json "(d.get('status') or {}).get('state')")
    [[ $s == "idle" || $s == "done" ]] && break
  done
  sleep 6   # Claude's suggested next message, and the chat reading it
fi

# ---- shots -----------------------------------------------------------------------
say "taking the screenshots"
do_ tab.select "{\"id\":\"$api_tab\"}"; shot overview
if $have_claude; then do_ tab.select "{\"id\":\"$(tab_named 'Claude Code chat')\"}"; shot chat; fi
do_ tab.select "{\"id\":\"$(tab_named README.md)\"}"; shot viewer
# Recent expanded: the git panel's own setting, read when it starts.
stop_app; sleep 1
printf '{ "git.recentFull": "1" }\n' > "$HERDR_APP_HOME/data/git/store.json"
start_app
do_ tab.select "{\"id\":\"$api_tab\"}"; shot git-recent-full 4

# The window at half size; the dock (the right 32 % of the window) cut out of two.
staged="$work/out"; mkdir -p "$staged"
for n in overview chat viewer; do [[ -f $work/$n.png ]] && magick "$work/$n.png" -resize 50% -strip "$staged/$n.png"; done
crop() { # in out x% y% w% h% (of the window), then 60 %
  local W H
  read -r W H < <(magick identify -format '%w %h\n' "$1")
  magick "$1" -crop "$((W * $5 / 1000))x$((H * $6 / 1000))+$((W * $3 / 1000))+$((H * $4 / 1000))" +repage -resize 60% -strip "$2"
}
crop "$work/overview.png" "$staged/dock.png" 679 79 321 920
crop "$work/git-recent-full.png" "$staged/git-recent.png" 679 545 321 454

# ---- check -----------------------------------------------------------------------
if $check; then
  say "checking every image for your user, host and home folder (OCR)"
  user=$(id -un); host=$(hostname -s); bad=0
  pat="$user|$host|$HOME|/Users/|/home/"
  for f in "$staged"/*.png; do
    hits=$(tesseract "$f" - 2>/dev/null | grep -i -E "$pat" || true)
    if [[ -n $hits ]]; then bad=1; printf '%s: %s\n' "$(basename "$f")" "$hits" >&2; fi
  done
  ((bad)) && die "personal details found above; the gallery was not changed (images in $staged with --keep)"
fi

mkdir -p "$out"
cp "$staged"/*.png "$out/"
say "wrote $(find "$staged" -name '*.png' | wc -l | tr -d ' ') images to docs/gallery/; review them with git diff --stat docs/gallery"
