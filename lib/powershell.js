// A PowerShell script as [program, args] for herdr's exec, the way the Markdown
// viewer runs its Windows commands (cria-file-preview/platform.js; a test keeps the
// two the same). PowerShell reads everything after -Command as script and takes no
// argv, so each value reaches it as character codes, which leave nothing to quote or
// escape; scripts read them as $args and use no double quotes (Windows PowerShell 5
// mangles them on its command line). A failure prints its message alone. Pure.

const value = (text) => `(-join [char[]]@(${Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)).join(",")}))`;

export const powershell = (script, ...values) => ["powershell", ["-NoProfile", "-NonInteractive", "-Command",
  `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; & { try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 } } ${values.map((v) => value(String(v))).join(" ")}`]];

/** A path with Windows' separators. */
export const win = (path) => String(path).replaceAll("/", "\\");
