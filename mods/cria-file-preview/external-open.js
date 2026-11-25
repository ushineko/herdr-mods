// herdr-mods addition (not upstream): "Open in <app>" from per-machine rules in
// ~/.config/herdr-mods/external.json (spec 005 R9-R11; defaults: Markdown -> Zettlr).
// The app runs on the file's machine, so a remote file opens on that machine's desktop.
import { exec, notify, window } from "herdr";
import { parseRules, pickRule, argvFor } from "./lib/external.js";
import { basename } from "./kinds.js";

// Per machine ("" = here): { platform, rules, error, at }; re-read after a minute.
const machines = new Map();

async function machineInfo(on) {
  const known = machines.get(on ?? "");
  if (known && Date.now() - known.at < 60000) return known;
  let info;
  if (!on && window()?.platform === "windows") {
    // No sh on Windows: the defaults only (a config file there is not read yet).
    info = { platform: "windows", ...parseRules(null) };
  } else {
    const r = await exec("sh", ["-c", 'uname -s; cat "$HOME/.config/herdr-mods/external.json" 2>/dev/null'], { on });
    const [os, ...rest] = r.stdout.split("\n");
    info = { platform: os.trim() === "Darwin" ? "macos" : "linux", ...parseRules(rest.join("\n").trim() || null) };
  }
  info.at = Date.now();
  machines.set(on ?? "", info);
  return info;
}

/** The rule that opens `file` on `on`, or null. Resolves; never throws. */
export async function externalRule(file, on) {
  try {
    const info = await machineInfo(on);
    if (info.error) notify({ title: "external.json ignored", body: info.error, level: "warning" });
    return pickRule(info.rules, file, info.platform);
  } catch {
    return null;
  }
}

/** Opens `file` in its external app, on its machine, and says so. */
export async function openExternal(file, on) {
  const info = await machineInfo(on).catch(() => null);
  const rule = info && pickRule(info.rules, file, info.platform);
  const argv = rule && argvFor(rule, info.platform, file);
  if (!argv) { notify({ title: "No external app for this file", body: basename(file), level: "warning" }); return; }
  try {
    const r = await exec(argv[0], argv.slice(1), { on });
    if (r.code === 0) notify({ title: `Opened in ${rule.app}`, body: on ? `${basename(file)} · on ${on}` : basename(file), level: "success", timeout: 2500 });
    else notify({ title: `${rule.app} failed`, body: (r.stderr || r.stdout).trim().split("\n")[0], level: "error" });
  } catch (e) {
    notify({ title: `${rule.app} failed`, body: String(e?.message ?? e), level: "error" });
  }
}
