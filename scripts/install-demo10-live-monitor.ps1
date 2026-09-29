$ErrorActionPreference = "Stop"

$Repo = "ttaannsseell73-alt/TradingView-Research-Lab"
$StatusIssue = 150
$QStatusIssue = 109
$RuntimeRoot = "C:\demo10-live"
$RuntimeRepo = Join-Path $RuntimeRoot "repo"
$WorkRoot = Join-Path $RuntimeRoot "work"
$StateRoot = Join-Path $RuntimeRoot "state"
$LogRoot = Join-Path $RuntimeRoot "logs"
$Python = "C:\actions-runner-datahub\.venv-datahub\Scripts\python.exe"
$TaskName = "Demo10LiveMonitor"
$QTaskName = "QDemoForwardMonitor"
$RepoRoot = Split-Path $PSScriptRoot -Parent

function Stop-QRuntime {
    Write-Host "== Retiring Q local runtime =="

    try { Stop-ScheduledTask -TaskName $QTaskName -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName $QTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

    $qRunner = Get-Service -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -like "actions.runner.*" -and
            ($_.Name -like "*TANSEL-Q-LIVE*" -or $_.DisplayName -like "*TANSEL-Q-LIVE*")
        } |
        Select-Object -First 1
    if ($qRunner) {
        try {
            if ($qRunner.Status -ne "Stopped") { Stop-Service -Name $qRunner.Name -Force -ErrorAction Stop }
        } catch { Write-Warning "Could not stop Q runner service: $($_.Exception.Message)" }
        try { Set-Service -Name $qRunner.Name -StartupType Disabled -ErrorAction Stop }
        catch { Write-Warning "Could not disable Q runner service startup: $($_.Exception.Message)" }
    }

    $watchdogPath = "C:\actions-runner-q-live\runner-watchdog.ps1"
    if (Test-Path (Split-Path $watchdogPath)) {
        $watchdog = @'
$ErrorActionPreference = "SilentlyContinue"
$n = "TANSEL-DATAHUB"
$svc = Get-Service | Where-Object {
  $_.Name -like "actions.runner.*" -and
  ($_.Name -like "*$n*" -or $_.DisplayName -like "*$n*")
} | Select-Object -First 1
if($svc -and $svc.Status -ne "Running"){
  Start-Service -Name $svc.Name
}
'@
        [System.IO.File]::WriteAllText($watchdogPath,$watchdog,[Text.UTF8Encoding]::new($false))
    }

    try {
        cmd /c "docker ps --filter name=^/canonical-q-demo-pg$ --format {{.Names}}" | ForEach-Object {
            if ($_ -eq "canonical-q-demo-pg") { docker stop canonical-q-demo-pg | Out-Null }
        }
    } catch { Write-Warning "Q PostgreSQL container stop skipped: $($_.Exception.Message)" }

    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $retired = @"
# QUSDT LIVE STATUS — RETIRED

- state: STOPPED
- retired_at_local: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
- scheduler: QDemoForwardMonitor removed
- automatic_q_cycles: DISABLED
- q_runner: TANSEL-Q-LIVE retired where present
- q_postgres: stopped where present; data preserved
- exchange_position_action: NOT_TOUCHED
- replacement: Demo-10 live shadow monitor
- replacement_status: Issue #150

Q is no longer an active monitoring lane.
"@
        $tmp = Join-Path $env:TEMP "q-retired-status.md"
        [System.IO.File]::WriteAllText($tmp,$retired,[Text.UTF8Encoding]::new($false))
        try { gh issue edit $QStatusIssue --repo $Repo --body-file $tmp | Out-Null } catch {}
        try { gh issue close $QStatusIssue --repo $Repo --reason completed | Out-Null } catch {}
    }
}

function Copy-RuntimeSource {
    Write-Host "== Installing Demo-10 runtime source =="
    New-Item -ItemType Directory -Force $RuntimeRoot,$RuntimeRepo,$StateRoot,$LogRoot | Out-Null

    foreach($name in @("research","scripts")){
        $src = Join-Path $RepoRoot $name
        $dst = Join-Path $RuntimeRepo $name
        if (!(Test-Path $src)) { throw "Missing runtime source: $src" }
        if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
        Copy-Item $src $dst -Recurse -Force
    }

    $board = Get-Content (Join-Path $RuntimeRepo "research\demo_cohort_10.json") -Raw | ConvertFrom-Json
    if ($board.mode -ne "PAPER_SHADOW_ONLY") { throw "Demo-10 mode is not PAPER_SHADOW_ONLY" }
    if (@($board.deploymentCandidates).Count -ne 10) { throw "Demo-10 candidate count is not 10" }
    if ($board.cohortId -ne "demo-10-forward-v2") { throw "Unexpected Demo-10 cohort: $($board.cohortId)" }
}

