// A spreadsheet as the viewer's tables (spec 017): LibreOffice converts .xlsx, .xls
// and .ods to flat OpenDocument (.fods, one XML file), and this reads its sheets, in
// order, as rows of cell text as the sheet shows it (formatted: "$42.00", dates as
// written). Repeated rows and columns are expanded, up to a limit; empty rows and
// columns at the ends are dropped. Pure.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unescape(m[1]) : null; };

// A cell's shown text: its paragraphs joined by a space; <text:s c="n"/> spaces, tabs
// and line breaks kept as whitespace; other markup dropped.
function cellText(inner) {
  const paras = [...inner.matchAll(/<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g)].map((m) => (m[1] ?? "")
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, c) => " ".repeat(Number(c ?? 1)))
    .replace(/<text:tab\s*\/>/g, "\t").replace(/<text:line-break\s*\/>/g, " ")
    .replace(/<[^>]+>/g, ""));
  return unescape(paras.join(" "));
}

/** [{ name, rows: string[][] }] for a .fods document; `limit` caps rows and columns. */
export function parseFods(xml, limit = 100000) {
  const sheets = [];
  for (const t of String(xml ?? "").matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows = [];
    for (const r of t[2].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const cells = [];
      for (const c of (r[2] ?? "").matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const text = c[2] ? cellText(c[2]) : "";
        const n = Math.min(Number(attr(c[1], "table:number-columns-repeated") ?? 1), limit - cells.length);
        for (let i = 0; i < n; i++) cells.push(text);
        if (cells.length >= limit) break;
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      const n = Math.min(Number(attr(r[1], "table:number-rows-repeated") ?? 1), limit - rows.length);
      // A long run of empty rows is the sheet's blank remainder; only the copies count.
      for (let i = 0; i < n; i++) rows.push(cells);
      if (rows.length >= limit) break;
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    sheets.push({ name: attr(t[1], "table:name") ?? `Sheet ${sheets.length + 1}`, rows });
  }
  return sheets;
}
