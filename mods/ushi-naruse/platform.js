// What the chat needs from the desktop it runs on: the clipboard, the file picker,
// opening a file, and an image's size. macOS and Linux: each tries the macOS tool
// first, then the Linux ones (Wayland, then X11). Windows (herdr-mods, spec 014):
// PowerShell, through lib/powershell.js.
import { exec, window, appHome } from "herdr";
import * as fs from "fs/promises";
import { powershell, win } from "./lib/powershell.js";
import { imageSizeOf } from "./lib/image-size.js";

const sh = (script, ...args) => exec("sh", ["-c", script, "sh", ...args]);
const windows = () => { try { return window()?.platform === "windows"; } catch { return false; } };
const ps = (script, ...values) => { const [program, args] = powershell(script, ...values); return exec(program, args); };

// Puts text on the clipboard; false when no clipboard tool is installed.
export async function copyText(text) {
  // Windows: the text goes through a file, as a command line holds only 32 K.
  if (windows()) {
    const file = `${appHome()}/data/ushi-naruse/clip-${Date.now()}.txt`;
    try { await fs.writeFile(file, String(text)); } catch { return false; }
    const r = await ps("$f = $args[0]; Set-Clipboard -Value ([IO.File]::ReadAllText($f)); Remove-Item -LiteralPath $f -Force", win(file)).catch(() => null);
    await fs.unlink(file).catch(() => {});
    return r?.code === 0;
  }
  const r = await sh(`
    if command -v pbcopy >/dev/null 2>&1; then printf "%s" "$1" | pbcopy
    elif [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null 2>&1; then printf "%s" "$1" | wl-copy
    elif command -v xclip >/dev/null 2>&1; then printf "%s" "$1" | xclip -selection clipboard
    elif command -v xsel >/dev/null 2>&1; then printf "%s" "$1" | xsel --clipboard --input
    elif command -v wl-copy >/dev/null 2>&1; then printf "%s" "$1" | wl-copy
    elif q=$(command -v qdbus6 || command -v qdbus) && "$q" org.kde.klipper /klipper >/dev/null 2>&1; then "$q" org.kde.klipper /klipper setClipboardContents "$1"
    else exit 3; fi`, text);
  return r.code === 0;
}

// Saves an image on the clipboard to `path` as PNG: true, false when there's
// none, or "missing" when this desktop has no tool to read it.
export async function pasteImage(path) {
  if (windows()) {
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$i = [Windows.Forms.Clipboard]::GetImage()
if (-not $i) { exit 2 }
$i.Save($args[0], [Drawing.Imaging.ImageFormat]::Png)`, win(path)).catch(() => null);
    return r?.code === 0;
  }
  const r = await sh(`
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "set f to open for access (POSIX file \\"$1\\") with write permission" \\
        -e "write (the clipboard as «class PNGf») to f" -e "close access f" >/dev/null 2>&1
    elif command -v wl-paste >/dev/null 2>&1 && wl-paste --list-types 2>/dev/null | grep -q '^image/png'; then wl-paste --type image/png > "$1"
    elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -t image/png -o > "$1" 2>/dev/null
    else exit 3; fi
    [ -s "$1" ]`, path);
  return r.code === 3 ? "missing" : r.code === 0;
}

// Opens a file in the desktop's default app (an image in Preview, say).
export function openFile(path) {
  if (windows()) return ps("Invoke-Item -LiteralPath $args[0]", win(path));
  return sh(`if command -v open >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then open "$1"; else xdg-open "$1" >/dev/null 2>&1 & fi`, path);
}

// The system's file picker, several files at once: their paths, [] when
// cancelled, or null when this desktop has no picker the chat can use.
export async function pickFiles(prompt = "Attach to your message") {
  if (windows()) {
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms
$d = New-Object Windows.Forms.OpenFileDialog
$d.Multiselect = $true
$d.Title = $args[0]
if ($d.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { $d.FileNames -join [char]10 }`, prompt).catch(() => null);
    if (!r || r.code !== 0) return null;
    return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  const r = await sh(`
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "set fs to choose file with prompt \\"$1\\" with multiple selections allowed" \\
        -e 'set out to ""' -e 'repeat with f in fs' -e 'set out to out & POSIX path of f & linefeed' -e 'end repeat' -e 'return out'
    elif command -v kdialog >/dev/null 2>&1; then kdialog --title "$1" --getopenfilename "$HOME" --multiple --separate-output
    elif command -v zenity >/dev/null 2>&1; then zenity --file-selection --multiple --separator="
" --title="$1"
    elif command -v yad >/dev/null 2>&1; then yad --file --multiple --separator="
" --title="$1"
    else exit 3; fi; true`, prompt);
  if (r.code === 3) return null;
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// An image's pixel size from its header (PNG, JPEG, GIF, WebP), read here with no
// other program (herdr-mods, spec 014: python3 isn't on Windows): { w, h }, or null.
// The chat asks only for images in its cache, under the app home.
export async function imageSize(path) {
  try { return imageSizeOf(await fs.readFile(path)); } catch { return null; }
}
