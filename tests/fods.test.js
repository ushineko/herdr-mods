import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFods } from "../lib/fods.js";

const doc = (tables) => `<?xml version="1.0"?><office:document><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document>`;

test("parseFods: sheets in order, shown text, repeats expanded, empty ends dropped", () => {
  const xml = doc(`<table:table table:name="Spending &amp; more"><table:table-column/>
<table:table-row><table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Sep</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>A<text:s text:c="2"/>B</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="42"><text:p>$42.00</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1020"/></table:table-row>
<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
</table:table><table:table table:name="Notes"><table:table-row><table:table-cell><text:p>one</text:p><text:p>two</text:p></table:table-cell></table:table-row></table:table>`);
  const sheets = parseFods(xml);
  assert.deepEqual(sheets.map((s) => s.name), ["Spending & more", "Notes"]);
  assert.deepEqual(sheets[0].rows, [["Item", "Sep"], ["A  B", "$42.00"], ["x", "x"], ["x", "x"]]);
  assert.deepEqual(sheets[1].rows, [["one two"]]);
});

test("parseFods: limit caps rows and columns; covered cells keep their place", () => {
  const xml = doc(`<table:table table:name="S"><table:table-row table:number-rows-repeated="10"><table:table-cell table:number-columns-repeated="10"><text:p>v</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>c</text:p></table:table-cell></table:table-row></table:table>`);
  assert.equal(parseFods(xml, 3)[0].rows.length, 3);
  assert.equal(parseFods(xml, 3)[0].rows[0].length, 3);
  assert.deepEqual(parseFods(xml)[0].rows[10], ["wide", "", "c"]);
});
