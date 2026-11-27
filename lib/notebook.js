// A Jupyter notebook (.ipynb) as Markdown for the viewer (spec 017 R1): each cell in
// order, Markdown as written, code fenced in the notebook's language with its In [n],
// and its outputs: text, results, errors (ANSI colours stripped) and pictures. The
// pictures are returned beside the text, base64, for the viewer to cache; the text
// marks each with ![…](nbimg:<n>). Pure.

const text = (v) => (Array.isArray(v) ? v.join("") : String(v ?? ""));
const ansi = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
// A fence longer than any backtick run inside, so the text can't close it.
const fence = (body, lang = "") => {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${body.replace(/\n+$/, "")}\n${f}`;
};
const PICTURES = [["image/png", "png"], ["image/jpeg", "jpg"], ["image/gif", "gif"], ["image/svg+xml", "svg"]];

/**
 * { markdown, images: [{ ext, data }] } for a parsed notebook (nbformat 4; 3's
 * worksheets too). `data` is base64, an SVG's text already encoded.
 */
export function notebookToMarkdown(nb) {
  const cells = nb?.cells ?? nb?.worksheets?.flatMap((w) => w.cells ?? []) ?? [];
  const lang = nb?.metadata?.language_info?.name ?? nb?.metadata?.kernelspec?.language ?? "";
  const images = [];
  const picture = (data) => {
    for (const [mime, ext] of PICTURES) {
      if (data?.[mime] == null) continue;
      const raw = text(data[mime]);
      const b64 = ext === "svg" ? base64(raw) : raw.replace(/\s+/g, "");
      images.push({ ext, data: b64 });
      return `![output](nbimg:${images.length - 1})`;
    }
    return null;
  };
  const out = [];
  for (const cell of cells) {
    const src = text(cell.source ?? cell.input);
    if (cell.cell_type === "markdown") { if (src.trim()) out.push(src.trim()); continue; }
    if (cell.cell_type === "raw") { if (src.trim()) out.push(fence(src)); continue; }
    if (cell.cell_type !== "code") continue;
    const n = cell.execution_count ?? cell.prompt_number;
    out.push(`**In [${n ?? " "}]:**`);
    out.push(fence(src, lang));
    for (const o of cell.outputs ?? []) {
      if (o.output_type === "stream") { const s = ansi(text(o.text)); if (s.trim()) out.push(fence(s)); continue; }
      if (o.output_type === "error" || o.output_type === "pyerr") {
        out.push(fence(ansi(text(o.traceback?.join?.("\n") ?? `${o.ename}: ${o.evalue}`))));
        continue;
      }
      if (o.output_type === "execute_result" || o.output_type === "display_data" || o.output_type === "pyout") {
        const data = o.data ?? o;
        const pic = picture(data);
        if (pic) { out.push(pic); continue; }
        if (data["text/markdown"] != null) { out.push(text(data["text/markdown"]).trim()); continue; }
        const plain = data["text/plain"] ?? data.text;
        if (plain != null) out.push(fence(ansi(text(plain))));
        else if (data["text/html"] != null) out.push(fence(text(data["text/html"]).replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim()));
      }
    }
  }
  return { markdown: out.join("\n\n") + "\n", images };
}

// Base64 of a string's UTF-8 bytes, without Buffer or btoa (the viewer's runtime has
// neither reliably).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64(s) {
  const bytes = [...unescape(encodeURIComponent(s))].map((c) => c.charCodeAt(0));
  let r = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3), n = (a << 16) | (b << 8) | c;
    r += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return r;
}
