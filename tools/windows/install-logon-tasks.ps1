# Keeps herdr-core in the desktop session on Windows (herdr-mods spec 013).
#
# An administrator's SSH logins run elevated, so a core that an SSH connection
# starts (another machine's `herdr-core connect`, e.g. right after a reboot)
# makes its pipe at high integrity, and the desktop app then fails to open it
# ("permission denied (os error 5)"). Two tasks fix that at every sign-in:
#
#   "herdr-core take back" (at logon, elevated): stops a core running in
#     session 0 (one SSH started), then starts the task below.
#   "herdr-core at logon" (on demand, not elevated): `herdr-core server start`
#     in the desktop session, hidden. A core already there is left alone.
#
# SSH connections drop once and reattach to the new core. Run this once as the
# user, from an elevated PowerShell (or over SSH, which is elevated):
#   powershell -ExecutionPolicy Bypass -File tools\windows\install-logon-tasks.ps1
$ErrorActionPreference = 'Stop'

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$core = Join-Path $env:LOCALAPPDATA 'Programs\herdr-core\herdr-core.exe'
$dir = Join-Path $env:LOCALAPPDATA 'herdr-mods'
$script = Join-Path $dir 'herdr-core-take-back.ps1'
New-Item -ItemType Directory -Force $dir | Out-Null

# The elevated step: stop session 0's cores (serve and hold), then start the core
# in the desktop session through the unelevated task. Logged beside the script.
@'
$log = Join-Path $PSScriptRoot 'herdr-core-take-back.log'
function Say($m) { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $m) }
$cores = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'herdr-core.exe' -and $_.SessionId -eq 0 -and $_.CommandLine -match ' (serve|hold)( |$)' }
foreach ($p in $cores) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Say "stopped session-0 core $($p.ProcessId)" }
if ($cores) { Start-Sleep -Seconds 2 }
Start-ScheduledTask -TaskName 'herdr-core at logon'
Say 'started the desktop core task'
'@ | Set-Content -LiteralPath $script -Encoding UTF8

# Unelevated, on demand: the core in the desktop session, no console window.
$a = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument "--headless `"$core`" server start"
$p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
# Made afresh: an earlier version of it had a logon trigger of its own, which
# re-registering with -Force keeps.
Unregister-ScheduledTask -TaskName 'herdr-core at logon' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'herdr-core at logon' -Action $a -Principal $p -Settings $s -Force `
  -Description 'Starts herdr-core in the desktop session, not elevated (started by "herdr-core take back"). herdr-mods spec 013.' | Out-Null

# Elevated, at logon: take the core back from session 0, then run the task above.
$a = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
$t = New-ScheduledTaskTrigger -AtLogOn -User $user
$p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'herdr-core take back' -Action $a -Trigger $t -Principal $p -Settings $s -Force `
  -Description 'At sign-in: stops a herdr-core an SSH connection started (elevated, session 0), then runs "herdr-core at logon". herdr-mods spec 013.' | Out-Null

foreach ($n in 'herdr-core take back', 'herdr-core at logon') {
  $k = Get-ScheduledTask -TaskName $n
  '{0}: {1}, {2}, triggers: {3}' -f $n, $k.State, $k.Principal.RunLevel, ($k.Triggers | Measure-Object).Count
}
