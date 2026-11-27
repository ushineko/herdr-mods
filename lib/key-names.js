// Key bindings as a person reads them (spec 020): the key bound to an action,
// written the way the platform writes it, and the dock buttons' tooltips.

const MAC = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
const NAME = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", cmd: "Super" };

// The key bound to `action` among `bindings` ([{ keys, action, args? }], as
// keys.json is read back), as `platform` writes it: "⌘⇧Y" on macOS,
// "Ctrl+Shift+Y" elsewhere; null when nothing is bound. `action` is whole
// ("layout.toggle:dock-right"); a binding may carry it whole or as the action
// with the id in its args.
export function keyFor(bindings, action, platform) {
  const [cmd, arg] = action.split(":");
  const k = (bindings ?? []).find((b) => b.action === action || (b.action === cmd && (b.args?.id ?? b.args) === arg))?.keys;
  if (!k) return null;
  const parts = k.split("-");
  if (platform === "macos") return parts.map((x) => MAC[x] ?? x.toUpperCase()).join("");
  return parts.map((x) => NAME[x] ?? x.toUpperCase()).join("+");
}

const DOCK_WORD = { "dock-right": "right", "dock-bottom": "bottom" };

// A dock button's tooltip: what a click does, and its key when it has one.
export function dockTooltip(dock, shown, key) {
  const text = `${shown ? "Hide" : "Show"} the ${DOCK_WORD[dock] ?? dock} dock`;
  return key ? `${text} (${key})` : text;
}