function Install-Demo10RunnerScript {
    $runnerPath = Join-Path $RuntimeRoot "run-demo10-live.ps1"
    $body = @'
$ErrorActionPreference = "Stop"

$Repo = "ttaannsseell73-alt/TradingView-Research-Lab"
$StatusIssue = 150
$RuntimeRoot = "C:\demo10-live"
$RepoRoot = Join-Path $RuntimeRoot "repo"
$WorkRoot = Join-Path $RuntimeRoot "work"
$StateRoot = Join-Path $RuntimeRoot "state"
$LogRoot = Join-Path $RuntimeRoot "logs"
$Python = "C:\actions-runner-datahub\.venv-datahub\Scripts\python.exe"
$Log = Join-Path $LogRoot "demo10-live.log"

New-Item -ItemType Directory -Force $WorkRoot,$StateRoot,$LogRoot | Out-Null

$mutex = New-Object System.Threading.Mutex($false,"Demo10LiveMonitorMutex")
if (-not $mutex.WaitOne(0)) {
    Add-Content $Log "$(Get-Date -Format o) SKIP=PREVIOUS_CYCLE_RUNNING"
    exit 0
}

function Publish-Failure([string]$message) {
    try {
        if (!(Get-Command gh -ErrorAction SilentlyContinue)) { return }
        $safe = $message -replace '[\r\n]+',' '
        $lines = @(
            "# DEMO-10 LIVE STATUS",
            "",
            "- scheduler_local: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")",
            "- cycle_state: FAIL",
            "- cohort: demo-10-forward-v2",
            "- mode: PAPER_SHADOW_ONLY",
            "- real_orders: DISABLED",
            "- error: $safe",
            "",
            "_Updated by the local 1-minute Demo-10 monitor._"
        )
        $tmp = Join-Path $env:TEMP "demo10-live-status.md"
        [System.IO.File]::WriteAllLines($tmp,$lines,[Text.UTF8Encoding]::new($false))
        gh issue edit $StatusIssue --repo $Repo --body-file $tmp | Out-Null
    } catch {}
}

