param(
  [string]$InstallRoot = "C:\Users\TANSEL\Desktop\Demo11-Shadow"
)
$ErrorActionPreference = "Stop"
$SourceRoot = $env:GITHUB_WORKSPACE
if (!(Test-Path $SourceRoot)) { throw "GITHUB_WORKSPACE_MISSING" }

New-Item -ItemType Directory -Force $InstallRoot | Out-Null
New-Item -ItemType Directory -Force (Join-Path $InstallRoot "research") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $InstallRoot "scripts") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $InstallRoot "artifacts\demo11") | Out-Null

function Mirror-Tree([string]$From,[string]$To) {
  robocopy $From $To /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "ROBOCOPY_FAILED_$LASTEXITCODE" }
}

Mirror-Tree (Join-Path $SourceRoot "research") (Join-Path $InstallRoot "research")
Mirror-Tree (Join-Path $SourceRoot "scripts") (Join-Path $InstallRoot "scripts")

$runner = Join-Path $InstallRoot "run-demo11-local-shadow.ps1"
Copy-Item (Join-Path $SourceRoot "scripts\run-demo11-local-shadow.ps1") $runner -Force

$taskName = "Demo11ReadOnlyShadow"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"')
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
$statusPath = Join-Path $InstallRoot "artifacts\demo11\DEMO11_LOCAL_STATUS.json"
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 3
  if (Test-Path $statusPath) {
    $s = Get-Content $statusPath -Raw | ConvertFrom-Json
    if ($s.error) { throw "LOCAL_SHADOW_FIRST_CYCLE_FAILED_$($s.error)" }
    if ([int]$s.cycles -ge 1) { break }
  }
} while ((Get-Date) -lt $deadline)

if (!(Test-Path $statusPath)) { throw "LOCAL_SHADOW_STATUS_MISSING" }
$s = Get-Content $statusPath -Raw | ConvertFrom-Json
if ([int]$s.cycles -lt 1) { throw "LOCAL_SHADOW_FIRST_CYCLE_NOT_CONFIRMED" }

Get-ScheduledTask -TaskName $taskName | Format-List TaskName,State
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime,LastTaskResult,NextRunTime
Get-Content $statusPath
