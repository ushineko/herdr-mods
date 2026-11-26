// The top bar's inbox: which agents need the person, as the app's Agents sidebar
// sorts them, and what the button's indicator says. Pure: takes the agents (status
// blocked | done | working | idle) and returns plain data.

const SECTIONS = [["blocked", "Needs you"], ["done", "Done"], ["working", "Working"]];

/**
 * The dropdown's sections, in order, empty ones left out: [{ status, title, agents }].
 * Idle agents aren't listed (the inbox is what changed, not everything there is).
 * Within a section, by space then title.
 */
export function inboxSections(agents) {
  const by = (a, b) => String(a.spaceName ?? "").localeCompare(String(b.spaceName ?? "")) || String(a.title ?? "").localeCompare(String(b.title ?? ""));
  return SECTIONS
    .map(([status, title]) => ({ status, title, agents: (agents ?? []).filter((a) => a?.status === status).sort(by) }))
    .filter((s) => s.agents.length);
}

/**
 * The button's indicator: { kind: "needs", count } while any agent waits for input;
 * else { kind: "done", count } while any finished since it was looked at; else null.
 */
export function inboxBadge(agents) {
  const count = (s) => (agents ?? []).filter((a) => a?.status === s).length;
  if (count("blocked")) return { kind: "needs", count: count("blocked") };
  if (count("done")) return { kind: "done", count: count("done") };
  return null;
}

/**
 * What a row says about an agent, from its terminal (`term`, terminals()'s entry):
 * { title, project, doing }. The title is the conversation's (the terminal title an
 * agent sets), else the agent's name; the project is the folder its program works in
 * (the foreground's, else the terminal's), last part only; `doing` is what the agent
 * reports it is doing or asking, else a word for its state.
 */
const STATE_WORD = { blocked: "Waiting for you", done: "Finished", working: "Working…", idle: "Idle" };
export function inboxRow(agent, term) {
  const name = String(agent?.title ?? agent?.address ?? "Agent");
  const raw = String(term?.title ?? "").trim();
  // A title that only names the program or a folder says nothing about the work.
  const generic = !raw || /^[~/\\]|^[A-Za-z]:\\/.test(raw) || raw.toLowerCase() === String(agent?.program?.name ?? "").toLowerCase()
    || /^(claude|claude code|codex|pwsh|zsh|bash|sh|powershell)(\.exe)?$/i.test(raw);
  const title = generic ? name : agent?.chat ? `${raw} (chat)` : raw;
  const folder = String(term?.foreground?.cwd || term?.cwd || "").replace(/[\\/]+$/, "");
  const project = folder ? folder.split(/[\\/]/).pop() : null;
  const msg = String(term?.report?.msg ?? term?.status?.msg ?? "").trim();
  return { title, project: project || null, doing: msg || STATE_WORD[agent?.status] || "" };
}
