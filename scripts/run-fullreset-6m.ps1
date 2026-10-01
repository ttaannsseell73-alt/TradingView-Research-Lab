$ErrorActionPreference = "Continue"
$repo = "C:\Users\TANSEL\Desktop\NightResearch-20261001"
$root = Join-Path $repo "research\full-reset-20261001"
$cache = Join-Path $root "cache-6m"
$data = "C:\Users\TANSEL\Desktop\SCALPING_LAB\freqtrade\user_data\data\binance\futures"
$python = "C:\actions-runner-datahub\.venv-datahub\Scripts\python.exe"

$env:FREQTRADE_FUTURES_ROOT = $data
$env:DATAHUB_PYTHON = $python
$env:RESEARCH_CSV_DIR = $cache
$env:LOCAL_PARALLEL_SHARDS = "6"
$env:LOCAL_DATA_MODE = "strict"

$families = @(
  @{Name="algo9"; Plan="plan-algo9-6m.json"},
  @{Name="sr35"; Plan="plan-sr35-6m.json"},
  @{Name="sweep20"; Plan="plan-sweep20-6m.json"},
  @{Name="visual28"; Plan="plan-visual28-6m.json"},
  @{Name="fib9"; Plan="plan-fib9-6m.json"}
)
$state = [ordered]@{
  runId = "full-reset-20261001"
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  families = @()
}
Set-Location $repo
foreach ($f in $families) {
  $name = $f.Name
  $plan = Join-Path $root $f.Plan
  $out = Join-Path $root ("out-" + $name)
  $log = Join-Path $root ("run-" + $name + ".log")
  New-Item -ItemType Directory -Force $out | Out-Null
  $env:RESEARCH_OUT_DIR = $out
  $started = (Get-Date).ToUniversalTime().ToString("o")
  Write-Host "START $name $started"
  & node scripts\run-datahub-plan-parallel-local.mjs $plan *> $log
  $code = $LASTEXITCODE
  $summaryCode = $null
  if ($code -eq 0) {
    & node scripts\summarize-fullreset-family.mjs $out $name >> $log 2>&1
    $summaryCode = $LASTEXITCODE
  }
  $entry = [ordered]@{
    family = $name
    startedAt = $started
    finishedAt = (Get-Date).ToUniversalTime().ToString("o")
    runnerExit = $code
    summaryExit = $summaryCode
    output = $out
    log = $log
  }
  $state.families += [pscustomobject]$entry
  $state.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $state | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root "RUN_STATE.json") -Encoding utf8
  Write-Host "DONE $name runner=$code summary=$summaryCode"
}
$state.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$state | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root "RUN_STATE.json") -Encoding utf8
& node scripts\merge-fullreset-6m.mjs $root *> (Join-Path $root "merge-6m.log")
& $python scripts\apply-fullreset-health.py *> (Join-Path $root "health-gate.log")
Write-Host "FULLRESET_6M_DONE"
