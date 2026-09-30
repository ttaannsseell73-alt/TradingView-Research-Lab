param(
  [string]$Root = "C:\Users\TANSEL\Desktop\Demo11-Shadow",
  [string]$BotRoot = "C:\Users\TANSEL\Desktop\binance-bot"
)
$ErrorActionPreference = "Stop"
$SourceRoot = $env:GITHUB_WORKSPACE
if (!(Test-Path $SourceRoot)) { throw "GITHUB_WORKSPACE_MISSING" }
if (!(Test-Path (Join-Path $BotRoot ".git"))) { throw "LOCAL_BINANCE_BOT_MISSING" }

# Retire the old Demo-10 automatic writer. Exchange positions are NOT touched here.
$oldStartup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Demo10LiveMonitor.cmd"
if (Test-Path $oldStartup) { Remove-Item $oldStartup -Force }
$old = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and ($_.CommandLine -match 'demo10-monitor-loop\.ps1' -or $_.CommandLine -match 'run-demo10-live\.ps1')
}
foreach($p in @($old)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

# Install canonical Q execution components plus Demo-11 adapter into local bot.
New-Item -ItemType Directory -Force (Join-Path $BotRoot "src\live"),(Join-Path $BotRoot "src\tools") | Out-Null
Copy-Item (Join-Path $SourceRoot "livebot-patch\src\live\*.ts") (Join-Path $BotRoot "src\live\") -Force
Copy-Item (Join-Path $SourceRoot "livebot-patch\src\tools\runDemo11TestnetOnce.ts") (Join-Path $BotRoot "src\tools\runDemo11TestnetOnce.ts") -Force

$qEnv = Join-Path $BotRoot ".q-forward.local.env"
$demoEnv = Join-Path $BotRoot ".demo11-testnet.local.env"
if (!(Test-Path $qEnv)) { throw "BINANCE_TESTNET_CREDENTIAL_SOURCE_MISSING" }
Copy-Item $qEnv $demoEnv -Force

Push-Location $BotRoot
try {
  node -e "const fs=require('fs');let raw=fs.readFileSync('package.json','utf8');raw=raw.replace(/(?:\\n)+\s*$/,'').trimEnd();const p=JSON.parse(raw);p.scripts=p.scripts||{};p.scripts['demo11:testnet-once']='tsx src/tools/runDemo11TestnetOnce.ts';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
  if ($LASTEXITCODE -ne 0) { throw "PACKAGE_SCRIPT_UPDATE_FAILED" }
  if (!(Test-Path ".git\info\exclude")) { New-Item -ItemType File -Force ".git\info\exclude" | Out-Null }
  $exclude = Get-Content ".git\info\exclude" -ErrorAction SilentlyContinue
  if ($exclude -notcontains ".demo11-testnet.local.env") { Add-Content ".git\info\exclude" ".demo11-testnet.local.env" }
  if ($exclude -notcontains "artifacts/") { Add-Content ".git\info\exclude" "artifacts/" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "BINANCE_BOT_BUILD_FAILED" }
  if (Test-Path "src\tests\live\CanonicalSafety.test.ts") {
    npx vitest run src/tests/live/CanonicalSafety.test.ts
    if ($LASTEXITCODE -ne 0) { throw "CANONICAL_SAFETY_TESTS_FAILED" }
  }
} finally { Pop-Location }

# Dedicated Demo-11 TESTNET journal. Never reuse Demo-10/Q state.
$pgContainer = "canonical-demo11-testnet-pg"
$pgVolume = "canonical-demo11-testnet-pg-data"
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  $desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (!(Test-Path $desktop)) { throw "DOCKER_DESKTOP_MISSING" }
  $tracking = $env:RUNNER_TRACKING_ID
  Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue
  Start-Process $desktop
  if ($tracking) { $env:RUNNER_TRACKING_ID = $tracking }
  $ready = $false
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Seconds 2
    cmd /c "docker info >nul 2>&1"
    if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  if(!$ready){throw "DOCKER_NOT_READY"}
}
$exists = docker ps -a --filter "name=^/$pgContainer$" --format "{{.Names}}"
if (!$exists) {
  docker volume create $pgVolume | Out-Null
  docker run -d --restart unless-stopped --name $pgContainer -e POSTGRES_PASSWORD=demo11_testnet_pw -e POSTGRES_DB=demo11_testnet -p "127.0.0.1:55442:5432" -v "$($pgVolume):/var/lib/postgresql/data" postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "DEMO11_POSTGRES_CREATE_FAILED" }
} else {
  $running = docker ps --filter "name=^/$pgContainer$" --format "{{.Names}}"
  if (!$running) { docker start $pgContainer | Out-Null }
}
$ready = $false
for($i=0;$i -lt 30;$i++){
  docker exec $pgContainer pg_isready -U postgres -d demo11_testnet 2>$null | Out-Null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Seconds 1
}
if(!$ready){throw "DEMO11_POSTGRES_NOT_READY"}

