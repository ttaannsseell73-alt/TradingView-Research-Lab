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
$loop = Join-Path $InstallRoot "run-demo11-local-loop.ps1"
Copy-Item (Join-Path $SourceRoot "scripts\run-demo11-local-shadow.ps1") $runner -Force
Copy-Item (Join-Path $SourceRoot "scripts\run-demo11-local-loop.ps1") $loop -Force

$runtimeRoot = Join-Path $InstallRoot "runtime"
$pythonRoot = Join-Path $runtimeRoot "python312"
$pythonExe = Join-Path $pythonRoot "python.exe"
if (!(Test-Path $pythonExe)) {
  New-Item -ItemType Directory -Force $pythonRoot | Out-Null
  $zip = Join-Path $runtimeRoot "python-3.12.10-embed-amd64.zip"
  $uri = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
  Invoke-WebRequest -Uri $uri -OutFile $zip -UseBasicParsing
  Expand-Archive -LiteralPath $zip -DestinationPath $pythonRoot -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
if (!(Test-Path $pythonExe)) { throw "PORTABLE_PYTHON_RUNTIME_MISSING" }
& $pythonExe -E -c "import sys, json, urllib.request; print(sys.executable)"
if ($LASTEXITCODE -ne 0) { throw "PORTABLE_PYTHON_RUNTIME_BROKEN" }

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

# Phase 1: prove the exact installed one-shot collector completes a full cycle.
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

# Phase 2: persistent non-admin loop + Startup relaunch.
$targets = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "run-demo11-local-loop\.ps1" }
foreach($p in @($targets)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

$startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Demo11ReadOnlyShadow.cmd"
$cmd = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loop`"`r`n"
[System.IO.File]::WriteAllText($startup,$cmd,(New-Object System.Text.UTF8Encoding($false)))

$tracking = $env:RUNNER_TRACKING_ID
Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue
try {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$loop) -WindowStyle Hidden
} finally {
  if ($null -ne $tracking -and $tracking -ne "") { $env:RUNNER_TRACKING_ID = $tracking }
}

$deadline = (Get-Date).AddSeconds(180)
$advanced = $false
do {
  Start-Sleep -Seconds 3
  if (Test-Path $statusPath) {
    $s = Get-Content $statusPath -Raw | ConvertFrom-Json
    if ($s.error) { throw "LOCAL_SHADOW_LOOP_CYCLE_FAILED_$($s.error)" }
    if ([int]$s.cycles -gt $firstCycles) { $advanced = $true; break }
  }
} while ((Get-Date) -lt $deadline)

$loopProcs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "run-demo11-local-loop\.ps1" }
if (!$advanced) { throw "LOCAL_SHADOW_LOOP_NOT_ADVANCING_processes=$(@($loopProcs).Count)" }
if (@($loopProcs).Count -lt 1) { throw "LOCAL_SHADOW_LOOP_PROCESS_MISSING" }
if (!(Test-Path $startup)) { throw "LOCAL_SHADOW_STARTUP_MISSING" }

$s = Get-Content $statusPath -Raw | ConvertFrom-Json
Write-Host "DEMO11_LOCAL_SHADOW_RUNNING cycles=$($s.cycles) loopProcesses=$(@($loopProcs).Count) startup=$startup"
$loopProcs | Select-Object ProcessId,Name,CommandLine | Format-Table -AutoSize
Get-Content $statusPath
