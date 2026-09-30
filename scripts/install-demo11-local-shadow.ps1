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


$pythonExe = if ($env:pythonLocation) { Join-Path $env:pythonLocation "python.exe" } else { $null }
if (!$pythonExe -or !(Test-Path $pythonExe)) { throw "SETUP_PYTHON_RUNTIME_MISSING" }
& $pythonExe -E -c "import sys; print(sys.executable)" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "SETUP_PYTHON_RUNTIME_BROKEN" }

$nodeCmd = Get-Command node.exe -ErrorAction Stop
$nodeExe = $nodeCmd.Source
if (!(Test-Path $nodeExe)) { throw "SETUP_NODE_RUNTIME_MISSING" }

$runtimeConfig = [ordered]@{
  pythonExe = $pythonExe
  nodeExe = $nodeExe
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
}
$runtimeConfig | ConvertTo-Json | Set-Content (Join-Path $InstallRoot "runtime.json") -Encoding UTF8

$statusPath = Join-Path $InstallRoot "artifacts\demo11\DEMO11_LOCAL_STATUS.json"
if (Test-Path $statusPath) { Remove-Item $statusPath -Force }

# Phase 1: prove the exact installed script can complete one full cycle outside Task Scheduler.
$child = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$runner) -Wait -PassThru -NoNewWindow
if ($child.ExitCode -ne 0) {
  if (Test-Path $statusPath) {
    $failed = Get-Content $statusPath -Raw | ConvertFrom-Json
    throw "LOCAL_SHADOW_PREFLIGHT_FAILED_$($failed.error)"
  }
  throw "LOCAL_SHADOW_PREFLIGHT_EXIT_$($child.ExitCode)"
}
if (!(Test-Path $statusPath)) { throw "LOCAL_SHADOW_PREFLIGHT_STATUS_MISSING" }
$first = Get-Content $statusPath -Raw | ConvertFrom-Json
if ($first.error) { throw "LOCAL_SHADOW_PREFLIGHT_FAILED_$($first.error)" }
if ([int]$first.cycles -lt 1) { throw "LOCAL_SHADOW_PREFLIGHT_CYCLE_NOT_CONFIRMED" }
$firstCycles = [int]$first.cycles

# Phase 2: install and prove the scheduler itself advances the evidence state.
$taskName = "Demo11ReadOnlyShadow"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"')
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
$deadline = (Get-Date).AddSeconds(180)
$advanced = $false
do {
  Start-Sleep -Seconds 3
  if (Test-Path $statusPath) {
    $s = Get-Content $statusPath -Raw | ConvertFrom-Json
    if ($s.error) { throw "LOCAL_SHADOW_SCHEDULED_CYCLE_FAILED_$($s.error)" }
    if ([int]$s.cycles -gt $firstCycles) { $advanced = $true; break }
  }
} while ((Get-Date) -lt $deadline)

$task = Get-ScheduledTask -TaskName $taskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
if (!$advanced) {
  throw "LOCAL_SHADOW_SCHEDULER_NOT_ADVANCING_state=$($task.State)_lastResult=$($taskInfo.LastTaskResult)"
}

$s = Get-Content $statusPath -Raw | ConvertFrom-Json
Write-Host "DEMO11_LOCAL_SHADOW_RUNNING cycles=$($s.cycles) taskState=$($task.State) lastResult=$($taskInfo.LastTaskResult)"
$task | Format-List TaskName,State
$taskInfo | Format-List LastRunTime,LastTaskResult,NextRunTime
Get-Content $statusPath
