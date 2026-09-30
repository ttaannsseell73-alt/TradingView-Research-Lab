param()
$ErrorActionPreference = "Stop"
$Root = "C:\Users\TANSEL\Desktop\Demo11-Shadow"
$Art = Join-Path $Root "artifacts\demo11"
$Log = Join-Path $Art "local-shadow.log"
$Status = Join-Path $Art "DEMO11_LOCAL_STATUS.json"
$env:PYTHONHOME = $null
$env:PYTHONPATH = $null
$PythonExe = $null
$PythonPrefix = @()

function Resolve-Demo11Python {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    & $py.Source -3.12 -E -c "import sys; assert sys.version_info[:2] >= (3, 12); print(sys.executable)" *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ Exe = $py.Source; Prefix = @("-3.12","-E") }
    }
  }

  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python) {
    & $python.Source -E -c "import sys; assert sys.version_info[:2] >= (3, 10); print(sys.executable)" *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ Exe = $python.Source; Prefix = @("-E") }
    }
  }

  $legacy = "C:\actions-runner-datahub\.venv-datahub\Scripts\python.exe"
  if (Test-Path $legacy) {
    & $legacy -E -c "import sys; print(sys.executable)" *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ Exe = $legacy; Prefix = @("-E") }
    }
  }

  throw "NO_WORKING_PYTHON_RUNTIME"
}

$ResolvedPython = Resolve-Demo11Python
$PythonExe = $ResolvedPython.Exe
$PythonPrefix = @($ResolvedPython.Prefix)

function Invoke-Demo11Python([string[]]$ScriptArgs) {
  & $PythonExe @PythonPrefix @ScriptArgs
}
New-Item -ItemType Directory -Force $Art | Out-Null
$mutex = New-Object System.Threading.Mutex($false, "Global\Demo11ReadOnlyShadow")
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (!$locked) { Add-Content $Log "$(Get-Date -Format o) SKIP_OVERLAP"; exit 0 }
  Set-Location $Root
  $started = Get-Date

  Invoke-Demo11Python @("scripts\fetch-live-market-snapshot.py","research\demo_cohort_10.json","artifacts\demo11\live-market.json") *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "MARKET_SNAPSHOT_EXIT_$LASTEXITCODE" }

  node "scripts\build-execution-watchlist.mjs" "research\demo_cohort_10.json" "artifacts\demo11\live-market.json" "research\tradability_policy.json" "artifacts\demo11\execution" *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "EXECUTION_WATCHLIST_EXIT_$LASTEXITCODE" }

  Invoke-Demo11Python @("scripts\fetch-current-candles.py","research\demo_cohort_10.json","artifacts\demo11\execution\EXECUTION_WATCHLIST.json","artifacts\demo11\candles") *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "CANDLES_EXIT_$LASTEXITCODE" }

  node "scripts\run-demo11-persistent-shadow.mjs" "research\demo_cohort_10.json" "artifacts\demo11\execution\EXECUTION_WATCHLIST.json" "artifacts\demo11\candles" "artifacts\demo11\persistent-shadow" "research\tradability_policy_v2.json" "artifacts\demo11\persistent-shadow\DEMO11_EVIDENCE_STATE.json" *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "PERSISTENT_SHADOW_EXIT_$LASTEXITCODE" }

  $state = Get-Content (Join-Path $Art "persistent-shadow\DEMO11_EVIDENCE_STATE.json") -Raw | ConvertFrom-Json
  $cycle = Get-Content (Join-Path $Art "persistent-shadow\DEMO11_PERSISTENT_CYCLE.json") -Raw | ConvertFrom-Json
  [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    mode = "READ_ONLY_SHADOW"
    exchangeWrites = $false
    task = "Demo11ReadOnlyShadow"
    durationSeconds = [math]::Round(((Get-Date)-$started).TotalSeconds,2)
    cycles = $state.cycles
    latestCycle = $cycle.summary
    totals = $state.totals
    decisionCoverage = @($state.decisionCoverage)
    recentEvents = @($state.recentEvents | Select-Object -Last 10)
  } | ConvertTo-Json -Depth 12 | Set-Content $Status -Encoding UTF8
  Add-Content $Log "$(Get-Date -Format o) SUCCESS cycles=$($state.cycles) transitions=$($state.totals.transitions)"
  exit 0
}
catch {
  $err = $_.Exception.Message
  Add-Content $Log "$(Get-Date -Format o) ERROR=$err"
  [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    mode = "READ_ONLY_SHADOW"
    exchangeWrites = $false
    task = "Demo11ReadOnlyShadow"
    error = $err
  } | ConvertTo-Json -Depth 6 | Set-Content $Status -Encoding UTF8
  exit 1
}
finally {
  if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
