#!/usr/bin/env bash
# Copy this repo's mods into a Herdr app home as real folders.
#
# Herdr does not hot-reload a mod reached through a symlink, so the app home
# gets copies; run this again after every edit (it only rewrites what changed).
# Only the mods in ./mods are touched; Herdr's shipped mods are left alone.
#
# Usage: install.sh [--home DIR]... [--link DIR]... [MOD...]
#   --home DIR  app home to copy into (repeatable; default ~/.config/herdr-app)
#   --link DIR  app home that gets symlinks to the first --home's copies
#               (njv-cachyos' work home shares the default home's mods)
#   MOD         only these mods (default: all of ./mods)
set -euo pipefail

prog=${0##*/}
repo="$(cd "$(dirname "$0")" && pwd)"
homes=()
links=()
mods=()

die() { printf '%s: %s\n' "$prog" "$*" >&2; exit 1; }

while (($#)); do
  case $1 in
    --home) [[ $# -ge 2 ]] || die "--home needs a folder"; homes+=("$2"); shift 2 ;;
    --link) [[ $# -ge 2 ]] || die "--link needs a folder"; links+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

for home in "${homes[@]}"; do
  [[ -d "$home" ]] || die "no Herdr app home at $home"
  mkdir -p "${home:?}/mods"
  for m in "${mods[@]}"; do
    dst="${home:?}/mods/${m:?}"
    # A symlinked copy never hot-reloads: replace it with a real folder.
    [[ -L "$dst" ]] && rm -- "$dst"
    changed=$(rsync -a --delete --itemize-changes \
      --exclude '*.d.ts' --exclude 'jsconfig.json' \
      "$repo/mods/$m/" "$dst/" | grep -c '^[<>c*]' || true)
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

exit 0
