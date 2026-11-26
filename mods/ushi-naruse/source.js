// Finds the session log an agent terminal is writing, and reads it as it grows.
// macOS and Linux with sh; Windows with PowerShell (herdr-mods, spec 014), its
// scripts beside the sh ones and each value passed as character codes.
import { exec, window } from "herdr";
import { Buffer } from "buffer";
import { platformOf } from "./lib/chat-entries.js";
import { powershell } from "./lib/powershell.js";

// Start this far from the end of a long log; earlier history is skipped.
const TAIL_BYTES = 4 * 1024 * 1024;

const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on });
const ps = (script, args, on) => { const [p, a] = powershell(script, ...args); return exec(p, a, { on, timeout: 30000 }); };

/** The system machine `on` runs (null: this computer); asked once per machine. */
export const systemOf = (on) => platformOf(on, exec, (() => { try { return window().platform; } catch { return null; } })());
/** Runs `sh` on POSIX or the PowerShell form on Windows, with the same values. */
export async function onAgent(on, shScript, psScript, args) {
  return (await systemOf(on)) === "windows" ? ps(psScript, args, on) : sh(shScript, args, on);
}

// Windows' scripts read their values as $args and never use a double quote (Windows
// PowerShell 5 mangles them on its command line): a quote is [char]34. jsonField
// is the first "key":"value" of a JSON text, as the sh scripts' sed and grep take it.
const PS_JSON_FIELD = String.raw`function jsonField($t, $k) { $q = [string][char]34; $m = [regex]::Match($t, $q + $k + $q + ':' + $q + '([^' + $q + ']*)' + $q); if ($m.Success) { $m.Groups[1].Value } else { '' } }`;

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);

export function agentKind(term) {
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") ? "claude" : what.includes("codex") ? "codex" : null;
}

// Claude Code writes ~/.claude/sessions/<pid>.json with the live session id.
// ushi-naruse: a session parked as a background job ("parkedJobId") is written by
// that job; its own file ("jobId") holds the live session id, first in the file.
const CLAUDE = `
for p in "$1" $(pgrep -P "$1"); do
  f="$HOME/.claude/sessions/$p.json"
  [ -f "$f" ] || continue
  job=$(sed -n 's/.*"parkedJobId":"\\([^"]*\\)".*/\\1/p' "$f")
  if [ -n "$job" ]; then
    g=$(grep -l "\\"jobId\\":\\"$job\\"" "$HOME"/.claude/sessions/*.json 2>/dev/null | head -1)
    [ -n "$g" ] && f=$g
  fi
  # The first sessionId: a later one (formerNames) is an earlier session.
  id=$(grep -o '"sessionId":"[^"]*"' "$f" | head -1 | cut -d'"' -f4)
  [ -n "$id" ] || continue
  log=$(ls "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
  [ -n "$log" ] && echo "$log" && exit 0
done`;

const CLAUDE_WINDOWS = String.raw`
${PS_JSON_FIELD}
$root = [int]$args[0]
$dir = Join-Path $env:USERPROFILE '.claude\sessions'
$pids = @($root) + @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $root) | ForEach-Object { [int]$_.ProcessId })
foreach ($p in $pids) {
  $f = Join-Path $dir ([string]$p + '.json')
  if (-not [IO.File]::Exists($f)) { continue }
  $t = [IO.File]::ReadAllText($f)
  $job = jsonField $t 'parkedJobId'
  if ($job) {
    foreach ($g in Get-ChildItem -LiteralPath $dir -Filter *.json) {
      $u = [IO.File]::ReadAllText($g.FullName)
      if ((jsonField $u 'jobId') -eq $job) { $t = $u; break }
    }
  }
  $id = jsonField $t 'sessionId'
  if (-not $id) { continue }
  foreach ($d in Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.claude\projects') -Directory) {
    $log = Join-Path $d.FullName ($id + '.jsonl')
    if ([IO.File]::Exists($log)) { $log; return }
  }
}`;

// Codex keeps its rollout file open; fall back to the newest one for this folder.
const CODEX = `
kids=$(pgrep -P "$1" | tr '\\n' ' ')
grand=$(for k in $kids; do pgrep -P "$k"; done | tr '\\n' ' ')
for p in "$1" $kids $grand; do
  { lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p'; ls -l "/proc/$p/fd" 2>/dev/null | sed 's/.* -> //'; } | grep '/sessions/.*rollout-.*\\.jsonl$'
done | head -1 | grep . && exit 0
find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -mtime -2 2>/dev/null | xargs ls -t 2>/dev/null | while read -r f; do
  head -c 20000 "$f" | grep -q "\\"cwd\\":\\"$2\\"" && { echo "$f"; break; }
done`;

