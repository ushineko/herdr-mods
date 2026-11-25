// Which editor command opens a file (spec 005 R6a). Pure: no herdr imports.

// Editors that take "+N" to start at line N.
const PLUS_LINE = new Set(["vi", "vim", "nvim", "view", "nano", "pico", "emacs", "emacsclient", "kak", "mg", "jed", "ne", "joe"]);

/**
 * The argv that opens `path` (at `line`) in `editor`, a command line such as "nvim",
 * "code --wait" or "/usr/bin/vim -p". Wait flags are dropped (nothing waits here).
 * With no editor: nvim. Words are split on spaces; quoting is not supported.
 */
export function editorArgv(editor, path, line = null) {
  const words = String(editor ?? "").trim().split(/\s+/).filter((w) => w && w !== "--wait" && w !== "-w");
  if (!words.length) words.push("nvim");
  const name = words[0].split(/[\\/]/).pop().replace(/\.exe$/i, "");
  const at = line && PLUS_LINE.has(name) ? [`+${line}`] : [];
  return [...words, ...at, path];
}
