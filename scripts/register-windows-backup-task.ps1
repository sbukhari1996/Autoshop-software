$ErrorActionPreference = "Stop"

$taskName = "Autoshop database and uploads backup"
$startupTaskName = "Autoshop start app"
$backupScript = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\backup-windows.ps1"
$startupScript = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\start-windows.ps1"
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Backup script not found: $backupScript"
}
if (-not (Test-Path -LiteralPath $startupScript)) {
  throw "Startup script not found: $startupScript"
}

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`""
$startupAction = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$startupTrigger = New-ScheduledTaskTrigger `
  -AtLogOn `
  -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew
$startupSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Backs up the Autoshop PostgreSQL database and uploaded documents to E:\AutoshopBackups\Postgres." `
  -Force | Out-Null
Register-ScheduledTask `
  -TaskName $startupTaskName `
  -Action $startupAction `
  -Trigger $startupTrigger `
  -Settings $startupSettings `
  -Principal $principal `
  -Description "Starts Docker Desktop and brings the Autoshop app online after this Windows user signs in." `
  -Force | Out-Null

Write-Output "Registered '$taskName' to run daily at 2:00 AM when this Windows user is signed in."
Write-Output "StartWhenAvailable is enabled. Docker Desktop must be running for a backup to succeed."
Write-Output "Registered '$startupTaskName' to restart Docker Desktop and the app at user sign-in."
