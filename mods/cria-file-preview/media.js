// Pictures for image(), which reads only from the Herdr home: a local file is
// copied into data/cria-file-preview/, named by its path and modification time; a
// web image, once the person asked, is downloaded there (https only, 5 MB,
// 10 s, image types only). Each is measured: sips on macOS, `file` on Linux, WPF on
// Windows, the SVG's own width/height or viewBox.
import { exec, appHome, window } from "herdr";
import { extension } from "./kinds.js";
import { svgSize } from "./svg-size.js";
import { imageExtension } from "./mime.js";
import { programs, pictureSize } from "./programs.js";
import { readText } from "./viewers/text.js";
import { mermaidFailure } from "./lib/mermaid.js"; // herdr-mods
import * as fs from "fs/promises"; // herdr-mods

const DIR = () => `${appHome().split("\\").join("/")}/data/cria-file-preview`;
const here = () => programs(window()?.platform);

// A short, stable name for a path (FNV-1a).
export function key(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// Size in pixels of a cached picture, by its name in data/cria-file-preview/.
async function measure(name) {
  const file = `${DIR()}/${name}`;
  if (name.endsWith(".svg")) return svgSize(await readText(file));
  return pictureSize((await exec(...here().size(file))).stdout);
}

async function picture(name) {
  const size = await measure(name);
  if (!(size.width > 0 && size.height > 0)) throw new Error("This image format can't be shown");
  return { path: `data/cria-file-preview/${name}`, ...size };
}

/** Resolves { path (for image()), width, height } for a local picture. */
export async function stageImage(file) {
  const r = await exec(...here().stage(file, DIR(), key(file), extension(file)));
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot read this image");
  return picture(r.stdout.trim());
}

/** The same for a web image: downloaded, then kept only when it is an image. */
export async function fetchImage(url) {
  const k = key(url), r = await exec(...here().fetch(url, DIR(), k));
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Download failed");
  const ext = imageExtension(r.stdout.trim()), tmp = `${DIR()}/${k}.download`;
  if (!ext) { await exec(...here().remove(tmp)); throw new Error(`Not an image (${r.stdout.trim()})`); }
  const kept = `${DIR()}/${k}.${ext}`;
  await exec(...here().move(tmp, kept));
  return picture(`${k}.${ext}`).catch(async (e) => { await exec(...here().remove(kept)); throw e; });
}

/**
 * herdr-mods (spec 017): a picture given as base64 (a notebook's output), cached as
 * <key of the data>.<ext> once: resolves { path, width, height }.
 */
// herdr-mods (spec 017): a file on another machine, copied into the cache here, for the
// viewers that run this computer's tools on it (PDF, pictures, documents). Its bytes
// come over as base64 (remote files are always sh); the copy is named by machine,
// path and content, so a changed file is copied again. Resolves the copy's path.
const MAX_FETCH = 50 * 1024 * 1024;
const FETCH = String.raw`[ -f "$1" ] || { echo "This file is gone" >&2; exit 1; }
[ "$(wc -c < "$1")" -le ${MAX_FETCH} ] || { echo "Too large to copy here (over 50 MB)" >&2; exit 1; }
base64 < "$1"`;
export async function fetchHere(file, on) {
  const r = await exec("sh", ["-c", FETCH, "fetch", file], { on, timeout: 60000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot copy this file here");
  const data = r.stdout.replace(/\s+/g, "");
  await fs.mkdir(DIR(), { recursive: true }).catch(() => {});
  const copy = `${DIR()}/${key(`${on}:${file}`)}-${key(data)}.${extension(file)}`;
  if (!(await fs.exists(copy).catch(() => false))) {
    await fs.writeFile(`${copy}.b64`, data);
    const d = await exec(...here().decode(`${copy}.b64`, copy));
    if (d.code !== 0) throw new Error(d.stderr.trim() || "Cannot copy this file here");
  }
  return copy;
}

export async function stageData(ext, data) {
  const name = `${key(data)}.${ext}`, file = `${DIR()}/${name}`;
  if (!(await fs.exists(file).catch(() => false))) {
    await fs.mkdir(DIR(), { recursive: true }).catch(() => {});
    await fs.writeFile(`${file}.b64`, data);
    const r = await exec(...here().decode(`${file}.b64`, file));
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot write this picture");
  }
  return picture(name);
}

/**
 * herdr-mods (spec 012): a Mermaid diagram drawn by mmdc, at scale 2: resolves
 * { path, width, height } with the size halved, or rejects with what to tell the person.
 */
export async function drawMermaid(source, theme) {
  const r = await exec(...here().mermaid(DIR(), key(`${theme}\n${source}`), theme, source), { timeout: 30000 })
    .catch((e) => ({ code: 1, stdout: "", stderr: "", error: String(e?.message ?? e) }));
  if (r.code !== 0) throw new Error(mermaidFailure(r));
  const p = await picture(r.stdout.trim().split("\n").pop());
  return { ...p, width: p.width / 2, height: p.height / 2 };
}

/** Drops cached pages and pictures older than a day, and all but the newest KEEP (herdr-mods). */
export function pruneCache() {
  return exec(...here().prune(DIR())).catch(() => null);
}
