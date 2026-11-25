// External-app rules (spec 005 R9-R11): which app opens a file outside Herdr.
// Pure: no herdr imports. The config lives at ~/.config/herdr-mods/external.json.

import { fileType, extension } from "./filetype.js";

// Linux: an app started from exec must not stay in the foreground, or exec waits
// for it (and its timeout ends it). Zettlr is started in a session of its own; the
// default app goes through `gio open`, else a detached xdg-open (LINUX_OPEN, after
// munza/herdr-mods better-files files/shell/linux.js, Apache-2.0).
export const LINUX_OPEN = `[ -e "$1" ] || { echo 'It is no longer there.' >&2; exit 1; }
if command -v gio >/dev/null 2>&1; then exec gio open "$1"; fi
command -v xdg-open >/dev/null 2>&1 || { echo 'Neither gio nor xdg-open is installed.' >&2; exit 1; }
setsid -f xdg-open "$1" >/dev/null 2>&1`;

export const DEFAULT_RULES = [
  { match: { type: "markdown" }, app: "Zettlr",
    macos: ["open", "-a", "Zettlr", "{path}"], linux: ["setsid", "-f", "zettlr", "{path}"] },
  { match: { any: true }, app: "default app",
    macos: ["open", "{path}"], linux: ["sh", "-c", LINUX_OPEN, "open", "{path}"],
    windows: ["cmd", "/c", "start", "", "{path}"] },
];

/** Rules from the config file's text; the defaults when there is none or it is invalid. */
export function parseRules(text) {
  if (text == null || text === "") return { rules: DEFAULT_RULES, error: null };
  try {
    const rules = JSON.parse(text)?.rules;
    if (!Array.isArray(rules)) return { rules: DEFAULT_RULES, error: "external.json has no \"rules\" list" };
    return { rules, error: null };
  } catch (e) {
    return { rules: DEFAULT_RULES, error: `external.json: ${e.message}` };
  }
}

function matches(match, path) {
  if (!match || typeof match !== "object") return false;
  if (match.any === true) return true;
  if (match.type && fileType(path).kind === match.type) return true;
  if (Array.isArray(match.ext) && match.ext.map((e) => String(e).toLowerCase()).includes(extension(path))) return true;
  return false;
}

/** The first rule that fits the file and has a command for the platform, or null. */
export function pickRule(rules, path, platform) {
  for (const rule of rules ?? []) {
    if (matches(rule.match, path) && Array.isArray(rule[platform]) && rule[platform].length) return rule;
  }
  return null;
}

/** The argument vector for a rule; "{path}" is replaced inside each argument, never split. */
export function argvFor(rule, platform, path) {
  const argv = rule?.[platform];
  if (!Array.isArray(argv) || !argv.length) return null;
  return argv.map((a) => String(a).split("{path}").join(path));
}