// Codex on Windows: the newest rollout for this folder (no lsof or /proc to see the
// open one).
const CODEX_WINDOWS = String.raw`
$cwd = $args[1]
$q = [string][char]34
$want = $q + 'cwd' + $q + ':' + $q + $cwd.Replace('\', '\\') + $q
$since = (Get-Date).AddDays(-2)
$files = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.codex\sessions') -Recurse -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $since } | Sort-Object LastWriteTime -Descending
foreach ($f in $files) {
  $s = [IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
  try { $b = New-Object byte[] 20000; $n = $s.Read($b, 0, $b.Length) } finally { $s.Close() }
  if ([Text.Encoding]::UTF8.GetString($b, 0, $n).Contains($want)) { $f.FullName; return }
}`;

const SUBAGENT_WINDOWS = String.raw`
$q = [string][char]34
$want = $q + 'toolUseId' + $q + ':' + $q + $args[1] + $q
Get-ChildItem -LiteralPath $args[0] -Filter *.meta.json -ErrorAction SilentlyContinue | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains($want) } | Select-Object -First 1 | ForEach-Object { $_.FullName }`;

// ushi-naruse (spec 009): the log of the subagent a tool call started, found by the
// meta file Claude Code writes beside it ({ "toolUseId": … }).
export async function subagentLog(dir, toolUseId, on) {
  const r = await onAgent(on, 'grep -lF "\\"toolUseId\\":\\"$2\\"" "$1"/*.meta.json 2>/dev/null | head -1', SUBAGENT_WINDOWS, [dir, toolUseId]);
  const meta = r.stdout.trim();
  return meta ? meta.replace(/\.meta\.json$/, ".jsonl") : null;
}

export async function locate(term, kind) {
  const pid = term?.foreground?.pid;
  if (!pid) return null;
  const on = machineOf(term.address);
  const r = await onAgent(on, kind === "codex" ? CODEX : CLAUDE, kind === "codex" ? CODEX_WINDOWS : CLAUDE_WINDOWS, [String(pid), term.foreground.cwd ?? ""]);
  return r.stdout.trim().split("\n")[0] || null;
}

// Windows: the log's size, and its bytes from an offset, written to stdout as they
// are (not re-encoded), so the offset counts the same bytes as on POSIX. The log is
// opened shared: Claude Code is writing it.
const SIZE_WINDOWS = String.raw`[IO.FileInfo]::new($args[0]).Length`;
const FROM_WINDOWS = String.raw`
$s = [IO.File]::Open($args[0], 'Open', 'Read', 'ReadWrite')
try {
  [void]$s.Seek([long]$args[1], 'Begin')
  $out = [Console]::OpenStandardOutput()
  $s.CopyTo($out)
  $out.Flush()
} finally { $s.Close() }`;

// Reads complete new lines from `file` since the last call.
export class Tail {
  constructor(file, on) {
    this.file = file;
    this.on = on;
    this.offset = null;
  }

  async read() {
    let skipFirst = false;
    if (this.offset === null) {
      const r = await onAgent(this.on, 'wc -c < "$1"', SIZE_WINDOWS, [this.file]);
      const size = parseInt(r.stdout.trim(), 10) || 0;
      this.offset = Math.max(0, size - TAIL_BYTES);
      skipFirst = this.offset > 0;
      this.truncated = skipFirst;
    }
    const r = (await systemOf(this.on)) === "windows"
      ? await ps(FROM_WINDOWS, [this.file, String(this.offset)], this.on)
      : await exec("tail", ["-c", `+${this.offset + 1}`, this.file], { on: this.on });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "can't read the session log");
    const s = r.stdout;
    const cut = s.lastIndexOf("\n");
    if (cut < 0) return [];
    const chunk = s.slice(0, cut + 1);
    this.offset += Buffer.from(chunk, "utf8").length;
    const lines = chunk.split("\n").filter(Boolean);
    if (skipFirst) lines.shift();
    return lines;
  }
}
