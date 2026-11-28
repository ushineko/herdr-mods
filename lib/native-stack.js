// Native nested tabs (spec 023; the app fork's spec 001): what the strip shows,
// from `panes()` entries. Pure: plain data in and out.
//
// A fork window's `panes()` gives every member of a stack `stack: { id, index,
// shown }` (null outside a stack); a released window's entries have no `stack`
// key at all.

/** Whether the app has native stacks: its `panes()` entries carry a `stack` key. */
export const isNative = (entry) => Boolean(entry) && Object.prototype.hasOwnProperty.call(entry, "stack");

/** The members of pane `pane`'s stack, in order ([] outside a stack). */
export function stackMembers(all, pane) {
  const me = (all ?? []).find((p) => p.pane === pane);
  if (!me?.stack) return [];
  return all.filter((p) => p.stack?.id === me.stack.id).sort((a, b) => a.stack.index - b.stack.index);
}

/** The member this window shows (else the first). */
export const shownMember = (members) => members.find((m) => m.stack?.shown) ?? members[0] ?? null;

/** The member `step` places from the shown one, wrapping; null with fewer than two. */
export function stepMember(members, step) {
  if (members.length < 2) return null;
  const at = Math.max(0, members.findIndex((m) => m.stack?.shown));
  return members[(((at + step) % members.length) + members.length) % members.length];
}

/**
 * A chat member and its agent's member, drawn as one split chip (spec 021 D2,
 * spec 023 D3): `chat` is the ushi-naruse member whose agent (the terminal
 * labelled `ushi.chat` with that chat's pane id) is also a member, `agent`
 * that member; `rest` the other members in order. No chat: chat and agent null.
 */
export function stripGroups(members, terminals) {
  const local = (id) => String(id ?? "").slice(String(id ?? "").lastIndexOf("/") + 1);
  for (const chat of members.filter((m) => m.mod === "ushi-naruse")) {
    const agent = members.find((m) => m.terminal && local((terminals ?? []).find((t) => t.address === m.terminal)?.labels?.["ushi.chat"]) === local(chat.pane));
    if (agent) return { chat, agent, rest: members.filter((m) => m !== chat && m !== agent) };
  }
  return { chat: null, agent: null, rest: members };
}
