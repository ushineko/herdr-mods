// The chat's right-click menu (spec 008 R14): which entries a message, reply or tool
// call offers, and the text they copy or quote. Pure: no herdr imports.

/** Markdown to plain text: formatting marks go, words, code and line breaks stay. */
export function plainText(md) {
  const out = [];
  let fence = false;
  for (const line of String(md ?? "").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) { out.push(line); continue; }
    out.push(line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?!\w)/g, "$1$2")
      .replace(/(^|\W)_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** `text` as a Markdown quote, ready to type under. */
export function quote(text) {
  return String(text ?? "").trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") + "\n\n";
}

/**
 * The command a tool call ran, for Copy command: a shell tool's command (Claude's
 * Bash `command`, Codex's `cmd`, as a string or an argv), else its input as JSON.
 */
export function commandOf(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  const c = input.command ?? input.cmd;
  if (Array.isArray(c)) return c.join(" ");
  if (typeof c === "string") return c;
  return JSON.stringify(input, null, 2);
}

/**
 * The menu for a right-clicked `target`: [{ id, label } | { sep: true }]. Targets:
 * { kind: "user" | "assistant", text }, { kind: "tool", item }, { kind: "tools", items }.
 * `selection`: text selected in the chat, offered first.
 */
export function menuFor(target, { selection = null, side = true } = {}) {
  const items = [];
  if (selection) items.push({ id: "copy-selection", label: "Copy selection" }, { sep: true });
  switch (target?.kind) {
    case "user":
      items.push({ id: "copy", label: "Copy" }, { id: "edit", label: "Edit and send again" });
      break;
    case "assistant":
      items.push({ id: "copy", label: "Copy reply" }, { id: "copy-plain", label: "Copy as plain text" },
        { sep: true }, { id: "quote", label: "Quote in message box" });
      if (side) items.push({ id: "ask-side", label: "Ask about this in side chat" });
      break;
    case "tool":
      items.push({ id: "copy-command", label: "Copy command" });
      if (target.item?.result) items.push({ id: "copy-output", label: "Copy output" });
      items.push({ sep: true }, { id: "show-terminal", label: "Show in terminal" });
      break;
    case "tools":
      items.push({ id: "copy-command", label: (target.items?.length ?? 0) > 1 ? "Copy commands" : "Copy command" },
        { sep: true }, { id: "show-terminal", label: "Show in terminal" });
      break;
    default:
      break;
  }
  while (items.length && items[items.length - 1].sep) items.pop();
  return items;
}

/**
 * A user message as Claude Code logs it, without the tags it wraps pasted text in:
 * `<pasted_content id="b483">` … `</pasted_content id="b483">` (the closing tag
 * carries the id too). The pasted text stays where it was.
 */
export function unwrapPastes(text) {
  return String(text ?? "").replace(/<\/?pasted_content\b[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Markdown with every line break inside a paragraph kept, as Claude Code's terminal
 * shows it: Markdown joins lines not separated by a blank line ("1 — a\n2 — b"
 * became one line). Each such break becomes a hard break (two trailing spaces);
 * code blocks are left alone.
 */
export function keepLineBreaks(md) {
  const lines = String(md ?? "").split("\n");
  let fence = null;
  return lines.map((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) { fence = fence ? (f[1][0] === fence[0] ? null : fence) : f[1]; return line; }
    if (fence) return line;
    const next = lines[i + 1];
    const nextFence = next != null && /^\s*(```+|~~~+)/.test(next);
    return line.trim() && next?.trim() && !nextFence && !/( {2}|\\)$/.test(line) ? line + "  " : line;
  }).join("\n");
}
