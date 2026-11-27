// HTML made safe to print (spec 017 R3): the viewer prints a copy of a page with a
// headless browser, and the page's scripts must not run there. Turning scripts off in
// the browser stops it printing, so they are taken out of the copy instead: <script>
// elements, inline on…= handlers and javascript: links. A <base> points the copy's
// relative styles and pictures back at the page's own folder. Pure.

/** `html` without scripts, with <base href="baseHref"> first in its head. */
export function printableHtml(html, baseHref) {
  let s = String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  const base = baseHref ? `<base href="${String(baseHref).replace(/"/g, "%22")}">` : "";
  if (!base) return s;
  if (/<head\b[^>]*>/i.test(s)) return s.replace(/<head\b[^>]*>/i, (m) => m + base);
  if (/<html\b[^>]*>/i.test(s)) return s.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${base}</head>`);
  return base + s;
}

/** A local folder as a file: URL for <base> (POSIX or Windows path), ending in /. */
export function folderUrl(folder) {
  const f = String(folder ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const path = /^[A-Za-z]:/.test(f) ? `/${f}` : f;
  return `file://${path.split("/").map(encodeURIComponent).join("/").replace(/%3A/g, ":")}/`;
}
