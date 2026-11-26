// Horizontal spaces bar: a port of the herdr TUI fork's spaces bar
// (ushineko/specs/000-spaces-bar.md) to the Herdr app.
//
// Spaces on another machine fold into one chip per machine, where its first
// space is: "<machine> ▾ <count>", or "<machine>: <space>" while one of its
// spaces is shown, with the worst agent state across them. Clicking it opens
// a dropdown of that machine's spaces; hovering one cascades its agents to
// the side (click to focus). Local spaces keep a chip each.
//
// One chip per space: number (1-9), rolled-up state glyph, name (truncated),
// and a folded agent rollup (at most 3 state classes, most urgent first, with a
// count when more than one agent shares a state). Nested-tab agents count too.
// Click a chip to switch space; right-click for the space menu; click the
// rollup to focus the space's single agent or pick among several. The wheel
// scrolls the strip; the shown space is always scrolled into view.
//
// Props: none for the bar; { picker: <space id> } for the agent picker popup;
// { group: <machine> } for a machine's dropdown; { machines: true } for the
// "new space on…" menu.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, terminals, run, theme, props, openOverlay, closeOverlay, hc, exec, home, appHome, shared, setShared, window as win } from "herdr";
import { allAgents, worst, focusAgent, ORDER, RANK } from "./agents.js";
import { machineColor } from "./lib/machine-color.js";
import { inboxSections, inboxBadge, inboxRow, sessionOfHome, homeOfSession, parseSiblings } from "./lib/inbox.js";

// The other windows on this computer (another herdr-core session with its window
// open: njv-cachyos's default and work) and their agents, for the inbox: its own and
// those on the machines its core has added (so a window whose core has none still
// hears of them). One JSON line per window: { session, home, agents: [hc get, ...] },
// agents that aren't idle only. A session is asked only when its core's socket and its window's are there:
// asking hc about a session that isn't running would start a core for it. POSIX.
const SIBLINGS = String.raw`
import glob, json, os, subprocess, sys
own, config = sys.argv[1], sys.argv[2]
hc = os.path.expanduser("~/.local/bin/hc")
if not os.path.exists(hc): hc = "hc"
for sock in sorted(glob.glob("/run/user/%d/herdr-core/*.sock" % os.getuid())):
    name = os.path.basename(sock)[:-5]
    if ".holder." in name or name == own: continue
    home = os.path.join(config, "herdr-app" if name == "default" else "herdr-app-" + name)
    if not os.path.exists(os.path.join(home, "herdr-app.sock")): continue
    env = dict(os.environ, HC_SESSION=name)
    run = lambda *a: subprocess.run([hc, *a, "--json"], env=env, capture_output=True, text=True, timeout=8).stdout
    try: terms = json.loads(run("ls")).get("terminals", [])
    except Exception: continue
    agents = []
    for t in terms:
        if t.get("status") not in ("blocked", "done", "working", "error"): continue
        try: agents.append(json.loads(run("get", t["address"])))
        except Exception: pass
    print(json.dumps({"session": name, "home": home, "agents": agents}))
`;

// A machine's colour among the machines this window shows (lib/machine-color.js).
const colorOf = (machine) => machineColor(machine, spaces().map((s) => s.machine));

