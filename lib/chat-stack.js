// A chat as a nested tab (spec 021): a chat's tab (C) and its hidden partner tab (P),
// which holds the agent's pane and its nested terminals, drawn as one strip. Pure:
// plain data in and out.

// The machine part of an address ("njv-cachyos-default/" or "").
const machinePart = (id) => (String(id).includes("/") ? String(id).slice(0, String(id).lastIndexOf("/") + 1) : "");

/**
 * The chat pairs among `terminals` (terminals()' entries): a Map from P's tab id to
 * { chat: C's tab id, terminal: the agent's address }, ids as this window names them.
 * An agent is paired while a chat owns it (ushi.chat) and its terminal is away from
 * the chat's tab (chat.tab) in a tab of its own (herdr.tab).
 */
export function chatPairs(terminals) {
  const out = new Map();
  for (const t of terminals ?? []) {
    const l = t?.labels ?? {};
    if (t?.state && t.state !== "live") continue;
    if (!l["ushi.chat"] || !l["chat.tab"] || !l["herdr.tab"] || l["herdr.tab"] === l["chat.tab"]) continue;
    const m = machinePart(t.address);
    out.set(m + l["herdr.tab"], { chat: m + l["chat.tab"], terminal: t.address });
  }
  return out;
}

/**
 * The strip's entries: the chat first, then the stack's terminals (`members`, in the
 * stack's order: [{ address, base }]). `side` is the side shown ("chat" or "term"),
 * `shown` the terminal the pane shows; exactly one entry is active.
 */
export function stripEntries(members, side, shown) {
  return [
    { kind: "chat", active: side === "chat" },
    ...(members ?? []).map((m) => ({ kind: "terminal", address: m.address, base: Boolean(m.base), active: side !== "chat" && m.address === shown })),
  ];
}

/** The entry `step` places from the active one (wrapping), or null with fewer than two. */
export function stepEntry(entries, step) {
  const list = entries ?? [];
  if (list.length < 2) return null;
  const at = Math.max(0, list.findIndex((e) => e.active));
  return list[(((at + step) % list.length) + list.length) % list.length];
}

/**
 * Where tab `id` goes when moved `by` (-1 left, 1 right) among the tabs a person sees:
 * the position (`index`, from 1, counting every tab) of the visible tab it passes, so
 * a move never just swaps with a hidden (settled) tab or a chat's partner tab
 * (`hidden`, ids). Wraps at the ends, as tab.move {by} does; null when there's
 * nowhere to go.
 */
export function moveIndex(tabs, id, by, hidden) {
  const seen = (tabs ?? []).filter((t) => t.id === id || !(t.settled || hidden?.has(t.id)));
  const at = seen.findIndex((t) => t.id === id);
  if (at < 0 || seen.length < 2) return null;
  return seen[(((at + by) % seen.length) + seen.length) % seen.length].index;
}
