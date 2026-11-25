// Nested tabs: state and actions shared by the pane header, its menus and its
// rename dialog.
//
// Membership lives in herdr-core: every extra terminal in a pane's stack is a
// child of the pane's own terminal (so it belongs to the same tab, without a
// pane of its own, and ends when the pane does) and carries the label
// `nt.stack=<pane id>`. Tab order and the shown tab live in shared state, so
// every copy of this mod sees the same thing. The pane header applies the shown
// tab with terminal.show.

import { shared, setShared, terminals, panes, run, hc, home, notify } from "herdr";

const KEY = "nested-tabs.v1";
export const LABEL = "nt.stack";
export const TITLE = "nt.title";

function store() {
  const s = shared(KEY);
  return s && typeof s === "object" && s.panes ? s : { panes: {} };
}

export function paneState(pane) {
  const p = store().panes[pane];
  return { order: Array.isArray(p?.order) ? p.order : [], shown: p?.shown ?? null };
}

function setPane(pane, next) {
  const s = store();
  setShared(KEY, { ...s, panes: { ...s.panes, [pane]: next } });
}

// Forget panes that no longer exist and have no stacked terminals left.
export function prune() {
  const s = store();
  const known = new Set(panes().map((p) => p.pane));
  if (!known.size) return;
  const stacked = new Set(terminals().filter((t) => t.labels?.[LABEL]).map((t) => t.labels[LABEL]));
  const keep = Object.fromEntries(Object.entries(s.panes).filter(([id]) => known.has(id) || stacked.has(id)));
  if (Object.keys(keep).length !== Object.keys(s.panes).length) setShared(KEY, { ...s, panes: keep });
}

const live = (t) => t && t.state === "live";

// The pane's tabs in order: its own terminal plus every live labelled child.
export function members(pane, base) {
  const all = terminals();
  const byAddr = new Map(all.map((t) => [t.address, t]));
  const present = [base, ...all.filter((t) => live(t) && t.labels?.[LABEL] === pane && t.address !== base).map((t) => t.address)];
  const set = new Set(present);
  const order = paneState(pane).order.filter((a) => set.has(a));
  for (const a of present) if (!order.includes(a)) order.push(a);
  return order.map((a) => ({ address: a, base: a === base, term: byAddr.get(a) ?? null }));
}

// The address the pane should show: a live member, else its own terminal.
export function shownOf(pane, base) {
  const want = paneState(pane).shown;
  if (!want || want === base) return base;
  return members(pane, base).some((m) => m.address === want) ? want : base;
}

export function label(m, paneTitle) {
  const t = m.term;
  const custom = t?.labels?.[TITLE];
  if (custom) return custom;
  if (m.base && paneTitle) return paneTitle;
  return t?.title || t?.program?.name || t?.argv?.[0] || m.address;
}

function apply(pane, base, addr) {
  run("terminal.show", addr && addr !== base ? { terminal: addr, pane } : { pane });
}

export function select(pane, base, addr) {
  setPane(pane, { order: members(pane, base).map((m) => m.address), shown: addr === base ? null : addr });
  apply(pane, base, addr);
  run("pane.focus", { pane });
}

export function cycle(pane, base, step) {
  const list = members(pane, base);
  if (list.length < 2) return;
  const at = list.findIndex((m) => m.address === shownOf(pane, base));
  select(pane, base, list[(at + step + list.length) % list.length].address);
}

export function reorder(pane, base, from, to) {
  const order = members(pane, base).map((m) => m.address);
  const i = order.indexOf(from), j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  order.splice(i, 1);
  order.splice(j, 0, from);
  setPane(pane, { ...paneState(pane), order });
}

export function move(pane, base, addr, step) {
  const order = members(pane, base).map((m) => m.address);
  const i = order.indexOf(addr), j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  setPane(pane, { ...paneState(pane), order });
}