try {
    if (!(Test-Path $Python)) { throw "DATAHUB_PYTHON_MISSING: $Python" }
    if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw "NODE_MISSING" }

    if (Test-Path $WorkRoot) { Remove-Item $WorkRoot -Recurse -Force }
    New-Item -ItemType Directory -Force $WorkRoot | Out-Null

    $board = Join-Path $RepoRoot "research\demo_cohort_10.json"
    $policy = Join-Path $RepoRoot "research\tradability_policy.json"
    $market = Join-Path $WorkRoot "live-market.json"
    $executionDir = Join-Path $WorkRoot "execution"
    $candlesDir = Join-Path $WorkRoot "candles"
    $signalDir = Join-Path $WorkRoot "current-signal"
    $journalDir = Join-Path $WorkRoot "shadow-journal"
    $previous = Join-Path $StateRoot "SHADOW_STATE.json"

    & $Python (Join-Path $RepoRoot "scripts\fetch-live-market-snapshot.py") $board $market *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "MARKET_SNAPSHOT_EXIT_$LASTEXITCODE" }

    node (Join-Path $RepoRoot "scripts\build-execution-watchlist.mjs") $board $market $policy $executionDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "EXECUTION_WATCHLIST_EXIT_$LASTEXITCODE" }

    & $Python (Join-Path $RepoRoot "scripts\fetch-current-candles.py") $board (Join-Path $executionDir "EXECUTION_WATCHLIST.json") $candlesDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "CANDLES_EXIT_$LASTEXITCODE" }

    node (Join-Path $RepoRoot "scripts\build-current-signal-watchlist.mjs") $board (Join-Path $executionDir "EXECUTION_WATCHLIST.json") $candlesDir $signalDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "SIGNAL_WATCHLIST_EXIT_$LASTEXITCODE" }

    $prevArg = if (Test-Path $previous) { $previous } else { "-" }
    node (Join-Path $RepoRoot "scripts\build-shadow-journal.mjs") (Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json") $prevArg $journalDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "SHADOW_JOURNAL_EXIT_$LASTEXITCODE" }

    $newState = Join-Path $journalDir "SHADOW_STATE.json"
    if (!(Test-Path $newState)) { throw "SHADOW_STATE_MISSING" }
    Copy-Item $newState $previous -Force

    $s = Get-Content $newState -Raw | ConvertFrom-Json
    $w = Get-Content (Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json") -Raw | ConvertFrom-Json

    $lines = @(
        "# DEMO-10 LIVE STATUS",
        "",
        "- scheduler_local: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")",
        "- cycle_state: SUCCESS",
        "- cohort: $($w.cohortId)",
        "- mode: PAPER_SHADOW_ONLY",
        "- real_orders: DISABLED",
        "- cadence: 1 minute",
        "- dataAvailable: $($w.dataAvailable)",
        "- evaluated: $($w.counts.evaluated)",
        "- freshSignals: $($w.counts.freshSignals)",
        "- paperIntents: $($w.counts.paperIntents)",
        "- openPositions: $($s.summary.openPositions)",
        "- closedTrades: $($s.summary.closedTrades)",
        "- winRate: $($s.summary.winRate)",
        "- realizedPnlPerReferenceNotionalSum: $($s.summary.realizedPnlPerReferenceNotionalSum)",
        "- unrealizedPnlPerReferenceNotionalSum: $($s.summary.unrealizedPnlPerReferenceNotionalSum)",
        "",
        "## 10 setup live state",
        "",
        "| Underlying | TF | Strategy | Direction | Signal state | Exec | Fresh | Age |",
        "|---|---|---|---|---|---|---|---:|"
    )

    foreach($r in @($w.rows) | Sort-Object underlying){
        $lines += "| $($r.underlying) | $($r.timeframe) | $($r.strategy) | $($r.direction) | $($r.status) | $($r.executionStatus) | $($r.fresh) | $($r.signalAgeBars) |"
    }

    $lines += @("","## Open paper positions","")
    if (@($s.positions).Count -eq 0) {
        $lines += "_None._"
    } else {
        $lines += "| Underlying | Dir | Contract | Strategy | TF | Entry | Mark | Net if closed |"
        $lines += "|---|---|---|---|---|---:|---:|---:|"
        foreach($p in @($s.positions) | Sort-Object underlying){
            $lines += "| $($p.underlying) | $($p.direction) | $($p.executionContract) | $($p.leadStrategy) | $($p.leadTimeframe) | $($p.entryPrice) | $($p.markPrice) | $($p.unrealizedNetIfClosed) |"
        }
    }

    $lines += @("","_Updated by the local 1-minute Demo-10 monitor._")

    $bodyFile = Join-Path $env:TEMP "demo10-live-status.md"
    [System.IO.File]::WriteAllLines($bodyFile,$lines,[Text.UTF8Encoding]::new($false))
    gh issue edit $StatusIssue --repo $Repo --body-file $bodyFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "STATUS_PUBLISH_FAILED" }

    $latest = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        cohortId = $w.cohortId
        cycleState = "SUCCESS"
        dataAvailable = $w.dataAvailable
        counts = $w.counts
        summary = $s.summary
        positions = $s.positions
    } | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText((Join-Path $RuntimeRoot "latest.json"),$latest,[Text.UTF8Encoding]::new($false))

    Add-Content $Log "$(Get-Date -Format o) SUCCESS cohort=$($w.cohortId) fresh=$($w.counts.freshSignals) open=$($s.summary.openPositions)"
    exit 0
}
catch {
    $msg = $_.Exception.Message
    Add-Content $Log "$(Get-Date -Format o) FAIL $msg"
    Publish-Failure $msg
    exit 1
}
finally {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
'@

    [System.IO.File]::WriteAllText($runnerPath,$body,[Text.UTF8Encoding]::new($false))
    return $runnerPath
}

function Install-Demo10Task([string]$runnerPath) {
    Write-Host "== Registering Demo-10 local 1-minute task =="

    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $startup = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($repeat,$startup) -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
}

Stop-QRuntime
Copy-RuntimeSource
$runnerPath = Install-Demo10RunnerScript
Install-Demo10Task $runnerPath

$deadline = (Get-Date).AddMinutes(3)
$latest = Join-Path $RuntimeRoot "latest.json"
do {
    Start-Sleep -Seconds 5
    if (Test-Path $latest) {
        $item = Get-Item $latest
        if ($item.LastWriteTime -gt (Get-Date).AddMinutes(-3)) { break }
    }
} while ((Get-Date) -lt $deadline)

if (!(Test-Path $latest)) {
    $log = Join-Path $LogRoot "demo10-live.log"
    if (Test-Path $log) { Get-Content $log -Tail 120 }
    throw "Demo-10 local monitor did not produce latest.json"
}

$status = Get-Content $latest -Raw | ConvertFrom-Json
if ($status.cycleState -ne "SUCCESS") { throw "Demo-10 first cycle not successful" }

Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime,LastTaskResult,NextRunTime
Get-Content $latest

Write-Host "DEMO10_LOCAL_LIVE_READY"
