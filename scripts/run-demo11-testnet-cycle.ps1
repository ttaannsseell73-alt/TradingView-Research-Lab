param()
$ErrorActionPreference = "Stop"
$Root = "C:\Users\TANSEL\Desktop\Demo11-Shadow"
$BotRoot = "C:\Users\TANSEL\Desktop\binance-bot"
$Art = Join-Path $Root "artifacts\demo11"
$Log = Join-Path $Art "demo11-testnet.log"
$Status = Join-Path $Art "DEMO11_TESTNET_STATUS.json"
$Canonical = Join-Path $Art "canonical-shadow\DEMO11_CANONICAL_SHADOW.json"
$Bridge = Join-Path $Art "testnet-bridge\DEMO11_TESTNET_SIGNAL.json"
$Evidence = Join-Path $Art "persistent-shadow\DEMO11_EVIDENCE_STATE.json"
$Cooldown = Join-Path $Art "testnet-cooldown.json"
$RuntimePath = Join-Path $Root "testnet-runtime.json"
$DemoEnv = Join-Path $BotRoot ".demo11-testnet.local.env"
$PgUrl = "postgres://postgres:demo11_testnet_pw@127.0.0.1:55442/demo11_testnet"
New-Item -ItemType Directory -Force $Art,(Split-Path $Bridge -Parent) | Out-Null

