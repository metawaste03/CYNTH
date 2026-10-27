<#
.SYNOPSIS
    Reports whether Cynth is running, and what its own health endpoint says.

.DESCRIPTION
    Checks two independent things, because they can disagree and the difference
    matters:

      1. The scheduled task's state, if one is registered.
      2. Whether /api/health actually answers.

    A task that says "Running" while the health endpoint is silent means the
    process is up but wedged — which is exactly the case a bare task-state
    check would miss.
#>
[CmdletBinding()]
param([int]$Port)

$ErrorActionPreference = 'Stop'
$TaskName = 'CYNTH Server'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not $PSBoundParameters.ContainsKey('Port')) {
    $Port = 4100
    $EnvFile = Join-Path $ProjectRoot 'app\server\.env.local'
    if (Test-Path $EnvFile) {
        $match = Select-String -Path $EnvFile -Pattern '^\s*CYNTH_SERVER_PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($match) { $Port = [int]$match.Matches[0].Groups[1].Value }
    }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Scheduled task '$TaskName': $($task.State)"
    Write-Host "  Last run:    $($info.LastRunTime)"
    Write-Host "  Last result: $($info.LastTaskResult)"
} else {
    Write-Host "Scheduled task '$TaskName': not registered."
    Write-Host "  Register it with .\scripts\install-startup-task.ps1"
}

Write-Host ''
try {
    $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 5
    Write-Host "Backend: Running" -ForegroundColor Green
    Write-Host "  Port:      $Port"
    Write-Host "  Mode:      $($health.mode)"
    Write-Host "  Uptime:    $($health.uptimeSeconds)s"
    Write-Host "  Database:  $($health.database.path)"
    if ($health.servingClient) { Write-Host "  UI:        http://localhost:$Port" }
    else { Write-Host "  UI:        served separately (development mode)" }
} catch {
    Write-Host "Backend: Unavailable" -ForegroundColor Red
    Write-Host "  Nothing answered http://localhost:$Port/api/health"
    Write-Host "  Start it with:  Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  Or directly:    npm start   (from $ProjectRoot)"
}
