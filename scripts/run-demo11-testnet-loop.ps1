param()
$ErrorActionPreference = "Continue"
$Root = "C:\Users\TANSEL\Desktop\Demo11-Shadow"
$Cycle = Join-Path $Root "run-demo11-testnet-cycle.ps1"
$Log = Join-Path $Root "artifacts\demo11\demo11-testnet-loop.log"
$mutex = New-Object System.Threading.Mutex($false,"Global\Demo11TestnetLoop")
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (!$locked) { exit 0 }
  Add-Content $Log "$(Get-Date -Format o) LOOP_START pid=$PID"
  while ($true) {
    try {
      $p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$Cycle) -Wait -PassThru -NoNewWindow
      Add-Content $Log "$(Get-Date -Format o) CYCLE_EXIT=$($p.ExitCode)"
    } catch {
      Add-Content $Log "$(Get-Date -Format o) CYCLE_ERROR=$($_.Exception.Message)"
    }
    Start-Sleep -Seconds 60
  }
} finally {
  if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