const ICON = (n) => `mods/spaces-bar/${n}.svg`;
// The other windows on this computer and their agents (see SIBLINGS). Shared state
// belongs to this window's app home, so each window keeps its own list.
const SIBLINGS_KEY = "spaces-bar.siblings";
// Agents on a machine this window has added itself are left out: its own inbox has them.
const siblings = () => {
  const mine = new Set(spaces().map((s) => s.machine).filter(Boolean));
  const list = Array.isArray(shared(SIBLINGS_KEY)) ? shared(SIBLINGS_KEY) : [];
  return list.map((w) => ({ ...w, agents: w.agents.filter((a) => !a.machine || !mine.has(a.machine)) }));
};
// Runs the app commands in $2 (lines "<command> <json args>", lib/inbox.js showSteps)
// in the window of app home $1 (session $3), in order, and raises that window.
const RAISE = String.raw`H=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app")
printf '%s
' "$2" | while read -r cmd args; do HERDR_APP_HOME="$1" "$H" do "$cmd" "$args" >/dev/null 2>&1; done
L=$(command -v herdr-app-session || echo "$HOME/.local/bin/herdr-app-session")
if [ -x "$L" ]; then HERDR_APP_HOME="$1" HC_SESSION="$3" nohup "$L" "$3" >/dev/null 2>&1 &
else HERDR_APP_HOME="$1" HC_SESSION="$3" nohup "$H" >/dev/null 2>&1 &
fi`;
// Text on a machine's filled chip: dark, as every machine colour is light.
const ON_COLOR = "#0b0d10";
const GLYPH = { blocked: "✕", done: "✓", idle: "○" };

// A machine's dropdown: row and header heights, panel widths.
const ROW = 31, HEAD = 26, SPACES_W = 300, AGENTS_W = 336;
// Tall enough for the spaces list and, beside any of them, its agents list.
function groupHeight(list, agents) {
  let h = 12 + HEAD + ROW * list.length;
  list.forEach((s, k) => {
    const n = agents.filter((a) => a.space === s.id).length;
    if (n) h = Math.max(h, 12 + k * ROW + HEAD + ROW * n);
  });
  return h + 4;
}

