import { test } from "node:test";
import assert from "node:assert/strict";
import { printableHtml, folderUrl } from "../lib/html-print.js";

test("printableHtml: scripts, handlers and javascript: links out; <base> first in the head", () => {
  const html = `<html><head><title>x</title><script>alert(1)</script><SCRIPT src="a.js"></SCRIPT></head>
<body onload="evil()"><a href="javascript:go()" onclick='x()'>a</a><img src=pic.png onerror=boom></body></html>`;
  const out = printableHtml(html, "file:///docs/");
  assert.doesNotMatch(out, /script|alert|evil|onclick|onerror|javascript:/i);
  assert.match(out, /<head><base href="file:\/\/\/docs\/"><title>/);
  assert.match(out, /<img src=pic\.png>/);
});

test("printableHtml: a page without a head gets one; no base given leaves it alone", () => {
  assert.equal(printableHtml("<html><p>x</p></html>", "file:///d/"), '<html><head><base href="file:///d/"></head><p>x</p></html>');
  assert.equal(printableHtml("<p>x</p>", ""), "<p>x</p>");
});

test("folderUrl: POSIX and Windows folders, spaces encoded", () => {
  assert.equal(folderUrl("/home/me/my docs"), "file:///home/me/my%20docs/");
  assert.equal(folderUrl("C:\\Users\\me\\site\\"), "file:///C:/Users/me/site/");
});