$mutex = New-Object System.Threading.Mutex($false,"Global\Demo11TestnetCycle")
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (!$locked) { exit 0 }
  if (!(Test-Path $RuntimePath)) { throw "DEMO11_TESTNET_RUNTIME_CONFIG_MISSING" }
  $rt = Get-Content $RuntimePath -Raw | ConvertFrom-Json
  $NodeExe = [string]$rt.nodeExe
  $NpmCmd = [string]$rt.npmCmd
  if (!(Test-Path $NodeExe)) { throw "DEMO11_TESTNET_NODE_MISSING" }
  if (!(Test-Path $NpmCmd)) { throw "DEMO11_TESTNET_NPM_MISSING" }
  if (!(Test-Path $Canonical)) { throw "DEMO11_CANONICAL_SHADOW_MISSING" }
  if (!(Test-Path $DemoEnv)) { throw "DEMO11_TESTNET_ENV_MISSING" }

  $canonicalDoc = Get-Content $Canonical -Raw | ConvertFrom-Json
  if ($canonicalDoc.mode -ne "READ_ONLY_SHADOW" -or $canonicalDoc.exchangeWrites -ne $false) {
    throw "DEMO11_CANONICAL_SOURCE_CONTRACT_FAILED"
  }
  if ([int]$canonicalDoc.counts.evaluated -ne 10) { throw "DEMO11_CANONICAL_EVALUATION_NOT_10" }
  $canonicalAt = [DateTimeOffset]::Parse([string]$canonicalDoc.generatedAt)
  $canonicalAgeMs = ([DateTimeOffset]::UtcNow - $canonicalAt.ToUniversalTime()).TotalMilliseconds
  if ($canonicalAgeMs -gt 120000 -or $canonicalAgeMs -lt -10000) {
    throw "DEMO11_CANONICAL_SOURCE_STALE_ageMs=$([math]::Round($canonicalAgeMs))"
  }

  $savedEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $NodeExe (Join-Path $Root "scripts\build-demo11-testnet-bridge.mjs") $Canonical $Bridge $Evidence *>> $Log
  $bridgeExit = $LASTEXITCODE
  $ErrorActionPreference = $savedEap
  if ($bridgeExit -ne 0) { throw "DEMO11_BRIDGE_EXIT_$bridgeExit" }
  if (!(Test-Path $Bridge)) { throw "DEMO11_BRIDGE_OUTPUT_MISSING" }
  $bridgeDoc = Get-Content $Bridge -Raw | ConvertFrom-Json
  if ($bridgeDoc.cohortId -ne "demo-11-canonical-v1") { throw "DEMO11_BRIDGE_COHORT_MISMATCH" }
  if ($bridgeDoc.productionOrders -ne $false) { throw "DEMO11_BRIDGE_PRODUCTION_FLAG_INVALID" }

  $prior = $null
  $priorCycles = 0
  if (Test-Path $Status) {
    try {
      $prior = Get-Content $Status -Raw | ConvertFrom-Json
      $priorCycles = [int]$prior.cycles
    } catch {}
  }

  if (Test-Path $Cooldown) {
    try {
      $cd = Get-Content $Cooldown -Raw | ConvertFrom-Json
      $cooldownUntil = [DateTimeOffset]::Parse([string]$cd.until)
      if ([DateTimeOffset]::UtcNow -lt $cooldownUntil.ToUniversalTime()) {
        $freshActions = @($bridgeDoc.rows | Where-Object { $_.fresh -eq $true }).Count
        $summary = if ($prior -and $prior.testnetSummary) { $prior.testnetSummary } else {
          [pscustomobject]@{
            openPositions=0; shadowOpenPositions=0; shadowOpenedThisCycle=0; shadowClosedThisCycle=0;
            foreignOrLegacyOpenPositions=0; openedProtected=0; reconciliationHalts=0
          }
        }
        $symbols = if ($prior -and $prior.symbolResults) { @($prior.symbolResults) } else { @() }
        $cooldownDoc = [ordered]@{
          schemaVersion=1
          updatedAt=(Get-Date).ToUniversalTime().ToString("o")
          state="COOLDOWN"
          mode="BINANCE_USDM_TESTNET"
          testnetOrders=$true
          productionOrders=$false
          cycles=$priorCycles + 1
          canonicalGeneratedAt=$canonicalDoc.generatedAt
          canonicalEvaluated=[int]$canonicalDoc.counts.evaluated
          canonicalTransitions=[int]$canonicalDoc.counts.transitions
          canonicalAllow=[int]$canonicalDoc.counts.allow
          canonicalDefer=[int]$canonicalDoc.counts.defer
          canonicalReject=[int]$canonicalDoc.counts.reject
          bridgeFreshActions=$freshActions
          bridgeCatchupActions=if ($null -ne $bridgeDoc.catchupActions) { [int]$bridgeDoc.catchupActions } else { 0 }
          testnetResult="RATE_LIMIT_COOLDOWN"
          cooldownUntil=$cooldownUntil.ToUniversalTime().ToString("o")
          cooldownReason=[string]$cd.reason
          testnetSummary=$summary
          testnetPositions=if ($prior) { $prior.testnetPositions } else { @() }
          foreignOrLegacyPositions=if ($prior) { $prior.foreignOrLegacyPositions } else { @() }
          symbolResults=$symbols
        }
        $tmp = "$Status.tmp"
        $cooldownDoc | ConvertTo-Json -Depth 12 | Set-Content $tmp -Encoding UTF8
        Move-Item $tmp $Status -Force
        return
      }
      Remove-Item $Cooldown -Force -ErrorAction SilentlyContinue
    } catch {
      Remove-Item $Cooldown -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($line in Get-Content $DemoEnv) {
    if ($line -match '^([^#=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1],$matches[2],"Process")
    }
  }
  $env:LIVEBOT_CANARY_APPROVED = "YES"
  $env:DEMO11_TESTNET_APPROVED = "YES"
  $env:BINANCE_FUTURES_URL = "https://testnet.binancefuture.com"
  $env:DEMO11_TESTNET_PG_URL = $PgUrl
  $env:DEMO11_SIGNAL_PATH = $Bridge
  $env:DEMO11_TESTNET_NOTIONAL = "100"
  $env:DEMO11_TESTNET_MAX_OPEN = "10"
  $env:DEMO11_TESTNET_MAX_GROSS = "1000"
  $env:DEMO11_TESTNET_STOP_FRACTION = "0.20"

  $rateLimited = $false
  $rateLimitReason = $null
  $rateLimitUntil = $null
  Push-Location $BotRoot
  try {
    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $execOutput = @(& $NpmCmd run demo11:testnet-once 2>&1)
    $execExit = $LASTEXITCODE
    $execOutput | Add-Content $Log
    $ErrorActionPreference = $savedEap
    if ($execExit -ne 0) {
      $execText = ($execOutput | Out-String)
      if ($execText -match 'HTTP_418' -or $execText -match 'CODE_-1003') {
        $rateLimited = $true
        $rateLimitReason = "BINANCE_HTTP_418_-1003"
        $rateLimitUntil = [DateTimeOffset]::UtcNow.AddMinutes(5)
      } elseif ($execText -match 'HTTP_429') {
        $rateLimited = $true
        $rateLimitReason = "BINANCE_HTTP_429"
        $rateLimitUntil = [DateTimeOffset]::UtcNow.AddMinutes(2)
      } else {
        throw "DEMO11_TESTNET_EXECUTOR_EXIT_$execExit"
      }
    }
    if (!$rateLimited) {
      $reportPath = Join-Path $BotRoot "artifacts\demo11-testnet-latest.json"
      if (!(Test-Path $reportPath)) { throw "DEMO11_TESTNET_REPORT_MISSING" }
      $report = Get-Content $reportPath -Raw | ConvertFrom-Json
      if ($report.result -notin @("SUCCESS","SKIP_NOT_LEADER")) { throw "DEMO11_TESTNET_RESULT_$($report.result)" }
    }
  } finally { Pop-Location }

  if ($rateLimited) {
    [ordered]@{
      until=$rateLimitUntil.ToUniversalTime().ToString("o")
      reason=$rateLimitReason
      createdAt=[DateTimeOffset]::UtcNow.ToString("o")
    } | ConvertTo-Json | Set-Content $Cooldown -Encoding UTF8

    $freshActions = @($bridgeDoc.rows | Where-Object { $_.fresh -eq $true }).Count
    $summary = if ($prior -and $prior.testnetSummary) { $prior.testnetSummary } else {
      [pscustomobject]@{
        openPositions=0; shadowOpenPositions=0; shadowOpenedThisCycle=0; shadowClosedThisCycle=0;
        foreignOrLegacyOpenPositions=0; openedProtected=0; reconciliationHalts=0
      }
    }
    $cooldownDoc = [ordered]@{
      schemaVersion=1
      updatedAt=(Get-Date).ToUniversalTime().ToString("o")
      state="COOLDOWN"
      mode="BINANCE_USDM_TESTNET"
      testnetOrders=$true
      productionOrders=$false
      cycles=$priorCycles + 1
      canonicalGeneratedAt=$canonicalDoc.generatedAt
      canonicalEvaluated=[int]$canonicalDoc.counts.evaluated
      canonicalTransitions=[int]$canonicalDoc.counts.transitions
      canonicalAllow=[int]$canonicalDoc.counts.allow
      canonicalDefer=[int]$canonicalDoc.counts.defer
      canonicalReject=[int]$canonicalDoc.counts.reject
      bridgeFreshActions=$freshActions
      bridgeCatchupActions=if ($null -ne $bridgeDoc.catchupActions) { [int]$bridgeDoc.catchupActions } else { 0 }
      testnetResult="RATE_LIMIT_COOLDOWN"
      cooldownUntil=$rateLimitUntil.ToUniversalTime().ToString("o")
      cooldownReason=$rateLimitReason
      testnetSummary=$summary
      testnetPositions=if ($prior) { $prior.testnetPositions } else { @() }
      foreignOrLegacyPositions=if ($prior) { $prior.foreignOrLegacyPositions } else { @() }
      symbolResults=if ($prior -and $prior.symbolResults) { @($prior.symbolResults) } else { @() }
    }
    $tmp = "$Status.tmp"
    $cooldownDoc | ConvertTo-Json -Depth 12 | Set-Content $tmp -Encoding UTF8
    Move-Item $tmp $Status -Force
    Add-Content $Log "$(Get-Date -Format o) COOLDOWN=$rateLimitReason UNTIL=$($rateLimitUntil.ToString('o'))"
    return
  }

  $freshActions = @($bridgeDoc.rows | Where-Object { $_.fresh -eq $true }).Count
  $statusDoc = [ordered]@{
    schemaVersion = 1
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    state = "RUNNING"
    mode = "BINANCE_USDM_TESTNET"
    testnetOrders = $true
    productionOrders = $false
    cycles = $priorCycles + 1
    canonicalGeneratedAt = $canonicalDoc.generatedAt
    canonicalEvaluated = [int]$canonicalDoc.counts.evaluated
    canonicalTransitions = [int]$canonicalDoc.counts.transitions
    canonicalAllow = [int]$canonicalDoc.counts.allow
    canonicalDefer = [int]$canonicalDoc.counts.defer
    canonicalReject = [int]$canonicalDoc.counts.reject
    bridgeFreshActions = $freshActions
    bridgeCatchupActions = if ($null -ne $bridgeDoc.catchupActions) { [int]$bridgeDoc.catchupActions } else { 0 }
    testnetResult = $report.result
    testnetSummary = $report.summary
    testnetPositions = $report.testnetPositions
    foreignOrLegacyPositions = $report.foreignOrLegacyPositions
    symbolResults = $report.symbols
  }
  $tmp = "$Status.tmp"
  $statusDoc | ConvertTo-Json -Depth 12 | Set-Content $tmp -Encoding UTF8
  Move-Item $tmp $Status -Force
} catch {
  $err = $_.Exception.Message
  $priorCycles = 0
  if (Test-Path $Status) { try { $priorCycles = [int]((Get-Content $Status -Raw | ConvertFrom-Json).cycles) } catch {} }
  [ordered]@{
    schemaVersion=1
    updatedAt=(Get-Date).ToUniversalTime().ToString("o")
    state="FAIL"
    mode="BINANCE_USDM_TESTNET"
    testnetOrders=$true
    productionOrders=$false
    cycles=$priorCycles
    error=$err
  } | ConvertTo-Json -Depth 8 | Set-Content $Status -Encoding UTF8
  try { Add-Content $Log "$(Get-Date -Format o) ERROR=$err" } catch {}
  throw
} finally {
  if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
