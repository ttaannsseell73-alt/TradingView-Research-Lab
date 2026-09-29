$ErrorActionPreference = "Stop"

$Repo = "ttaannsseell73-alt/TradingView-Research-Lab"
$RepoUrl = "https://github.com/$Repo"
$RunnerRoot = "C:\actions-runner-q-live"
$RunnerName = "TANSEL-Q-LIVE"
$RunnerLabel = "q-live-local"
$WatchdogTask = "GitHubRunnerWatchdog"

function Get-RunnerService([string]$name) {
    Get-Service -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -like "actions.runner.*" -and
            ($_.Name -like "*$name*" -or $_.DisplayName -like "*$name*")
        } |
        Select-Object -First 1
}

function Ensure-RunnerService([string]$root, [string]$name) {
    $svc = Get-RunnerService $name
    if (-not $svc) {
        $svcCmd = Join-Path $root "svc.cmd"
        if (!(Test-Path $svcCmd)) { throw "svc.cmd missing for $name" }
        Push-Location $root
        try {
            & $svcCmd install
            if ($LASTEXITCODE -ne 0) { throw "Service install failed for $name" }
        }
        finally { Pop-Location }
        $svc = Get-RunnerService $name
        if (-not $svc) { throw "Runner service not found after install: $name" }
    }

    if ($svc.Status -ne "Running") {
        Start-Service -Name $svc.Name
        $svc.WaitForStatus("Running",[TimeSpan]::FromSeconds(30))
    }

    $svc = Get-Service -Name $svc.Name
    if ($svc.Status -ne "Running") { throw "Runner service is not running: $name" }
    Write-Host "RUNNER_SERVICE_OK name=$name service=$($svc.Name) status=$($svc.Status)"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "gh CLI is required"
}
gh auth status | Out-Host
if ($LASTEXITCODE -ne 0) { throw "gh CLI is not authenticated" }

New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
$runnerConfig = Join-Path $RunnerRoot ".runner"

if (!(Test-Path $runnerConfig)) {
    $release = gh api repos/actions/runner/releases/latest | ConvertFrom-Json
    $asset = $release.assets |
        Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } |
        Select-Object -First 1
    if (-not $asset) { throw "Could not find Windows x64 runner archive" }

    $zip = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $RunnerRoot -Force
    Remove-Item $zip -Force

    $token = gh api --method POST "repos/$Repo/actions/runners/registration-token" --jq ".token"
    if (-not $token) { throw "Could not obtain runner registration token" }

    Push-Location $RunnerRoot
    try {
        & .\config.cmd --url $RepoUrl --token $token --name $RunnerName --labels $RunnerLabel --work "_work" --unattended --replace
        if ($LASTEXITCODE -ne 0) { throw "Q live runner configuration failed" }
    }
    finally { Pop-Location }
}

Ensure-RunnerService $RunnerRoot $RunnerName

# Install an OS-local watchdog so runner recovery does not itself depend on GitHub Actions.
$watchdog = @'
$ErrorActionPreference = "SilentlyContinue"
$names = @("TANSEL-DATAHUB","TANSEL-Q-LIVE")
foreach($n in $names){
  $svc = Get-Service | Where-Object {
    $_.Name -like "actions.runner.*" -and
    ($_.Name -like "*$n*" -or $_.DisplayName -like "*$n*")
  } | Select-Object -First 1
  if($svc -and $svc.Status -ne "Running"){
    Start-Service -Name $svc.Name
  }
}
'@
$watchdogPath = Join-Path $RunnerRoot "runner-watchdog.ps1"
[System.IO.File]::WriteAllText($watchdogPath,$watchdog,[Text.UTF8Encoding]::new($false))

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $WatchdogTask -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Q_LIVE_RUNNER_READY"
Write-Host "Runner=$RunnerName"
Write-Host "Label=$RunnerLabel"
Write-Host "Root=$RunnerRoot"
Write-Host "Watchdog=$WatchdogTask"
