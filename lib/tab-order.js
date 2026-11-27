// The Ctrl+Tab switcher's order (spec 015): the tabs a window has shown, most recent
// first, each with what its row says. Pure: plain data in and out.

const MAX = 60;

/**
 * What a tab's row says, from the app's lists: { key, tab, space, machine, tabName,
 * spaceName, title, project, program }. The title is the tab's agent's conversation
 * (its terminal title) when it has one, else its first pane's title; a chat's agent
 * terminal (chat.tab=<tab>) counts for the chat's tab. The project is the folder its
 * program works in, last part only.
 */
export function tabEntry(tab, space, panes = [], terms = []) {
  const local = (id) => String(id ?? "").slice(String(id ?? "").lastIndexOf("/") + 1);
  const mine = panes.filter((p) => p.tab === tab.id);
  const byAddr = new Map(terms.map((t) => [t.address, t]));
  const chatAgent = terms.find((t) => t.labels?.["chat.tab"] && local(t.labels["chat.tab"]) === local(tab.id));
  const pane = mine.find((p) => p.focused) ?? mine[0];
  const term = chatAgent ?? (pane?.terminal ? byAddr.get(pane.terminal) : null);
  const folder = String(term?.foreground?.cwd || term?.cwd || pane?.cwd || "").replace(/[\\/]+$/, "");
  const title = String(term?.title || pane?.title || "").trim();
  const program = term?.program ?? pane?.program ?? null;
  return {
    key: tab.id, tab: tab.id, space: space.id, machine: space.machine ?? null,
    tabName: tab.name, spaceName: space.name,
    // A path or the terminal's own address ("t2d") says nothing: the program's name then.
    title: title && !/^[~/]/.test(title) && title !== term?.address && title !== local(term?.address) ? title : program?.name || tab.name,
    project: folder ? folder.split(/[\\/]/).pop() : null,
    program: program ? { name: program.name, icon: program.icon ?? null, tint: Boolean(program.tint) } : null,
    chat: Boolean(chatAgent) || mine.some((p) => p.mod === "ushi-naruse"),
  };
}

/** `order` with `entry` first, stamped `at`; at most MAX entries. */
export function recordTab(order, entry, at) {
  return [{ ...entry, at }, ...(order ?? []).filter((e) => e.key !== entry.key)].slice(0, MAX);
}

/**
 * The order for the tabs open now (`entries`, tabEntry's, in space and tab order):
 * recorded ones in their order with today's details, then the rest as they come,
 * so a window with nothing recorded yet starts from its tabs.
 */
export function liveOrder(order, entries) {
  const now = new Map(entries.map((e) => [e.key, e]));
  const seen = (order ?? []).filter((e) => now.has(e.key)).map((e) => ({ ...now.get(e.key), at: e.at }));
  const keys = new Set(seen.map((e) => e.key));
  return [...seen, ...entries.filter((e) => !keys.has(e.key)).map((e) => ({ ...e, at: 0 }))];
}

/**
 * One list for the switcher: this window's tabs (`own`, liveOrder's: the shown one
 * first) and the other windows' recorded ones (`others`: [{ window, order }]), by
 * when they were last shown; this window's shown tab stays first.
 */
export function switcherList(own, others = []) {
  const [shown, ...rest] = own;
  const theirs = others.flatMap((o) => (o.order ?? []).map((e) => ({ ...e, window: o.window })));
  return [...(shown ? [shown] : []), ...[...rest, ...theirs].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))];
}
