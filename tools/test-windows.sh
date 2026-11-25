#!/usr/bin/env bash
# Run the unit tests on win11-kvm (Windows 11, node, git, PowerShell 5.1).
# Run it on njv-cachyos (win11-kvm is a VM there; ssh host "win11-kvm"); from the Mac:
#   hc exec --on njv-cachyos-default -- bash -c "$(cat tools/test-windows.sh)"
# It sends HEAD (committed and pushed work only), runs the tests in a temp folder with a
# private TEMP, and removes the folder and the archive afterwards.
set -euo pipefail
cd ~/git/herdr-mods && git pull -q --ff-only
t=$(mktemp -d); trap 'rm -rf -- "${t:?}"' EXIT
git archive -o "$t/hm.tar" HEAD
name="herdr-mods-test-$$"
scp -q -o BatchMode=yes "$t/hm.tar" "win11-kvm:AppData/Local/Temp/$name.tar"
ps=$(cat <<PS
\$ErrorActionPreference = 'Stop'
\$ProgressPreference = 'SilentlyContinue'
\$base = Join-Path \$env:TEMP '$name'
\$tar = \$base + '.tar'
try {
  New-Item -ItemType Directory -Path \$base | Out-Null
  New-Item -ItemType Directory -Path (Join-Path \$base 'tmp') | Out-Null
  tar -x -f \$tar -C \$base
  Set-Location \$base
  \$env:TEMP = Join-Path \$base 'tmp'; \$env:TMP = \$env:TEMP
  \$files = @(Get-ChildItem tests\*.test.js) + @(Get-ChildItem vendor\cria\tests\*.test.mjs) | ForEach-Object { \$_.FullName }
  \$out = & node --test --test-reporter=tap @files 2>&1 | ForEach-Object { "\$_" }
  \$out | Where-Object { \$_ -match '^(# (tests|pass|fail|skipped) |not ok)' }
  \$i = 0; foreach (\$l in \$out) { if (\$l -match '^not ok') { \$out[\$i..([Math]::Min(\$i+14, \$out.Count-1))] }; \$i++ }
} finally {
  Set-Location \$env:USERPROFILE
  Remove-Item -LiteralPath \$base -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath \$tar -Force -ErrorAction SilentlyContinue
  "cleanup: " + (-not (Test-Path \$base)) + " " + (-not (Test-Path \$tar))
}
PS
)
enc=$(printf '%s' "$ps" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)
ssh -o BatchMode=yes win11-kvm "powershell -NoProfile -NonInteractive -EncodedCommand $enc" 2>&1 | grep -v -E '^#< CLIXML|^<Objs'
