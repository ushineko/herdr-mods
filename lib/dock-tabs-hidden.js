// Each dock chooses its subtabs (spec 019): one set of subtab names, and per dock
// a list of the ones it hides, the fixed nav + git subtab ("panels") among them.
// Pure: no herdr import. The state is shared("dock-tabs.hidden"):
// { "dock-bottom": [names], "dock-right": [names] }.

/** The fixed subtab's name in a hidden list. */
export const FIXED = "panels";

const clean = (state) => (state && typeof state === "object" ? state : {});
const list = (state, dock) => (Array.isArray(clean(state)[dock]) ? clean(state)[dock].filter((n) => typeof n === "string") : []);

/** The names dock `dock` hides. */
export const hiddenIn = (state, dock) => [...list(state, dock)];

/** True when `dock` hides `name`. */
export const isHidden = (state, dock, name) => list(state, dock).includes(name);

/**
 * Hide `name` in `dock`. Refused (ok: false, the state unchanged) unless the
 * subtab is shown elsewhere: a subtab is shown in at least one dock.
 */
export function hide(state, dock, name, shownElsewhere) {
  if (!shownElsewhere || isHidden(state, dock, name)) return { state: clean(state), ok: Boolean(shownElsewhere) && isHidden(state, dock, name) };
  return { state: { ...clean(state), [dock]: [...list(state, dock), name] }, ok: true };
}

/** Show `name` in `dock` again. */
export function show(state, dock, name) {
  return { ...clean(state), [dock]: list(state, dock).filter((n) => n !== name) };
}

/** Move `name` from one dock to the other: shown there, hidden here. Never refused. */
export function moveTo(state, from, to, name) {
  const shown = show(state, to, name);
  return { ...shown, [from]: [...list(shown, from).filter((n) => n !== name), name] };
}

/** Forget `name` everywhere: a closed subtab. */
export function forget(state, name) {
  const out = {};
  for (const [dock, names] of Object.entries(clean(state))) out[dock] = (Array.isArray(names) ? names : []).filter((n) => n !== name);
  return out;
}

/**
 * What `dock` shows of `names` (the subtab names, without the fixed one):
 * { fixed, names }. The fixed subtab shows unless hidden; a dock that would
 * show nothing shows it anyway, so a dock is never empty.
 */
export function visibleNames(names, state, dock) {
  const shown = (names ?? []).filter((n) => !isHidden(state, dock, n));
  const fixed = !isHidden(state, dock, FIXED) || shown.length === 0;
  return { fixed, names: shown };
}

/** The other dock of the pair. */
export const otherDock = (dock) => (dock === "dock-bottom" ? "dock-right" : "dock-bottom");