// The folder a new tab starts in: the shown tab's, else the pane's. On
// another machine there is no local fallback (null: hc starts it in that
// machine's home).
function cwdOf(pane, base) {
  const shown = terminals().find((t) => t.address === shownOf(pane, base));
  const cwd = shown?.cwd || panes().find((p) => p.pane === pane)?.cwd;
  return cwd || (base.includes("/") ? null : home());
}

// A remote terminal's address is "<machine>/<id>"; hc runs a child there with
// `--on <machine> --parent <id>` and reports it back as "<machine>/<id>".
function where(base) {
  const i = base.indexOf("/");
  return i < 0 ? { on: null, id: base } : { on: base.slice(0, i), id: base.slice(i + 1) };
}

function fail(title, r) {
  notify({ title, body: (r?.stderr || r?.stdout || String(r ?? "")).trim().slice(0, 300), level: "error" });
}

// A new tab: a shell in the shown tab's folder (or opts.cwd). With `command`,
// it is typed into that shell, the way Herdr starts agents, so the shell stays
// afterwards unless the command ends with `exit`. opts.show === false adds it
// behind the shown tab without switching to it.
export async function add(pane, base, command, opts = {}) {
  const show = opts.show !== false;
  const { on, id } = where(base);
  const cwd = opts.cwd || cwdOf(pane, base);
  let r;
  try {
    r = await hc(["run", "--bg", "--json", ...(on ? ["--on", on] : []), "--parent", id,
      "--no-notify", "--rm", "--keep", "--label", `${LABEL}=${pane}`, ...(cwd ? ["--cwd", cwd] : [])]);
  } catch (e) { return fail("New nested tab failed", e); }
  if (r.code !== 0) return fail("New nested tab failed", r);
  let addr;
  try { addr = JSON.parse(r.stdout).address; } catch { return fail("New nested tab: unexpected reply", r); }
  // Put it right after the tab that was showing.
  const order = members(pane, base).map((m) => m.address).filter((a) => a !== addr);
  order.splice(order.indexOf(shownOf(pane, base)) + 1, 0, addr);
  if (show) {
    setPane(pane, { order, shown: addr });
    apply(pane, base, addr);
    run("pane.focus", { pane });
  } else {
    setPane(pane, { ...paneState(pane), order });
  }
  if (command) await hc(["send", addr, command]);
  return addr;
}

export async function rename(addr, text) {
  const r = await hc(["label", addr, `${TITLE}=${text.trim()}`]);
  if (r.code !== 0) fail("Rename failed", r);
}

// Close one tab. The pane's own terminal can't leave its pane, so closing it
// closes the pane and, with it, the whole stack.
export async function close(pane, base, addr) {
  if (addr === base) { run("pane.close", { pane }); return; }
  const list = members(pane, base);
  const st = paneState(pane);
  const order = list.map((m) => m.address).filter((a) => a !== addr);
  let shown = st.shown;
  if (shownOf(pane, base) === addr) {
    const i = list.findIndex((m) => m.address === addr);
    const next = list[i + 1]?.address ?? list[i - 1]?.address ?? base;
    shown = next === base ? null : next;
    apply(pane, base, next);
  }
  setPane(pane, { order, shown });
  const r = await hc(["kill", addr]);
  if (r.code !== 0) fail("Close nested tab failed", r);
}

export async function closeOthers(pane, base, keepAddr) {
  for (const m of members(pane, base)) if (!m.base && m.address !== keepAddr) await close(pane, base, m.address);
  select(pane, base, keepAddr);
}

// Give a tab its own pane beside this one.
export async function popOut(pane, base, addr, place) {
  if (addr === base) return;
  if (shownOf(pane, base) === addr) apply(pane, base, base);
  const st = paneState(pane);
  setPane(pane, { order: st.order.filter((a) => a !== addr), shown: st.shown === addr ? null : st.shown });
  await hc(["label", addr, `${LABEL}=`]);
  run("terminal.keep", { terminal: addr, place: place ?? "right" });
}
