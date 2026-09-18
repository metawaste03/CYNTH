<#
.SYNOPSIS
    Removes the Cynth scheduled task registered by install-startup-task.ps1.

.DESCRIPTION
    Stops the task if it is running, then unregisters it. Touches nothing else:
    the build, the database and the .env.local credentials are all left exactly
    as they are.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$TaskName = 'CYNTH Server'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "No scheduled task named '$TaskName' is registered. Nothing to do."
    return
}

if ($task.State -eq 'Running') {
    Write-Host "Stopping '$TaskName'..."
    Stop-ScheduledTask -TaskName $TaskName
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
Write-Host 'Cynth itself, its database and its credentials are untouched.'
