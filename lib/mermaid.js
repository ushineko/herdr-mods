// Mermaid diagrams in the Markdown viewer (spec 012): the theme to draw in, and what
// to tell the person when a diagram can't be drawn. Pure: no herdr imports.

/** Printed by the render scripts when no mmdc is found. */
export const NO_MMDC = "__no_mmdc__";

/** Whether a #rgb or #rrggbb colour is dark (relative luminance under a half). */
export function isDark(color) {
  let hex = String(color ?? "").replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}/i.test(hex)) return true; // unknown: the app's default is dark
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** Mermaid's theme for the app's background colour. */
export const mermaidTheme = (background) => (isDark(background) ? "dark" : "default");

/**
 * Why a diagram wasn't drawn, from the render's { code, stderr } or a thrown error:
 * no mmdc, too slow, or Mermaid's own message (its first lines, without the stack).
 */
export function mermaidFailure({ code = 1, stderr = "", error = null } = {}) {
  const text = String(error ?? stderr ?? "");
  if (text.includes(NO_MMDC) || code === 127) return "Mermaid isn't installed (mermaid-cli)";
  if (/timed? ?out|timeout/i.test(text)) return "Mermaid took too long";
  const lines = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/^\s*Error:\s*/, "");
    if (!line.trim()) continue;
    if (/^\s+at\s|^\S+\.\S+ \(|https?:\/\//.test(raw) || lines.length >= 4) break;
    lines.push(line.trimEnd());
  }
  return lines.join("\n") || "Mermaid couldn't draw this diagram";
}
