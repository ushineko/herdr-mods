// A machine's own colour, so its spaces read as that machine wherever the window
// shows them: the spaces bar's chip and dropdown, the tab bar's and the dock's
// machine pills. From a palette that keeps clear of the theme's accent blue, which
// stays this computer's. Pure.
export const MACHINE_COLORS = ["#2dd4bf", "#f59e0b", "#a78bfa", "#f472b6", "#a3e635", "#fb923c", "#22d3ee", "#f87171"];

const hash = (s) => {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};

/**
 * The colour (#rrggbb) for machine `name` among the machines this window knows of
 * (`known`, e.g. every space's machine): each takes its name's colour, or, when an
 * earlier one (by name) has it, the next free one, so the window's machines never
 * share a colour while there are colours left. Null for this computer (no name).
 */
export function machineColor(name, known = []) {
  if (!name) return null;
  const names = [...new Set([...known.filter(Boolean), name])].sort();
  const taken = new Map();
  for (const n of names) {
    let i = hash(n) % MACHINE_COLORS.length;
    for (let k = 0; k < MACHINE_COLORS.length && [...taken.values()].includes(i); k++) i = (i + 1) % MACHINE_COLORS.length;
    taken.set(n, i);
  }
  return MACHINE_COLORS[taken.get(name)];
}
