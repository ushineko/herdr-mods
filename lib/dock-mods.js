// Mod subtabs in the dock (herdr-mods spec 018, jira-viewer spec 026 D8): a subtab
// that holds a mod's block instead of a terminal. The subtab's name is "mod:<mod>",
// kept in the dock's stack like a terminal name; the mod is one whose mod.json has
// a "dock" entry: { "title": "Jira", "icon": "icon" } (the icon an svg in its folder).
// Pure: no herdr import.

const PREFIX = "mod:";

/** The subtab name for a mod. */
export const modTabName = (mod) => `${PREFIX}${mod}`;

/** True when a subtab name is a mod's. */
export const isModTab = (name) => typeof name === "string" && name.startsWith(PREFIX);

/** The mod a subtab name holds, or null. */
export const modOfTab = (name) => (isModTab(name) ? name.slice(PREFIX.length) : null);

/** A mod's name is a folder name: letters, digits, dot, dash and underscore. */
const MOD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The dock entries among installed mods: [{ mod, title, icon }] from each mod's
 * name and mod.json text, in name order. A mod without a "dock" entry, or with
 * one that names no title, is not offered; an icon defaults to "icon".
 */
export function dockMods(entries) {
  const out = [];
  for (const { name, json } of entries ?? []) {
    if (!MOD_NAME.test(String(name ?? ""))) continue;
    let dock;
    try { dock = JSON.parse(json ?? "")?.dock; } catch { continue; }
    if (!dock || typeof dock !== "object" || typeof dock.title !== "string" || !dock.title.trim()) continue;
    const icon = typeof dock.icon === "string" && /^[A-Za-z0-9._-]+$/.test(dock.icon) ? dock.icon : "icon";
    out.push({ mod: name, title: dock.title.trim(), icon });
  }
  return out.sort((a, b) => a.mod.localeCompare(b.mod));
}

/** The icon's path for a dock mod entry, relative to the app home, as svg() takes it. */
export const dockModIcon = ({ mod, icon }) => `mods/${mod}/${icon}.svg`;

/** The shell script that lists the app home's mod.json files, one path a line ($1: the mods folder). */
export const LIST_MODS = `for f in "$1"/*/mod.json; do [ -f "$f" ] && printf '%s\\n' "$f"; done; exit 0`;

/** Mod names from LIST_MODS's output. */
export function modNamesFrom(stdout, modsDir) {
  const names = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const path = line.trim();
    if (!path.startsWith(`${modsDir}/`) || !path.endsWith("/mod.json")) continue;
    const name = path.slice(modsDir.length + 1, -"/mod.json".length);
    if (MOD_NAME.test(name)) names.push(name);
  }
  return names;
}
