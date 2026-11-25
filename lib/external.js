// External-app rules (spec 005 R9-R11): which app opens a file outside Herdr.
// Pure: no herdr imports. The config lives at ~/.config/herdr-mods/external.json.

import { fileType, extension } from "./filetype.js";

export const DEFAULT_RULES = [
  { match: { type: "markdown" }, app: "Zettlr",
    macos: ["open", "-a", "Zettlr", "{path}"], linux: ["zettlr", "{path}"] },
  { match: { any: true }, app: "default app",
    macos: ["open", "{path}"], linux: ["xdg-open", "{path}"],
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
