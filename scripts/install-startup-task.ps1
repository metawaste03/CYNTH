<#
.SYNOPSIS
    Registers Cynth as a Windows Scheduled Task so it starts automatically and
    restarts after a crash.

.DESCRIPTION
    Cynth's production shape is a single Node process that serves both the API
    and the built client (see docs/14_LOCAL_SERVICE_MANAGEMENT.md). This script
    hands that process to Windows' own Task Scheduler, which is the simplest
    reliable mechanism that satisfies all three requirements:

      * starts automatically              -> a logon or startup trigger
      * restarts after a crash            -> a second trigger that retries
                                             every minute, with the task set to
                                             ignore a start while one is
                                             already running
      * survives reboots and power loss   -> follows from the trigger

    Note the crash-recovery mechanism, because the obvious one does not work:
    Task Scheduler's RestartCount/RestartInterval apply when the task ENGINE
    reports a failure, not when a long-running process the task launched is
    killed. See the comment above the triggers.

    No third-party service wrapper, no supervisor process, and no elevation at
    runtime: the task runs as the current user with ordinary privileges.

    This script only registers the task. It does NOT build Cynth — run
    `npm run build` at the project root first, or pass -Build.

.PARAMETER AtStartup
    Register the task to run at system startup instead of at user logon.
    Starts Cynth before anyone logs in, but registering it REQUIRES an elevated
    PowerShell. The default (logon) needs no elevation and is enough for a
    single-user workstation.

.PARAMETER Build
    Run `npm run build` before registering, so the task points at a client that
    actually exists.

.PARAMETER Port
    Port for the Cynth process. Defaults to whatever CYNTH_SERVER_PORT is set to
    in app/server/.env.local, else 4100.

.EXAMPLE
    .\scripts\install-startup-task.ps1 -Build

.EXAMPLE
    # From an elevated PowerShell, to start before login:
    .\scripts\install-startup-task.ps1 -AtStartup
#>
[CmdletBinding()]
param(
    [switch]$AtStartup,
    [switch]$Build,
    [int]$Port
)

$ErrorActionPreference = 'Stop'

$TaskName = 'CYNTH Server'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServerEntry = Join-Path $ProjectRoot 'app\server\dist\index.js'
$ClientIndex = Join-Path $ProjectRoot 'app\client\dist\index.html'

Write-Host "Cynth project root: $ProjectRoot"

# --- resolve node ------------------------------------------------------------

$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    throw "node was not found on PATH. Install Node.js 22.5 or later, then run this script again."
}
Write-Host "Using node: $NodeExe"

# --- build if asked ----------------------------------------------------------

if ($Build) {
    Write-Host 'Building Cynth (client then server)...'
    Push-Location $ProjectRoot
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

# A task pointing at something that does not exist is worse than no task: it
# fails silently at every boot. Check before registering.
if (-not (Test-Path $ServerEntry)) {
    throw "Server build not found at $ServerEntry. Run 'npm run build' at the project root (or pass -Build), then try again."
}
if (-not (Test-Path $ClientIndex)) {
    Write-Warning "Client build not found at $ClientIndex. Cynth will serve its API but not its UI until you run 'npm run build'."
}

# --- resolve port ------------------------------------------------------------

if (-not $PSBoundParameters.ContainsKey('Port')) {
    $Port = 4100
    $EnvFile = Join-Path $ProjectRoot 'app\server\.env.local'
    if (Test-Path $EnvFile) {
        # Only CYNTH_SERVER_PORT is read. This file also holds credentials;
        # nothing else in it is touched, echoed, or logged.
        $match = Select-String -Path $EnvFile -Pattern '^\s*CYNTH_SERVER_PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($match) { $Port = [int]$match.Matches[0].Groups[1].Value }
    }
}
Write-Host "Cynth will listen on port $Port."

# --- register ----------------------------------------------------------------

if ($AtStartup) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "-AtStartup registers a system-startup trigger, which requires an elevated PowerShell. Re-run as Administrator, or omit -AtStartup to use a logon trigger instead."
    }
    $trigger = New-ScheduledTaskTrigger -AtStartup
} else {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
}

