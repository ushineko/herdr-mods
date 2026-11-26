// How full an agent's context window is, for the chat's message bar. Pure: no
// herdr imports.

// Claude models' windows, as Claude Code 2.1.311 has them: the current families are
// natively 1M; older ones 200k (1M only with the "[1m]" suffix).
const CLAUDE_1M = /^claude-(?:(?:opus|sonnet|haiku)-5|fable-5|opus-4-[78])(?:\b|-)/;
const CLAUDE_200K = /^claude-(?:opus-4|sonnet-4|haiku-4|3)/;

/** A Claude model's context window in tokens, or null when it isn't known. */
export function claudeWindow(model) {
  const m = String(model ?? "").toLowerCase();
  if (/\[1m\]/.test(m)) return 1_000_000;
  if (CLAUDE_1M.test(m)) return 1_000_000;
  if (CLAUDE_200K.test(m)) return 200_000;
  return null;
}

const short = (n) => n >= 1e6 ? `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

/**
 * The meter for `context` ({ used, window } from the log) of `model`:
 * { text, percent, level } with level "ok", "high" (70 %+) or "full" (90 %+), or
 * null when nothing is known. Without a window it shows the tokens alone.
 */
export function contextMeter(context, model) {
  const used = context?.used;
  if (!(used > 0)) return null;
  const window = context.window ?? claudeWindow(model);
  if (!window) return { text: `${short(used)} tokens`, percent: null, level: "ok" };
  const percent = Math.min(100, Math.round((100 * used) / window));
  return { text: `${percent}% · ${short(used)} / ${short(window)}`, percent, level: percent >= 90 ? "full" : percent >= 70 ? "high" : "ok" };
}