# Persist exact Node/npm paths for the detached local loop.
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
[ordered]@{
  nodeExe=$nodeExe
  npmCmd=$npmCmd
  createdAt=(Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content (Join-Path $Root "testnet-runtime.json") -Encoding UTF8

$cycle = Join-Path $Root "run-demo11-testnet-cycle.ps1"
$loop = Join-Path $Root "run-demo11-testnet-loop.ps1"
Copy-Item (Join-Path $SourceRoot "scripts\run-demo11-testnet-cycle.ps1") $cycle -Force
Copy-Item (Join-Path $SourceRoot "scripts\run-demo11-testnet-loop.ps1") $loop -Force
# Ensure the bridge used by the detached cycle is exactly this branch version.
Copy-Item (Join-Path $SourceRoot "scripts\build-demo11-testnet-bridge.mjs") (Join-Path $Root "scripts\build-demo11-testnet-bridge.mjs") -Force

$statusPath = Join-Path $Root "artifacts\demo11\DEMO11_TESTNET_STATUS.json"
$oldLoop = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "run-demo11-testnet-loop\.ps1" }
foreach($p in @($oldLoop)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
if (Test-Path $statusPath) { Remove-Item $statusPath -Force }

# One full TESTNET preflight. This can place TESTNET orders only when a current canonical ALLOW intent exists.
$pre = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$cycle) -Wait -PassThru -NoNewWindow
if ($pre.ExitCode -ne 0) {
  if (Test-Path $statusPath) {
    $bad = Get-Content $statusPath -Raw | ConvertFrom-Json
    throw "DEMO11_TESTNET_PREFLIGHT_FAILED_$($bad.error)"
  }
  throw "DEMO11_TESTNET_PREFLIGHT_EXIT_$($pre.ExitCode)"
}
if (!(Test-Path $statusPath)) { throw "DEMO11_TESTNET_STATUS_MISSING" }
$first = Get-Content $statusPath -Raw | ConvertFrom-Json
if ($first.state -notin @("RUNNING","COOLDOWN") -or $first.productionOrders -ne $false) { throw "DEMO11_TESTNET_PREFLIGHT_CONTRACT_FAILED" }
$firstCycles = [int]$first.cycles

# Persistent non-admin loop and Startup relaunch.
$startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Demo11TestnetMonitor.cmd"
$cmd = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loop`"`r`n"
[System.IO.File]::WriteAllText($startup,$cmd,(New-Object System.Text.UTF8Encoding($false)))
$tracking = $env:RUNNER_TRACKING_ID
Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue
try {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$loop) -WindowStyle Hidden
} finally {
  if ($tracking) { $env:RUNNER_TRACKING_ID = $tracking }
}

$deadline=(Get-Date).AddSeconds(180)
$advanced=$false
do {
  Start-Sleep -Seconds 3
  if(Test-Path $statusPath){
    $s=Get-Content $statusPath -Raw | ConvertFrom-Json
    if($s.state -eq "FAIL"){throw "DEMO11_TESTNET_LOOP_FAILED_$($s.error)"}
    if([int]$s.cycles -gt $firstCycles){$advanced=$true;break}
  }
} while((Get-Date)-lt $deadline)
$loops=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "run-demo11-testnet-loop\.ps1" }
if(!$advanced){throw "DEMO11_TESTNET_LOOP_NOT_ADVANCING_processes=$(@($loops).Count)"}
if(@($loops).Count -lt 1){throw "DEMO11_TESTNET_LOOP_PROCESS_MISSING"}
if(!(Test-Path $startup)){throw "DEMO11_TESTNET_STARTUP_MISSING"}
$s=Get-Content $statusPath -Raw | ConvertFrom-Json
Write-Host "DEMO11_TESTNET_ACTIVE state=$($s.state) cycles=$($s.cycles) open=$($s.testnetSummary.openPositions) freshActions=$($s.bridgeFreshActions)"
Get-Content $statusPath