# --- crash recovery ----------------------------------------------------------
#
# RestartCount/RestartInterval below are NOT sufficient on their own, which is
# easy to miss because they read as though they are. Task Scheduler applies
# them when the task ENGINE reports a failure — not when a long-running process
# the task started is terminated. Verified on 2026-08-30 by killing the Node
# process: the task went to Ready, the "restart 3 times" setting never fired,
# and Cynth stayed down.
#
# What does work is a repeating trigger paired with MultipleInstances =
# IgnoreNew (set in the settings below): every minute Windows tries to start
# the task, the attempt is ignored while an instance is already running, and
# the first attempt after the process dies brings it back.
#
# That repetition has to be its OWN trigger rather than being attached to the
# logon trigger above. A trigger's repetition window only opens when the
# trigger itself fires, so a repetition hung off the logon trigger stays
# dormant until the next logon — which means it does nothing on the very day
# you install it, and nothing at all after a mid-session crash. Also verified
# on 2026-08-30: with the repetition on the logon trigger, killing the process
# left Cynth down indefinitely.
#
# A "once, starting now" trigger is active immediately and forever, so the
# watchdog works from the moment this script finishes.
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 1)

# An EMPTY duration is how the Task Scheduler XML expresses "repeat
# indefinitely". The obvious-looking [TimeSpan]::MaxValue serialises to
# P99999999DT23H59M59S, which the scheduler rejects outright with "contains a
# value which is incorrectly formatted or out of range" — and because the
# existing task has already been unregistered by that point, the failure would
# leave nothing scheduled at all.
$watchdogTrigger.Repetition.Duration = ''

# Two triggers, two jobs: the first starts Cynth promptly at logon (or at
# system startup), the second keeps it alive from then on.
$triggers = @($trigger, $watchdogTrigger)

$action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument "`"$ServerEntry`"" `
    -WorkingDirectory (Join-Path $ProjectRoot 'app\server')

# MultipleInstances defaults to IgnoreNew, which is what makes the repeating
# trigger above safe: a start attempt while Cynth is already running is
# discarded rather than producing a second process fighting for the port.
#
# RestartCount/RestartInterval are kept because they do cover one real case —
# the task failing to start at all — but they are not the crash-recovery
# mechanism. See the comment on the trigger above.
# -Hidden matters more than it looks. The recovery trigger below retries every
# minute, and without this EVERY retry flashes a console window on the desktop.
# When Cynth is already running the retry is simply refused and nothing is
# seen — but when the port is held by something else (a manually started
# instance, most often), the task fails and retries forever, and the visible
# symptom is a terminal window popping open and closing once a minute. The
# window is noise either way: this task never has anything to show a user.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# Limited run level: Cynth needs no elevated privileges to run, only to be
# registered with a startup trigger.
$principalSpec = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Replacing the existing '$TaskName' task."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'Runs the Cynth content production system (API + built client) as a single Node process.' `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principalSpec `
    -ErrorAction Stop | Out-Null

# Register-ScheduledTask can report a failure as a NON-terminating error, which
# $ErrorActionPreference does not catch on its own — so the script would sail
# past a failed registration and print "Registered" in green. That is the worst
# possible outcome here, because the existing task has already been removed
# above: the user is told they are covered while nothing is scheduled at all.
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    throw "Registration did not throw, but '$TaskName' does not exist afterwards. NOTHING IS SCHEDULED — any previous task was removed. Fix the error above and re-run this script."
}

Write-Host ''
Write-Host "Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host ("  Trigger:  " + $(if ($AtStartup) { 'At system startup' } else { "At logon ($env:USERNAME)" }))
Write-Host "  Command:  $NodeExe `"$ServerEntry`""
Write-Host "  Recovery: checked every minute; restarted within a minute if it dies"
Write-Host ''
Write-Host "Start it now with:   Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then open:           http://localhost:$Port"
Write-Host "Remove it with:      .\scripts\uninstall-startup-task.ps1"
