// Open a file in a viewer tab (cria-file-preview, spec 001), or select the one already
// showing it in that space.
// Not pure: it calls herdr. Callers are mods, which pass their own `cx`.

import { run, spaces, shared, setShared } from "herdr";
import { baseName } from "./filetype.js";

/** What makes two viewer tabs the same: machine, path and diff kind (not the space). */
export function viewerKey({ path, on = null, diff = null }) {
  return `${on ?? ""}|${path}|${diff ? (diff.commit ? `commit:${diff.commit}` : diff.staged ? "staged" : "diff") : ""}`;
}

const tabExists = (id) => spaces().some((s) => s.tabs.some((t) => t.id === id));
const tabIds = (space) => new Set((spaces().find((s) => s.id === space)?.tabs ?? []).map((t) => t.id));

/**
 * @param cx the caller's context (used to learn the new tab's id)
 * @param o { path, on?, line?, diff?: { repo, staged }, space?, focus? }
 */
export function openInViewer(cx, { path, on = null, line = null, diff = null, space = null, focus = true }) {
  const sp = space ?? spaces().find((s) => s.active)?.id;
  const key = viewerKey({ path, on, diff });
  const slot = `${sp}::${key}`;
  const known = shared("viewer.open")?.[slot];
  if (known && tabExists(known)) {
    if (focus) run("tab.select", { id: known });
    if (line) setShared("viewer.goto", { key, line, at: Date.now() });
    return;
  }
  const before = tabIds(sp);
  run("tab.new", {
    name: (diff ? (diff.commit ? `Δ ${diff.commit.slice(0, 7)} ` : "Δ ") : "") + baseName(path),
    space: sp, mod: "cria-file-preview", focus,
    props: { file: path, on, line, diff },
  });
  // run() returns nothing, so the new tab is found by what appeared (spec 001 S3).
  cx.spawn(async (cx) => {
    for (let i = 0; i < 40; i++) {
      await cx.sleep(50);
      const fresh = [...tabIds(sp)].find((id) => !before.has(id));
      if (!fresh) continue;
      const open = {};
      for (const [k, v] of Object.entries(shared("viewer.open") ?? {})) if (tabExists(v)) open[k] = v;
      open[slot] = fresh;
      setShared("viewer.open", open);
      return;
    }
  });
}
