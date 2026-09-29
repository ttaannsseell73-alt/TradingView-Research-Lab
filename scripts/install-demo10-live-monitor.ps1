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
$BotRoot = "C:\Users\TANSEL\Desktop\binance-bot"
$DemoEnv = Join-Path $BotRoot ".demo10-testnet.local.env"
$DemoPgUrl = "postgres://postgres:demo10_testnet_pw@127.0.0.1:55441/demo10_testnet"
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
    if ($board.mode -ne "BINANCE_USDM_TESTNET") { throw "Demo-10 mode is not BINANCE_USDM_TESTNET" }
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
$BotRoot = "C:\Users\TANSEL\Desktop\binance-bot"
$DemoEnv = Join-Path $BotRoot ".demo10-testnet.local.env"
$DemoPgUrl = "postgres://postgres:demo10_testnet_pw@127.0.0.1:55441/demo10_testnet"
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
            "- mode: BINANCE_USDM_TESTNET",
            "- testnet_orders: ENABLED",
            "- production_orders: DISABLED",
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

    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $Python (Join-Path $RepoRoot "scripts\fetch-live-market-snapshot.py") $board $market *>> $Log
    $pythonExit = $LASTEXITCODE
    $ErrorActionPreference = $savedEap
    if ($pythonExit -ne 0) { throw "MARKET_SNAPSHOT_EXIT_$pythonExit" }

    node (Join-Path $RepoRoot "scripts\build-execution-watchlist.mjs") $board $market $policy $executionDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "EXECUTION_WATCHLIST_EXIT_$LASTEXITCODE" }

    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $Python (Join-Path $RepoRoot "scripts\fetch-current-candles.py") $board (Join-Path $executionDir "EXECUTION_WATCHLIST.json") $candlesDir *>> $Log
    $pythonExit = $LASTEXITCODE
    $ErrorActionPreference = $savedEap
    if ($pythonExit -ne 0) { throw "CANDLES_EXIT_$pythonExit" }

    node (Join-Path $RepoRoot "scripts\build-current-signal-watchlist.mjs") $board (Join-Path $executionDir "EXECUTION_WATCHLIST.json") $candlesDir $signalDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "SIGNAL_WATCHLIST_EXIT_$LASTEXITCODE" }

    $proximityPath = Join-Path $WorkRoot "demo10-proximity.json"
    node (Join-Path $RepoRoot "scripts\build-demo10-proximity.mjs") $board (Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json") $candlesDir $proximityPath *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "PROXIMITY_EXIT_$LASTEXITCODE" }

    $prevArg = if (Test-Path $previous) { $previous } else { "-" }
    node (Join-Path $RepoRoot "scripts\build-shadow-journal.mjs") (Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json") $prevArg $journalDir *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "SHADOW_JOURNAL_EXIT_$LASTEXITCODE" }

    $newState = Join-Path $journalDir "SHADOW_STATE.json"
    if (!(Test-Path $newState)) { throw "SHADOW_STATE_MISSING" }
    Copy-Item $newState $previous -Force

    if (!(Test-Path $BotRoot)) { throw "BINANCE_BOT_ROOT_MISSING" }
    if (!(Test-Path $DemoEnv)) { throw "DEMO10_TESTNET_ENV_MISSING" }
    foreach ($line in Get-Content $DemoEnv) {
        if ($line -match '^([^#=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1],$matches[2],"Process")
        }
    }
    $env:LIVEBOT_CANARY_APPROVED = "YES"
    $env:DEMO10_TESTNET_APPROVED = "YES"
    $env:DEMO10_TESTNET_PG_URL = $DemoPgUrl
    $env:DEMO10_SIGNAL_PATH = Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json"
    $env:DEMO10_TESTNET_NOTIONAL = "100"
    $env:DEMO10_TESTNET_MAX_OPEN = "10"
    $env:DEMO10_TESTNET_MAX_GROSS = "1000"
    $env:DEMO10_TESTNET_STOP_FRACTION = "0.20"

    Push-Location $BotRoot
    try {
        npm run demo10:testnet-once *>> $Log
        $testnetExit = $LASTEXITCODE
        if ($testnetExit -ne 0) { throw "DEMO10_TESTNET_EXECUTOR_EXIT_$testnetExit" }
        $testnetReport = Join-Path $BotRoot "artifacts\demo10-testnet-latest.json"
        if (!(Test-Path $testnetReport)) { throw "DEMO10_TESTNET_REPORT_MISSING" }
        $t = Get-Content $testnetReport -Raw | ConvertFrom-Json
        if ($t.result -ne "SUCCESS") { throw "DEMO10_TESTNET_RESULT_$($t.result)" }
    }
    finally {
        Pop-Location
    }

    $s = Get-Content $newState -Raw | ConvertFrom-Json
    $w = Get-Content (Join-Path $signalDir "CURRENT_SIGNAL_WATCHLIST.json") -Raw | ConvertFrom-Json
    $prox = Get-Content $proximityPath -Raw | ConvertFrom-Json
    $nearCount = @($prox.rows | Where-Object { [int]$_.closestScore -ge 60 }).Count
    $veryNearCount = @($prox.rows | Where-Object { [int]$_.closestScore -ge 80 }).Count
    $lines = @(
        "# DEMO-10 LIVE STATUS",
        "",
        "- scheduler_local: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")",
        "- cycle_state: SUCCESS",
        "- cohort: $($w.cohortId)",
        "- mode: BINANCE_USDM_TESTNET",
        "- testnet_orders: ENABLED",
        "- production_orders: DISABLED",
        "- cadence: 1 minute",
        "- dataAvailable: $($w.dataAvailable)",
        "- evaluated: $($w.counts.evaluated)",
        "- freshSignals: $($w.counts.freshSignals)",
        "- testnetIntents: $(@($w.testnetIntents).Count)",
        "- testnet_result: $($t.result)",
        "- testnetTradableSymbols: $($t.summary.testnetTradableSymbols)",
        "- testnetUnavailableSymbols: $($t.summary.unavailableOnTestnet)",
        "- testnetOpenPositions: $($t.summary.openPositions)",
        "- testnetOpenedProtectedThisCycle: $($t.summary.openedProtected)",
        "- reconciliationHalts: $($t.summary.reconciliationHalts)",
        "- proximityNearOrBetter: $nearCount",
        "- proximityVeryNearOrTrigger: $veryNearCount",
        "- shadowOpenPositions: $($s.summary.openPositions)",
        "- shadowClosedTrades: $($s.summary.closedTrades)",
        "- shadowRealizedPnlRefSum: $($s.summary.realizedPnlPerReferenceNotionalSum)",
        "- shadowUnrealizedPnlRefSum: $($s.summary.unrealizedPnlPerReferenceNotionalSum)",
        "",
        "## 10 setup live state",
        "",
        "| Underlying | TF | Strategy | Direction | Signal state | Exec | Fresh | Age | Testnet |",
        "|---|---|---|---|---|---|---|---:|---|"
    )

    foreach($r in @($w.rows) | Sort-Object underlying){
        $tx = @($t.symbols) | Where-Object { $_.underlying -eq $r.underlying } | Select-Object -First 1
        $txResult = if ($tx) { $tx.result } else { "NO_TESTNET_ROW" }
        $lines += "| $($r.underlying) | $($r.timeframe) | $($r.strategy) | $($r.direction) | $($r.status) | $($r.executionStatus) | $($r.fresh) | $($r.signalAgeBars) | $txResult |"
    }

    $lines += @("","## TESTNET signal proximity","")
    $lines += "| Coin | TF | Price | LONG | SHORT | Closest | Testnet state |"
    $lines += "|---|---|---:|---|---|---|---|"
    foreach($px in @($prox.rows) | Sort-Object underlying){
        $tx = @($t.symbols) | Where-Object { $_.underlying -eq $px.underlying } | Select-Object -First 1
        $txResult = if ($tx) { $tx.result } else { "NO_TESTNET_ROW" }
        if ($txResult -eq "UNAVAILABLE_ON_TESTNET") { continue }
        $lp = "$($px.long.score)/100 $($px.long.class) [$($px.long.distancePct)%]"
        $sp = "$($px.short.score)/100 $($px.short.class) [$($px.short.distancePct)%]"
        $closest = "$($px.closestDirection) $($px.closestScore)/100 $($px.closestClass)"
        $lines += "| $($px.underlying) | $($px.timeframe) | $($px.currentPrice) | $lp | $sp | $closest | $txResult |"
    }

    $lines += @("","### TESTNET missing conditions","")
    $lines += "| Coin | LONG missing | SHORT missing |"
    $lines += "|---|---|---|"
    foreach($px in @($prox.rows) | Sort-Object underlying){
        $tx = @($t.symbols) | Where-Object { $_.underlying -eq $px.underlying } | Select-Object -First 1
        $txResult = if ($tx) { $tx.result } else { "NO_TESTNET_ROW" }
        if ($txResult -eq "UNAVAILABLE_ON_TESTNET") { continue }
        $lines += "| $($px.underlying) | $($px.long.missing) | $($px.short.missing) |"
    }

    $lines += @("","_Proximity is mechanical distance to strategy conditions, not probability. 0-29 UZAK; 30-59 ORTA; 60-79 YAKIN; 80-99 COK_YAKIN; 100 TETIK/WAIT_CLOSE. Orders still require a confirmed closed-candle FRESH_ENTRY._")

    $lines += @("","## Open TESTNET positions","")
    if (@($t.testnetPositions).Count -eq 0) {
        $lines += "_None._"
    } else {
        $lines += "| Underlying | Symbol | Dir | Qty | Entry | Mark | Unrealized |"
        $lines += "|---|---|---|---:|---:|---:|---:|"
        foreach($p in @($t.testnetPositions) | Sort-Object underlying){
            $lines += "| $($p.underlying) | $($p.symbol) | $($p.direction) | $($p.positionAmt) | $($p.entryPrice) | $($p.markPrice) | $($p.unrealizedProfit) |"
        }
    }

    $lines += @("","## Shadow reference positions","")
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
        shadowSummary = $s.summary
        shadowPositions = $s.positions
        proximity = $prox
        testnetResult = $t.result
        testnetSummary = $t.summary
        testnetPositions = $t.testnetPositions
        testnetSymbols = $t.symbols
    } | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText((Join-Path $RuntimeRoot "latest.json"),$latest,[Text.UTF8Encoding]::new($false))

    Add-Content $Log "$(Get-Date -Format o) SUCCESS cohort=$($w.cohortId) fresh=$($w.counts.freshSignals) testnetOpen=$($t.summary.openPositions) shadowOpen=$($s.summary.openPositions)"
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

