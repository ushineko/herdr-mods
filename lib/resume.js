// The command dock-follow types into a restored shell to resume a Claude Code
// conversation a herdr-core restart (reboot) ended. Pure.
//
// Linux and macOS start Claude through the claude-work / claude-max wrappers (each
// its own login): the terminal's claude.profile label says which, else the app home
// does (a -work home is work). Windows has no wrappers: plain claude (#47).
export function resumeCommand(sid, { profile = "", workHome = false, platform = "linux" } = {}) {
  if (!/^[0-9a-f-]{8,}$/i.test(String(sid ?? ""))) return null;
  const cmd = platform === "windows" ? "claude"
    : profile === "work" ? "claude-work" : profile === "max" ? "claude-max" : workHome ? "claude-work" : "claude-max";
  // The leading space keeps it out of the shell's history.
  return ` ${cmd} --resume ${sid}`;
}
