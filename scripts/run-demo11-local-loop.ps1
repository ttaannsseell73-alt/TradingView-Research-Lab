param()
$ErrorActionPreference = "Continue"
$Root = "C:\Users\TANSEL\Desktop\Demo11-Shadow"
$Runner = Join-Path $Root "run-demo11-local-shadow.ps1"
$LoopLog = Join-Path $Root "artifacts\demo11\local-loop.log"
New-Item -ItemType Directory -Force (Split-Path $LoopLog -Parent) | Out-Null
$mutex = New-Object System.Threading.Mutex($false, "Global\Demo11ReadOnlyShadowLoop")
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (!$locked) { Add-Content $LoopLog "$(Get-Date -Format o) LOOP_ALREADY_RUNNING"; exit 0 }
  Add-Content $LoopLog "$(Get-Date -Format o) LOOP_START pid=$PID"
  while ($true) {
    try {
      $p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$Runner) -Wait -PassThru -NoNewWindow
      Add-Content $LoopLog "$(Get-Date -Format o) CYCLE_EXIT=$($p.ExitCode)"
    } catch {
      Add-Content $LoopLog "$(Get-Date -Format o) CYCLE_ERROR=$($_.Exception.Message)"
    }
    Start-Sleep -Seconds 60
  }
} finally {
  if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