function Install-Demo10Loop([string]$runnerPath) {
    Write-Host "== Installing Demo-10 user-level 1-minute loop =="

    $loopPath = Join-Path $RuntimeRoot "demo10-monitor-loop.ps1"
    $loopBody = @'
$ErrorActionPreference = "Continue"
$RuntimeRoot = "C:\demo10-live"
$OneCycle = Join-Path $RuntimeRoot "run-demo10-live.ps1"
$Log = Join-Path $RuntimeRoot "logs\demo10-loop.log"
$pidFile = Join-Path $RuntimeRoot "demo10-loop.pid"

New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null
[System.IO.File]::WriteAllText($pidFile,[string]$PID,[Text.UTF8Encoding]::new($false))

try {
    while ($true) {
        $started = Get-Date
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $OneCycle
        $code = $LASTEXITCODE
        Add-Content $Log "$(Get-Date -Format o) cycle_exit=$code"
        $elapsed = ((Get-Date) - $started).TotalSeconds
        $sleep = [Math]::Max(1,[int](60 - $elapsed))
        Start-Sleep -Seconds $sleep
    }
}
finally {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
'@
    [System.IO.File]::WriteAllText($loopPath,$loopBody,[Text.UTF8Encoding]::new($false))

    # User Startup folder gives reboot/login persistence without requiring Administrator
    # or Task Scheduler registration rights.
    $startup = [Environment]::GetFolderPath("Startup")
    if (!(Test-Path $startup)) { New-Item -ItemType Directory -Force $startup | Out-Null }
    $startupCmd = Join-Path $startup "Demo10LiveMonitor.cmd"
    $cmd = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loopPath`"`r`n"
    [System.IO.File]::WriteAllText($startupCmd,$cmd,[Text.UTF8Encoding]::new($false))

    # Stop an older copy owned by this user, if one exists.
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*demo10-monitor-loop.ps1*" } |
        ForEach-Object {
            try { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction Stop | Out-Null } catch {}
        }

    Remove-Item (Join-Path $RuntimeRoot "latest.json") -Force -ErrorAction SilentlyContinue

    # GitHub Runner normally kills child processes when a job ends. Remove its tracking
    # marker before starting this intentionally persistent local monitor.
    $tracking = $env:RUNNER_TRACKING_ID
    Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue
    try {
        $proc = Start-Process powershell.exe -ArgumentList @(
            "-NoProfile",
            "-WindowStyle","Hidden",
            "-ExecutionPolicy","Bypass",
            "-File",$loopPath
        ) -WindowStyle Hidden -PassThru
    }
    finally {
        if ($tracking) { $env:RUNNER_TRACKING_ID = $tracking }
    }

    Start-Sleep -Seconds 2
    if ($proc.HasExited) { throw "Demo-10 loop exited immediately with code $($proc.ExitCode)" }

    Write-Host "DEMO10_LOOP_STARTED pid=$($proc.Id)"
    Write-Host "DEMO10_STARTUP=$startupCmd"
    return $loopPath
}

Stop-QRuntime
Copy-RuntimeSource
$runnerPath = Install-Demo10RunnerScript
$loopPath = Install-Demo10Loop $runnerPath

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

$loopProc = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*demo10-monitor-loop.ps1*" } |
    Select-Object -First 1
if (!$loopProc) { throw "Demo-10 persistent loop process not found after first cycle" }

Write-Host "DEMO10_LOOP_OK pid=$($loopProc.ProcessId)"
Write-Host "DEMO10_STARTUP_OK $([Environment]::GetFolderPath('Startup'))\Demo10LiveMonitor.cmd"
Get-Content $latest

Write-Host "DEMO10_LOCAL_LIVE_READY"
