// What kind of file a path is, for the viewer and nav. Pure: no herdr imports.

const MARKDOWN = new Set(["md", "markdown", "mdx", "mkd"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

// Extension -> the editor's language name. The editor takes most extensions
// as they are; these are the ones it knows under another name.
const LANG_ALIAS = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  jsonc: "json", json5: "json",
  toml: "yaml", yml: "yaml",
  svelte: "html", vue: "html", htm: "html", xml: "html", plist: "html",
  bash: "sh", zsh: "sh", ksh: "sh", fish: "sh", env: "sh",
  h: "c", hpp: "cpp", cc: "cpp", cxx: "cpp", hh: "cpp",
  pyi: "py",
};

const CODE = new Set([
  "js", "ts", "tsx", "jsx", "mjs", "cjs", "mts", "cts", "json", "jsonc", "json5",
  "py", "pyi", "go", "rs", "sh", "bash", "zsh", "ksh", "fish", "env",
  "yaml", "yml", "toml", "html", "htm", "xml", "plist", "css", "scss",
  "c", "h", "cpp", "hpp", "cc", "cxx", "hh", "java", "kt", "swift", "rb", "lua",
  "sql", "zig", "ex", "exs", "svelte", "vue", "nix", "tf", "proto", "ini", "conf",
]);

// Whole file names that are code without an extension.
const NAMED = {
  dockerfile: "dockerfile", makefile: "make", gnumakefile: "make",
  pkgbuild: "sh", ".zshrc": "sh", ".bashrc": "sh", ".profile": "sh",
  ".zprofile": "sh", ".gitconfig": "ini", ".gitignore": "sh",
};

export function baseName(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

export function extension(path) {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * The kind of a file by its name: { kind, lang }.
 * kind: "markdown" | "image" | "code" | "text". lang: the editor language, or null.
 */
export function fileType(path) {
  const name = baseName(path).toLowerCase();
  if (NAMED[name]) return { kind: "code", lang: NAMED[name] };
  const ext = extension(path);
  if (MARKDOWN.has(ext)) return { kind: "markdown", lang: "markdown" };
  if (IMAGE.has(ext)) return { kind: "image", lang: null };
  if (CODE.has(ext)) return { kind: "code", lang: LANG_ALIAS[ext] ?? ext };
  return { kind: "text", lang: null };
}

/** True when text looks binary (contains NUL). */
export function isBinary(text) {
  return typeof text === "string" && text.includes("\0");
}

/** Cut text to `limit` UTF-16 units; says whether it was cut. */
export function bounded(text, limit) {
  if (text.length <= limit) return { text, cut: false };
  const at = text.lastIndexOf("\n", limit);
  return { text: text.slice(0, at > 0 ? at : limit), cut: true };
}

export function lineCount(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n - 1 : n;
}
