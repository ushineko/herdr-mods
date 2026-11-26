#!/usr/bin/env bash
# Copy this repo's mods into a Herdr app home as real folders.
#
# Herdr does not hot-reload a mod reached through a symlink, so the app home
# gets copies; run this again after every edit. Files are compared by content,
# so only mods whose files changed are rewritten (and reloaded).
# Only the mods in ./mods are touched; Herdr's shipped mods are left alone.
# A mod's mod.json may list shared files from ./lib ("lib": ["x.js"]); they
# are copied into the installed mod as lib/x.js.
#
# The agent commands (./bin) and Claude Code skills (./skills) are symlinked, not
# copied (they need no hot reload): into ~/.local/bin and ~/.claude/skills.
#
# Needs bash, coreutils and node only (no rsync or python3), so it runs the same
# on macOS, Linux and Windows (Git Bash; there with --no-agent, spec 013).
#
# Usage: install.sh [--home DIR]... [--link DIR]... [--bin DIR] [--skills DIR] [--no-agent] [MOD...]
#   --home DIR    app home to copy into (repeatable; default ~/.config/herdr-app)
#   --link DIR    app home that gets symlinks to the first --home's copies
#                 (njv-cachyos' work home shares the default home's mods)
#   --bin DIR     where bin/* is linked (default ~/.local/bin)
#   --skills DIR  where skills/* is linked (default ~/.claude/skills)
#   --no-agent    skip bin and skills
#   MOD           only these mods (default: all of ./mods)
set -euo pipefail

prog=${0##*/}
repo="$(cd "$(dirname "$0")" && pwd)"
homes=()
links=()
mods=()
bin_dir="$HOME/.local/bin"
skills_dir="$HOME/.claude/skills"
agent=true

die() { printf '%s: %s\n' "$prog" "$*" >&2; exit 1; }

while (($#)); do
  case $1 in
    --home) [[ $# -ge 2 ]] || die "--home needs a folder"; homes+=("$2"); shift 2 ;;
    --link) [[ $# -ge 2 ]] || die "--link needs a folder"; links+=("$2"); shift 2 ;;
    --bin) [[ $# -ge 2 ]] || die "--bin needs a folder"; bin_dir=$2; shift 2 ;;
    --skills) [[ $# -ge 2 ]] || die "--skills needs a folder"; skills_dir=$2; shift 2 ;;
    --no-agent) agent=false; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed -n 's/^# \{0,1\}//p'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) mods+=("$1"); shift ;;
  esac
done

((${#homes[@]})) || homes=("$HOME/.config/herdr-app")
if ((${#mods[@]} == 0)); then
  for d in "$repo"/mods/*/; do mods+=("$(basename "$d")"); done
fi

for m in "${mods[@]}"; do
  [[ -f "$repo/mods/$m/mod.json" ]] || die "not a mod in this repo: $m"
done

# The lib/ files a mod lists in mod.json ("lib": ["a.js", ...]), one per line.
mod_libs() {
  node -e 'for (const f of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).lib ?? []) console.log(f)' "$1"
}

# Files the app writes into a mod folder itself (type definitions), never copied
# nor removed.
kept() { [[ $1 == *.d.ts || $(basename -- "$1") == jsconfig.json ]]; }

# Makes folder $2 hold exactly what folder $1 holds, comparing by content: a file
# is copied only when it differs, and a file $1 doesn't have is removed (kept()
# files aside). Prints how many files it changed.
sync_dir() {
  local src=$1 dst=$2 n=0 f
  mkdir -p -- "$dst"
  while IFS= read -r -d '' f; do
    f=${f#./}
    kept "$f" && continue
    if ! cmp -s -- "$src/$f" "$dst/$f"; then
      mkdir -p -- "$(dirname -- "$dst/$f")"
      cp -p -- "$src/$f" "$dst/$f"
      n=$((n + 1))
    fi
  done < <(cd "$src" && find . -type f -print0)
  while IFS= read -r -d '' f; do
    f=${f#./}
    kept "$f" && continue
    if [[ ! -f "$src/$f" ]]; then rm -f -- "$dst/$f"; n=$((n + 1)); fi
  done < <(cd "$dst" && find . -type f -print0)
  find "$dst" -mindepth 1 -type d -empty -delete
  printf '%s\n' "$n"
}

# Each mod is assembled in a staging folder (its own files plus its lib/
# files) and synced from there, so an unchanged mod is not rewritten.
stage=$(mktemp -d)
trap 'rm -rf -- "${stage:?}"' EXIT
for m in "${mods[@]}"; do
  mkdir -p "$stage/$m"
  cp -R "$repo/mods/$m/." "$stage/$m/"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    [[ "$f" != */* && -f "$repo/lib/$f" ]] || die "$m: lib file not found: lib/$f"
    mkdir -p "$stage/$m/lib"
    install -m 644 "$repo/lib/$f" "$stage/$m/lib/$f"
  done < <(mod_libs "$repo/mods/$m/mod.json")
done

for home in "${homes[@]}"; do
  [[ -d "$home" ]] || die "no Herdr app home at $home"
  mkdir -p "${home:?}/mods"
  for m in "${mods[@]}"; do
    dst="${home:?}/mods/${m:?}"
    # A symlinked copy never hot-reloads: replace it with a real folder.
    [[ -L "$dst" ]] && rm -- "$dst"
    changed=$(sync_dir "$stage/$m" "$dst")
    ((changed)) && printf 'installed %s (%s changed) -> %s\n' "$m" "$changed" "$home"
  done
done

for home in ${links[@]+"${links[@]}"}; do
  [[ -d "$home" ]] || die "no Herdr app home at $home"
  mkdir -p "${home:?}/mods"
  for m in "${mods[@]}"; do
    ln -sfn "${homes[0]:?}/mods/${m:?}" "${home:?}/mods/${m:?}"
  done
done

# Links $1/<name> -> each source. Something else already at a name is left alone.
link_into() {
  local dir=$1 src dst
  shift
  mkdir -p -- "${dir:?}"
  for src in "$@"; do
    dst="$dir/$(basename -- "$src")"
    if [[ -e $dst && ! -L $dst ]]; then
      printf '%s: not replacing %s (not a symlink)\n' "$prog" "$dst" >&2
      continue
    fi
    if [[ $(readlink -- "$dst" 2>/dev/null) != "$src" ]]; then
      ln -sfn -- "$src" "$dst"
      printf 'linked %s -> %s\n' "$dst" "$src"
    fi
  done
}

if $agent; then
  link_into "$bin_dir" "$repo"/bin/*
  link_into "$skills_dir" "$repo"/skills/*
fi
