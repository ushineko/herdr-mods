#!/usr/bin/env bash
# Run every unit test with a private TMPDIR that is removed afterwards, so tests
# that make temp folders (the vendored cria tests do) leave nothing behind.
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf -- "${tmp:?}"' EXIT
cd "$repo"
TMPDIR="$tmp" node --test tests/*.test.js vendor/cria/tests/*.test.mjs "$@"
