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
      * restarts after a crash            -> RestartCount / RestartInterval
      * survives reboots and power loss   -> follows from the trigger

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

$action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument "`"$ServerEntry`"" `
    -WorkingDirectory (Join-Path $ProjectRoot 'app\server')

# RestartCount/RestartInterval are what make this a recovery mechanism rather
# than just an autostart: if the process dies, Windows brings it back.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
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
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principalSpec | Out-Null

Write-Host ''
Write-Host "Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host ("  Trigger:  " + $(if ($AtStartup) { 'At system startup' } else { "At logon ($env:USERNAME)" }))
Write-Host "  Command:  $NodeExe `"$ServerEntry`""
Write-Host "  Recovery: restarts up to 3 times, one minute apart"
Write-Host ''
Write-Host "Start it now with:   Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then open:           http://localhost:$Port"
Write-Host "Remove it with:      .\scripts\uninstall-startup-task.ps1"
