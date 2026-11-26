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

/**
 * The herdr-core session a window's app home belongs to, by this setup's naming:
 * `~/.config/herdr-app` is "default", `~/.config/herdr-app-<name>` is "<name>".
 */
export function sessionOfHome(home) {
  const m = /[\\/]herdr-app(?:-([^\\/]+))?[\\/]*$/.exec(String(home ?? ""));
  return m ? m[1] ?? "default" : null;
}

/** The app home of session `session` under `config` (e.g. ~/.config), the reverse. */
export const homeOfSession = (session, config) => `${String(config).replace(/[\\/]+$/, "")}/herdr-app${session === "default" ? "" : `-${session}`}`;

/**
 * The other windows on this computer, from the siblings script's output (lines of
 * JSON: { session, home, agents: [hc get, ...] }): [{ session, home, title, agents }],
 * each agent as a row (inboxRow) with its address, status, and `steps`, the app
 * commands that show it in that window (showSteps); idle ones left out.
 */
export function parseSiblings(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    let s;
    try { s = JSON.parse(line); } catch { continue; }
    if (!s?.session) continue;
    const agents = (s.agents ?? [])
      .map((g) => ({ g, status: g?.status?.state === "error" ? "blocked" : g?.status?.state }))
      .filter(({ status }) => ["blocked", "done", "working"].includes(status))
      .map(({ g, status }) => ({
        address: g.address, status, where: g.where ?? null, steps: showSteps(g),
        // On a machine that window's core has added ("win11-kvm/t18"): its name.
        machine: String(g.address ?? "").includes("/") ? String(g.address).split("/")[0] : null,
        ...inboxRow({ status, title: g.name || g.status?.app || g.address, chat: Boolean(g.labels?.["ushi.chat"]) }, g),
      }));
    out.push({ session: s.session, home: s.home, title: `${s.session[0].toUpperCase()}${s.session.slice(1)} window`, agents });
  }
  return out;
}

/**
 * The app commands that show an agent terminal (hc get's shape) in its window:
 * [[command, args], ...]. An agent open as a chat (ushi.chat labels its chat pane,
 * chat.tab the chat's tab) is shown as its chat: its own terminal sits hidden in a
 * tab of its own, which agent.focus would show for a moment. Others: agent.focus.
 */
export function showSteps(term) {
  const l = term?.labels ?? {};
  if (l["ushi.chat"] && l["chat.tab"]) {
    return [
      ...(l["herdr.space"] ? [["space.select", { id: l["herdr.space"] }]] : []),
      ["tab.select", { id: l["chat.tab"] }],
      ["pane.focus", { pane: l["ushi.chat"] }],
    ];
  }
  return [["agent.focus", { terminal: term?.address }]];
}
