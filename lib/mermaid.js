// Mermaid diagrams in the Markdown viewer (spec 012): the theme to draw in, and what
// to tell the person when a diagram can't be drawn. Pure: no herdr imports.

/** Printed by the render scripts when no mmdc is found. */
export const NO_MMDC = "__no_mmdc__";

/** Whether a #rgb or #rrggbb colour is dark (relative luminance under a half). */
export function isDark(color) {
  let hex = String(color ?? "").replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}/i.test(hex)) return true; // unknown: the app's default is dark
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** Mermaid's theme for the app's background colour. */
export const mermaidTheme = (background) => (isDark(background) ? "dark" : "default");

/**
 * Why a diagram wasn't drawn, from the render's { code, stderr } or a thrown error:
 * no mmdc, too slow, or Mermaid's own message (its first lines, without the stack).
 */
export function mermaidFailure({ code = 1, stderr = "", error = null } = {}) {
  const text = String(error ?? stderr ?? "");
  if (text.includes(NO_MMDC) || code === 127) return "Mermaid isn't installed (mermaid-cli)";
  if (/timed? ?out|timeout/i.test(text)) return "Mermaid took too long";
  const lines = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/^\s*Error:\s*/, "");
    if (!line.trim()) continue;
    if (/^\s+at\s|^\S+\.\S+ \(|https?:\/\//.test(raw) || lines.length >= 4) break;
    lines.push(line.trimEnd());
  }
  return lines.join("\n") || "Mermaid couldn't draw this diagram";
}

/**
 * sh: draws a Mermaid diagram with mmdc to <dir>/mermaid-<key>.png unless it's there,
 * then prints the file's name. Arguments: dir key theme source. The viewer's copy of
 * this script (cria-file-preview programs.js MERMAID) must stay the same; a unit test
 * compares them. Used by the chat (spec 012's drawing, for its replies).
 */
export const MERMAID_SH = String.raw`
dir=$1 key=$2 theme=$3 source=$4
name="mermaid-$key.png" out="$dir/mermaid-$key.png"
[ -f "$out" ] && { echo "$name"; exit 0; }
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
login=$SHELL; [ -n "$login" ] || login=/bin/sh
m=$(command -v mmdc) || m=$("$login" -lc 'command -v mmdc' 2>/dev/null | tail -n 1)
[ -n "$m" ] && [ -x "$m" ] || { echo "__no_mmdc__" >&2; exit 127; }
PATH="$(dirname "$m"):$PATH"
mkdir -p "$dir" || exit 1
src="$out.$$.mmd" tmp="$out.$$.png"
printf '%s\n' "$source" > "$src" || exit 1
"$m" -i "$src" -o "$tmp" -t "$theme" -b transparent -s 2 -q
code=$?
rm -f "$src"
[ $code -eq 0 ] && [ -f "$tmp" ] || { rm -f "$tmp"; exit 1; }
mv -f "$tmp" "$out" && echo "$name"`;

// The viewer's Windows script (cria-file-preview/programs.js MERMAID_WINDOWS, its PLACE
// written out), for the chat on Windows (spec 014); a test keeps the two the same. Run
// with lib/powershell.js: powershell(MERMAID_WINDOWS, win(dir), key, theme, source).
export const MERMAID_WINDOWS = String.raw`
$dir, $key, $theme, $source = $args
$name = 'mermaid-' + $key + '.png'
$out = $dir + '\' + $name
if (-not [IO.File]::Exists($out)) {
  $m = Get-Command mmdc -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $m) { throw '__no_mmdc__' }
  [void][IO.Directory]::CreateDirectory($dir)
  $src = $out + '.' + $PID + '.mmd'
  $tmp = $out + '.' + $PID + '.png'
  [IO.File]::WriteAllText($src, $source + [char]10)
  $said = & $m.Source -i $src -o $tmp -t $theme -b transparent -s 2 -q 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
  if ($code -ne 0 -or -not [IO.File]::Exists($tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; throw $said }
  try { [IO.File]::Move($tmp, $out) } catch { if (-not [IO.File]::Exists($out)) { throw }; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
$name`;
