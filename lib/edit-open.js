// Open a file in the person's editor in a new terminal tab (spec 001 R15, 005 R6a).
// The tab opens in the given space, in the file's folder; a space on another machine
// runs the editor there. Not pure: it calls herdr.
import { exec, run, notify, spaces } from "herdr";
import { editorArgv } from "./editor.js";

// Per machine ("" = here): the editor command from the login shell, cached a minute.
const editors = new Map();

async function editorOn(on) {
  const known = editors.get(on ?? "");
  if (known && Date.now() - known.at < 60000) return known.editor;
  let editor = "";
  try {
    // The login shell sets $EDITOR (zsh in .zshenv); a profile's greeting can't leak past the marker.
    const r = await exec("sh", ["-c", '"${SHELL:-/bin/sh}" -lc \'printf "\\n__herdr_editor__%s" "${VISUAL:-$EDITOR}"\' 2>/dev/null; command -v nvim >/dev/null && printf "\\n__herdr_has__nvim"'], { on });
    editor = /__herdr_editor__(.*)/.exec(r.stdout)?.[1]?.trim() ?? "";
    if (!editor) editor = r.stdout.includes("__herdr_has__nvim") ? "nvim" : "vi";
  } catch { editor = "nvim"; }
  editors.set(on ?? "", { editor, at: Date.now() });
  return editor;
}

/** Opens `path` (at `line`) in the editor, in a new tab of `space` (default: the shown one). */
export async function editFile({ path, on = null, line = null, space = null, focus = true }) {
  const editor = await editorOn(on);
  const argv = editorArgv(editor, path, line);
  const folder = path.replace(/[\\/][^\\/]*$/, "") || "/";
  const name = path.split(/[\\/]/).pop();
  const sp = space ?? spaces().find((s) => s.active)?.id;
  run("tab.new", { name: `✎ ${name}`, space: sp, folder, argv, focus });
  notify({ title: `Editing ${name}`, body: `${argv[0]}${on ? ` · on ${on}` : ""}`, level: "info", timeout: 2000 });
}
