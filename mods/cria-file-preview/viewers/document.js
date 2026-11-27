// herdr-mods (spec 017): HTML, Word, RTF and OpenDocument text, shown as the PDF
// viewer shows a PDF: converted once per version into the viewer's cache (programs.js
// CONVERT: a headless browser for HTML, given a copy without scripts; LibreOffice for
// documents), then paged, zoomed and jumped through like any PDF. HTML has Raw too
// (its source). A file on another machine is copied here first: an HTML page's text
// (its relative styles and pictures don't come along), a document's bytes
// (media.js fetchHere).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, appHome, window, readTextFile } from "herdr";
import * as fs from "fs/promises";
import pdf from "./pdf.js";
import { readText, codeState, codeView } from "./text.js";
import { rawToggle } from "./controls.js";
import { programs } from "../programs.js";
import { extension } from "../kinds.js";
import { key, fetchHere } from "../media.js";
import { printableHtml, folderUrl } from "../lib/html-print.js";

const DIR = () => `${appHome().split("\\").join("/")}/data/cria-file-preview`;
const kindOf = (file) => (/^html?$/.test(extension(file)) ? "html" : "office");
const MISSING = {
  __no_browser__: "No headless browser here to draw HTML (Chromium, Chrome or Edge).",
  __no_office__: "LibreOffice isn't installed (it converts Word, RTF, spreadsheets and OpenDocument files).",
};

// `file` converted in the cache (when it changed), its absolute path: a PDF, or for
// kind "sheet" a flat OpenDocument spreadsheet (viewers/sheet.js).
export async function convertHere(file, env, kind = kindOf(file)) {
  let src = file;
  if (kind === "html") {
    // A copy without scripts is printed (lib/html-print.js); a local page's relative
    // styles and pictures still load from its folder through <base>.
    const text = await readTextFile(file, { on: env.on });
    if (text === null) throw new Error("Cannot read this file");
    const folder = String(file).replace(/[\\/][^\\/]*$/, "");
    await fs.mkdir(DIR(), { recursive: true }).catch(() => {});
    src = `${DIR()}/${key(`${env.on ?? ""}:${file}`)}-${key(text)}.html`;
    await fs.writeFile(src, printableHtml(text, env.on ? "" : folderUrl(folder)));
  } else if (env.on) src = await fetchHere(file, env.on);
  const [program, args] = programs(window()?.platform).convert(kind, src, DIR(), key(src));
  const r = await exec(program, args, { timeout: 120000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  if (r.code !== 0) {
    const said = (r.stderr || r.stdout || "").trim();
    const known = Object.keys(MISSING).find((k) => said.includes(k));
    throw new Error(known ? MISSING[known] : said.split("\n").pop() || "The conversion failed");
  }
  return `${DIR()}/${r.stdout.trim().split("\n").pop()}`;
}

export default {
  id: "document",
  async load(file, env, previous) {
    const html = kindOf(file) === "html";
    const text = html ? await readText(file, env.on) : null;
    let pdfFile = null, pdfState = null, error = null;
    try {
      pdfFile = await convertHere(file, env);
      pdfState = await pdf.load(pdfFile, { ...env, on: null, file: pdfFile }, previous?.pdf);
    } catch (e) { error = String(e?.message ?? e); }
    // HTML that can't be drawn shows its source, with why.
    const raw = html && (Boolean(error) || (previous?.raw ?? false));
    if (!html && error) throw new Error(error);
    return { html, text, error, raw, editor: raw ? codeState(text, "html") : null, pdf: pdfState, pdfEnv: pdfFile ? { ...env, on: null, file: pdfFile } : null };
  },

  start(state, env, cx) {
    if (state.pdf) pdf.start(state.pdf, { ...state.pdfEnv, size: env.size }, cx);
  },

  toolbar(state, env) {
    const t = theme();
    return h_flex().gap(8).items_center()
      .when(Boolean(state.pdf) && !state.raw, (el) => el.child(pdf.toolbar(state.pdf, env)))
      .when(state.html && Boolean(state.error), (el) => el.child(div().max_w(380).truncate().text_size(12).text_color(t.dim).child(state.error)))
      .when(state.html && Boolean(state.pdf), (el) => el.child(rawToggle(state, "Rendered", "html")));
  },

  render(state, env) {
    // The source: its editor made in load (an error) or by the Raw toggle.
    if (state.raw) return codeView(state.editor);
    return pdf.render(state.pdf, { ...state.pdfEnv, size: env.size });
  },

  release(state) {
    if (state.pdf) pdf.release(state.pdf);
    state.editor?.release();
  },
};