// A control in a window_drag block: its presses are its own.
function own(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

function glyph(t, status, size = 12) {
  if (!status) return null;
  if (status === "working") return svg(ICON("spinner")).size(size).flex_none().text_color(t.working).spin(900);
  return div().flex_none().text_size(size).text_color(t[status] ?? t.dim).child(GLYPH[status] ?? "·");
}

function programIcon(p, color) {
  // A chat's agent (spec 008) shows as its chat: the cow.
  if (p?.chat) return svg("mods/spaces-bar/cow.svg").size(14).flex_none().text_color(color);
  const g = p?.program;
  if (!g?.icon) return null;
  return g.tint ? svg(g.icon).size(14).flex_none().text_color(color) : image(g.icon).w(14).h(14).flex_none();
}

export default class SpacesBar extends View {
  init(_props, cx) {
    if (props()?.picker || props()?.machines || props()?.group || props()?.inbox) {
      this.at = 0;
      this.handle = cx.focus_handle();
      this.handle.focus();
      if (props()?.machines) {
        // "This computer" first, then every connected machine (as the shipped picker lists them).
        this.machineList = [null];
        cx.spawn(async (cx) => {
          try {
            const r = await hc(["machine", "ls", "--json"]);
            if (r.code === 0) {
              const ms = JSON.parse(r.stdout).machines ?? [];
              this.machineList = [null, ...ms.filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name)];
            }
          } catch {}
          cx.notify();
        });
      }
      return;
    }
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    this.view = 0;
    this.wheelAcc = 0;
    // The other windows' agents (SIBLINGS), every 5 s, kept in shared state so the
    // inbox's dropdown (another copy of this mod) reads the same list.
    if (win()?.platform !== "windows") cx.spawn(async (cx) => {
      for (;;) {
        const own = sessionOfHome(appHome());
        if (own) {
          const r = await exec("python3", ["-c", SIBLINGS, own, `${home()}/.config`], { timeout: 20000 }).catch(() => null);
          const list = r?.code === 0 ? parseSiblings(r.stdout) : [];
          if (JSON.stringify(list) !== JSON.stringify(shared(SIBLINGS_KEY) ?? [])) setShared(SIBLINGS_KEY, list);
        }
        await cx.sleep(5000);
      }
    });
  }

  // ---- bar ------------------------------------------------------------------

  rollup(t, s, mine) {
    if (!mine.length) return null;
    const counts = new Map();
    for (const a of mine) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    const classes = ORDER.filter((st) => counts.has(st)).slice(0, 3);
    return own(h_flex())
      .id(`sb-roll-${s.id}`)
      .flex_none()
      .gap(5)
      .px(5)
      .h(20)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .tooltip(mine.length === 1 ? `Focus ${mine[0].title}` : `${mine.length} agents: pick one`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (mine.length === 1) focusAgent(mine[0]);
        else openOverlay({ mod: "spaces-bar", kind: "popup", width: 340, props: { picker: s.id } });
      })
      .children(classes.map((st) =>
        h_flex().gap(2).items_center()
          .child(glyph(t, st, 11))
          .when(counts.get(st) > 1, (el) => el.child(div().text_size(11).text_color(t.muted).child(String(counts.get(st)))))));
  }

  chip(t, s, i, mine) {
    const state = worst(mine) ?? s.status;
    const roll = this.rollup(t, s, mine);
    return own(h_flex())
      .id(`sb-${s.id}`)
      .flex_none()
      .h(28)
      .pl(8)
      .pr(roll ? 3 : 10)
      .gap(6)
      .items_center()
      .rounded(9)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      .when(s.active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!s.active, (el) => el.border_color("#00000000").text_color(t.muted).hover((x) => x.bg(t.hover)))
      .tooltip(`${s.name}${s.branch ? " · " + s.branch : ""}${s.machine ? " · " + s.machine : ""}`)
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: s.id } } });
      })
      .when(i < 9, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(i + 1))))
      .when(Boolean(state), (el) => el.child(glyph(t, state)))
      .child(div().flex_none().max_w(160).truncate().child(s.name))
      .when(Boolean(roll), (el) => el.child(roll));
  }

  // The bar's chips in order: this computer's spaces first, a chip each, then one
  // per other machine (in the order their first spaces come), so local and remote
  // are two zones. [{ space, index } | { machine, spaces }]
  items(list) {
    const local = [], groups = [], seen = new Map();
    list.forEach((s, i) => {
      if (!s.machine) { local.push({ space: s, index: i }); return; }
      let g = seen.get(s.machine);
      if (!g) { g = { machine: s.machine, spaces: [] }; seen.set(s.machine, g); groups.push(g); }
      g.spaces.push(s);
    });
    return [...local, ...groups];
  }

  groupChip(t, g, agents) {
    const shown = g.spaces.find((s) => s.active);
    const c = colorOf(g.machine) ?? t.accent;
    const ids = new Set(g.spaces.map((s) => s.id));
    const mine = agents.filter((a) => ids.has(a.space));
    const state = worst(mine) ?? worst(g.spaces.map((s) => ({ status: s.status })));
    return own(h_flex())
      .id(`sb-g-${g.machine}`)
      .flex_none()
      .h(28)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(9)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      // The machine's own colour: a tint, or filled while one of its spaces is shown.
      .when(Boolean(shown), (el) => el.bg(c + "e6").border_color(c).text_color(ON_COLOR).font_semibold())
      .when(!shown, (el) => el.bg(c + "1f").border_color(c + "40").text_color(t.muted).hover((x) => x.bg(c + "38").text_color(t.foreground)))
      .tooltip(`${g.machine}: ${g.spaces.length} space${g.spaces.length > 1 ? "s" : ""}`)
      .on_click(() => openOverlay({
        mod: "spaces-bar", kind: "popup", frame: "none", width: 640,
        height: groupHeight(g.spaces, agents), props: { group: g.machine },
      }))
      .child(svg(ICON("server")).size(12).flex_none().text_color(shown ? ON_COLOR : c))
      .when(Boolean(state), (el) => el.child(glyph(t, state)))
      .child(div().flex_none().max_w(260).truncate().child(shown ? `${g.machine}: ${shown.name}` : g.machine))
      .when(!shown, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(g.spaces.length))))
      .child(div().flex_none().text_size(10).text_color(shown ? ON_COLOR : t.dim).child("▾"));
  }

  onWheel(e, count) {
    const lines = e.delta_lines;
    this.wheelAcc += lines ? (lines.y || lines.x) : (e.delta.y || e.delta.x) / 40;
    let moved = false;
    while (this.wheelAcc >= 1) { this.view = Math.max(0, this.view - 1); this.wheelAcc -= 1; moved = true; }
    while (this.wheelAcc <= -1) { this.view = Math.min(count - 1, this.view + 1); this.wheelAcc += 1; moved = true; }
    if (moved) this.scroll.scroll_to_item(this.view);
  }

  renderBar() {
    const t = theme();
    const list = spaces();
    const agents = allAgents();
    const items = this.items(list);
    const active = items.findIndex((it) => (it.space ? it.space.active : it.spaces.some((s) => s.active)));
    // Reveal the shown space when it changes; a manual scroll owns the strip until then.
    if (active >= 0 && active !== this.revealed) {
      this.revealed = active;
      this.view = active;
      this.scroll.scroll_to_item(active);
    }
    return h_flex()
      .size_full()
      .gap(6)
      .items_center()
      // macOS: the window buttons (the layout's traffic_lights) sit at the
      // left of this, the top row; leave them room.
      .when(win()?.platform === "macos" && win()?.titlebar === "none" && !win()?.fullscreen, (el) => el.pl(72))
      .child(div()
        .id("sb-new")
        .flex_none()
        .p(6)
        .rounded(8)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((x) => x.bg(t.hover).text_color(t.foreground))
        .tooltip("New space (right-click: choose the machine)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "spaces-bar", kind: "popup", width: 260, props: { machines: true } });
        })
        .on_click(() => run("space.new", {}))
        .child(svg(ICON("plus")).size(15)))
      // The inbox next to +, close to the spaces and tabs (operator, 2026-11-26).
      .child(this.inboxButton(t, agents))
      .child(h_flex()
        .id("sb-strip")
        .flex_1()
        .min_w(0)
        .h_full()
        .gap(3)
        .items_center()
        .overflow_x_scroll()
        .track_scroll(this.scroll)
        .on_scroll_wheel((e) => this.onWheel(e, items.length))
        // Two zones: this computer's spaces (a monitor before the first, when there are
        // other machines too), then a divider and the other machines. The marks ride
        // with a chip, so the strip's children stay one per item (scroll_to_item).
        .children(items.map((it, k) => {
          const zoned = items.some((x) => !x.space) && items.some((x) => x.space);
          if (it.space) {
            const el = this.chip(t, it.space, it.index, agents.filter((a) => a.space === it.space.id));
            return zoned && k === 0
              ? h_flex().flex_none().gap(4).items_center().child(svg(ICON("monitor")).size(12).flex_none().text_color(t.dim)).child(el)
              : el;
          }
          const el = this.groupChip(t, it, agents);
          return zoned && !items[k - 1]?.machine
            ? h_flex().flex_none().gap(8).items_center().child(div().w(1).h(18).ml(5).bg(t.border)).child(el)
            : el;
        })));
  }

  // ---- inbox ------------------------------------------------------------------------
  // The app's Agents sidebar in short, for layouts without it: a button at the left
  // of the bar, after +, a red count while agents wait for input, else a dot while some
  // finished unseen; its dropdown lists Needs you, Done and Working on every machine.

  inboxButton(t, agents) {
    // This window's agents and the other windows' on this computer.
    const badge = inboxBadge([...agents, ...siblings().flatMap((w) => w.agents)]);
    const tip = badge?.kind === "needs" ? `${badge.count} agent${badge.count > 1 ? "s" : ""} waiting for you`
      : badge ? `${badge.count} agent${badge.count > 1 ? "s" : ""} finished` : "Inbox: nothing needs you";
    return own(div())
      .id("sb-inbox")
      .flex_none()
      .relative()
      .p(6)
      .rounded(8)
      .cursor_pointer()
      .text_color(badge?.kind === "needs" ? t.foreground : t.dim)
      .hover((x) => x.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click(() => openOverlay({ mod: "spaces-bar", kind: "popup", width: 560, props: { inbox: true } }))
      .child(svg(ICON("inbox")).size(16))
      .when(badge?.kind === "needs", (el) => el.child(div().absolute().top(0).right(-2).min_w(16).h(16).px(4).rounded_full()
        .bg(t.blocked).text_color("#ffffff").text_size(10.5).font_bold().flex().items_center().justify_center().child(String(badge.count))))
      .when(badge?.kind === "done", (el) => el.child(div().absolute().top(3).right(2).size(8).rounded_full().bg(t.done ?? t.accent)));
  }

  // Each agent with what its row says (lib/inbox.js inboxRow): the conversation, the
  // project, what it's doing or asking.
  inboxRows() {
    const byId = new Map(spaces().map((s) => [s.id, s]));
    const terms = new Map(terminals().map((x) => [x.address, x]));
    return inboxSections(allAgents().map((a) => ({
      ...a, ...inboxRow(a, terms.get(a.address)), spaceName: byId.get(a.space)?.name, machine: byId.get(a.space)?.machine ?? null,
    })));
  }

  renderInbox() {
    const t = theme();
    // This window's sections, then one per other window on this computer ("Work
    // window"), its agents most urgent first; their rows show the agent over there.
    const order = { blocked: 0, done: 1, working: 2 };
    const sections = [...this.inboxRows(), ...siblings().filter((w) => w.agents.length).map((w) => ({
      status: "window", title: w.title, window: w,
      agents: [...w.agents].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)).map((a) => ({ ...a, window: w })),
    }))];
    const flat = sections.flatMap((s) => s.agents);
    if (this.at >= flat.length) this.at = Math.max(0, flat.length - 1);
    let k = -1;
    return v_flex()
      .id("sb-inbox-list")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        const n = Math.max(1, flat.length);
        if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = (this.at - 1 + n) % n;
        else if (e.key === "enter") this.chooseInbox(flat[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .when(!flat.length, (el) => el.child(div().px(8).py(8).text_size(12).text_color(t.dim).child("Nothing needs you: no agent is waiting, finished or working.")))
      .children(sections.map((sec) => v_flex()
        .child(div().px(8).pt(6).pb(3).text_size(11).font_semibold().text_color(sec.status === "blocked" ? t.blocked : t.dim).child(sec.title.toUpperCase()))
        .children(sec.agents.map((a) => {
          const i = ++k;
          const mc = a.machine ? machineColor(a.machine, spaces().map((s) => s.machine)) : null;
          const tag = (text, color, bg) => div().flex_none().max_w(150).truncate().px(6).rounded(5).bg(bg).text_color(color).text_size(11).child(text);
          // Two lines: the conversation, its project and machine; then what it's doing
          // or asking (in the attention colour while it waits for you).
          return h_flex()
            .id(`sb-inbox-${i}`)
            .px(8)
            .py(6)
            .gap(8)
            .rounded(7)
            .items_start()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((x) => x.bg(t.hover))
            .on_click(() => this.chooseInbox(a))
            .child(div().pt(2).child(glyph(t, a.status)))
            .when(Boolean(programIcon(a, t.foreground)), (el) => el.child(div().pt(2).child(programIcon(a, t.foreground))))
            .child(v_flex().flex_1().min_w(0).gap(2)
              .child(h_flex().gap(6).items_center()
                .child(div().flex_1().min_w(0).truncate().font_medium().child(a.title))
                .when(Boolean(a.project), (el) => el.child(tag(a.project, t.muted, t.raised)))
                .when(Boolean(a.machine), (el) => el.child(tag(a.machine, mc, mc + "26"))))
              .child(div().truncate().text_size(11.5).text_color(a.status === "blocked" ? t.blocked : t.dim)
                .child(a.doing || a.spaceName || a.where || "")));
        }))));
  }

  // An inbox row: this window's agent is shown here; another window's is shown there
  // (its steps, lib/inbox.js showSteps: a chat's agent as its chat, through that
  // window's CLI), and that window raised: launching the app again
  // with an open window's home only raises it. Through njv-cachyos's session launcher
  // when there is one (each session runs its own copy of the app), with the session's
  // home and core.
  chooseInbox(a) {
    if (!a) return;
    if (!a.window) return this.choose(a);
    closeOverlay(props()?.overlay);
    const steps = (a.steps ?? [["agent.focus", { terminal: a.address }]]).map(([c, args]) => `${c} ${JSON.stringify(args)}`).join("\n");
    exec("sh", ["-c", RAISE, "sh", a.window.home, steps, a.window.session]).catch(() => {});
  }

  // ---- agent picker -------------------------------------------------------------

  pickerRows() {
    const id = props()?.picker;
    return allAgents()
      .filter((a) => a.space === id)
      .sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0));
  }

  choose(a) {
    if (!a) return;
    closeOverlay(props()?.overlay);
    focusAgent(a);
  }

  renderPicker() {
    const t = theme();
    const rows = this.pickerRows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const space = spaces().find((s) => s.id === props()?.picker);
    return v_flex()
      .id("sb-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at - 1 + rows.length) % Math.max(1, rows.length);
        else if (e.key === "enter") this.choose(rows[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child(`Agents in ${space?.name ?? "space"}`))
      .children(rows.map((a, k) =>
        h_flex()
          .id(`sb-pick-${k}`)
          .h(31)
          .px(8)
          .gap(8)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .when(k === this.at, (el) => el.bg(t.selected))
          .hover((x) => x.bg(t.hover))
          .on_click(() => this.choose(a))
          .child(glyph(t, a.status))
          .when(Boolean(programIcon(a, t.foreground)), (el) => el.child(programIcon(a, t.foreground)))
          .child(div().flex_none().max_w(150).truncate().child(a.title ?? a.address))
          .child(div().flex_1().truncate().text_color(t.dim).child(`${a.tab_name ?? ""}${a.nested ? " · nested" : ""}`))));
  }

  // ---- "new space on…" machine menu ----------------------------------------------

  newSpaceOn(machine) {
    closeOverlay(props()?.overlay);
    run("space.new", { machine: machine ?? "" });
  }

  renderMachines() {
    const t = theme();
    const list = this.machineList ?? [null];
    if (this.at >= list.length) this.at = 0;
    return v_flex()
      .id("sb-machines")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at - 1 + list.length) % list.length;
        else if (e.key === "enter") this.newSpaceOn(list[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child("New space on"))
      .children(list.map((m, k) =>
        h_flex()
          .id(`sb-mach-${k}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .when(k === this.at, (el) => el.bg(t.selected))
          .hover((x) => x.bg(t.hover))
          .on_click(() => this.newSpaceOn(m))
          .child(svg(ICON(m ? "server" : "monitor")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(m ?? "This computer"))))
      .when(list.length === 1, (el) => el.child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child("No other machines connected (hc machine add)")));
  }

  // ---- a machine's dropdown: its spaces, the hovered one's agents beside ----------

  groupSpaces() {
    return spaces().filter((s) => s.machine === props()?.group);
  }

  pickSpace(s) {
    if (!s) return;
    closeOverlay(props()?.overlay);
    run("space.select", { id: s.id });
  }

  renderGroup() {
    const t = theme();
    const list = this.groupSpaces();
    const agents = allAgents();
    const ranked = (s) => agents.filter((a) => a.space === s.id).sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0));
    if (this.hover == null) this.hover = Math.max(0, list.findIndex((s) => s.active));
    if (this.hover >= list.length) this.hover = Math.max(0, list.length - 1);
    this.side ??= false;  // keyboard in the agents list
    const hovered = list[this.hover];
    const mine = hovered ? ranked(hovered) : [];
    if (this.at >= mine.length) this.at = Math.max(0, mine.length - 1);
    const panel = (el) => own(el).p(5).bg(t.popover).border_1().border_color(t.border).rounded(9).text_size(12.8);
    const row = (el, on) => el.h(ROW).px(8).gap(8).rounded(7).items_center().text_color(t.foreground)
      .when(on, (x) => x.bg(t.selected)).hover((x) => x.bg(t.hover));
    return h_flex()
      .id("sb-group")
      .track_focus(this.handle)
      .size_full()
      .items_start()
      // The empty part of this popup is see-through: a click there closes it.
      .on_mouse_down("left", () => closeOverlay(props().overlay))
      .on_key_down((e, cx) => {
        const n = this.side ? mine.length : list.length;
        if (e.key === "down" && n) { if (this.side) this.at = (this.at + 1) % n; else { this.hover = (this.hover + 1) % n; this.at = 0; } }
        else if (e.key === "up" && n) { if (this.side) this.at = (this.at - 1 + n) % n; else { this.hover = (this.hover - 1 + n) % n; this.at = 0; } }
        else if (e.key === "right" && mine.length) this.side = true;
        else if (e.key === "left") this.side = false;
        else if (e.key === "enter") { if (this.side) this.choose(mine[this.at]); else this.pickSpace(hovered); }
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(panel(v_flex())
        .id("sb-group-spaces")
        .w(SPACES_W)
        .flex_none()
        .child(h_flex().px(8).h(HEAD).gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(svg(ICON("server")).size(11).flex_none().text_color(colorOf(props().group) ?? t.dim))
          .child(div().truncate().text_color(colorOf(props().group) ?? t.dim).child(props().group)))
        .children(list.map((s, k) => {
          const a = ranked(s);
          const state = worst(a) ?? s.status;
          return row(h_flex().id(`sb-gs-${k}`), k === this.hover && !this.side)
            .on_hover((h, cx) => { if (h && this.hover !== k) { this.hover = k; this.at = 0; this.side = false; cx.notify(); } })
            .on_click(() => this.pickSpace(s))
            .child(div().w(14).flex_none().when(Boolean(glyph(t, state)), (x) => x.child(glyph(t, state))))
            .child(div().flex_1().truncate().when(s.active, (x) => x.text_color(colorOf(s.machine) ?? t.accent)).child(s.name))
            .when(a.length > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${a.length} agent${a.length > 1 ? "s" : ""}`)))
            .child(div().flex_none().text_size(10).text_color(a.length ? t.dim : "#00000000").child("▸"));
        })))
      .when(mine.length > 0, (el) => el.child(panel(v_flex())
        .id("sb-group-agents")
        .w(AGENTS_W)
        .flex_none()
        .ml(4)
        // Level with the hovered space: both lists start with a header.
        .mt(this.hover * ROW)
        .child(h_flex().px(8).h(HEAD).items_center().text_size(11.5).text_color(t.dim).truncate().child(`Agents in ${hovered.name}`))
        .children(mine.map((a, k) =>
          row(h_flex().id(`sb-ga-${k}`), this.side && k === this.at)
            .on_click(() => this.choose(a))
            .child(glyph(t, a.status))
            .when(Boolean(programIcon(a, t.foreground)), (x) => x.child(programIcon(a, t.foreground)))
            .child(div().flex_none().max_w(150).truncate().child(a.title ?? a.address))
            .child(div().flex_1().truncate().text_color(t.dim).child(`${a.tab_name ?? ""}${a.nested ? " · nested" : ""}`))))));
  }

  render() {
    if (props()?.inbox) return this.renderInbox();
    if (props()?.group) return this.renderGroup();
    if (props()?.machines) return this.renderMachines();
    return props()?.picker ? this.renderPicker() : this.renderBar();
  }
}
