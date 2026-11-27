// herdr-mods (spec 017): spreadsheets (.xlsx, .xls, .ods) as tables, one sheet at a
// time with the sheets to pick from in the toolbar. LibreOffice converts the file to
// flat OpenDocument in the cache (document.js convertHere); lib/fods.js reads each
// sheet's cells as the sheet shows them; the table viewer draws the one shown.
import { h_flex } from "gpui-base";
import { theme, readTextFile } from "herdr";
import table from "./table.js";
import { segmented } from "./controls.js";
import { convertHere } from "./document.js";
import { columnWidths } from "../delimited.js";
import { parseFods } from "../lib/fods.js";

const LIMIT = 100000;
let views = 0;

// A sheet as the table viewer's state.
function tableOf(sheet, id) {
  const rows = sheet.rows;
  return { text: "", header: rows[0] ?? [], body: rows.slice(1, LIMIT + 1), truncated: rows.length > LIMIT + 1,
    widths: columnWidths(rows), raw: false, editor: null, id };
}

export default {
  id: "sheet",
  async load(file, env, previous) {
    const fods = await convertHere(file, env, "sheet");
    const xml = await readTextFile(fods);
    if (xml === null) throw new Error("Cannot read the converted spreadsheet");
    const sheets = parseFods(xml, LIMIT + 2);
    if (!sheets.length) throw new Error("This spreadsheet has no sheets");
    const id = `cria-file-preview-sheet-${++views}`;
    const index = Math.min(previous?.index ?? 0, sheets.length - 1);
    return { sheets, index, id, table: tableOf(sheets[index], `${id}-${index}`) };
  },

  toolbar(state) {
    const show = (i) => { state.index = i; state.table = tableOf(state.sheets[i], `${state.id}-${i}`); };
    const t = state.table;
    return h_flex().gap(8).items_center().text_size(12).text_color(theme().dim)
      .child(`${t.body.length.toLocaleString()}${t.truncated ? "+" : ""} rows × ${t.widths.length} columns`)
      .when(state.sheets.length > 1, (el) => el.child(segmented(state.sheets.map((s, i) => [`${state.id}-s${i}`, s.name, i === state.index, () => show(i)]))));
  },

  render: (state) => table.render(state.table),
};
