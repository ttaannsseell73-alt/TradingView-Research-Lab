$ErrorActionPreference = "Stop"

$Repo = "ttaannsseell73-alt/TradingView-Research-Lab"
$RepoUrl = "https://github.com/$Repo"
$RunnerRoot = "C:\actions-runner-datahub"
$PreferredDataRoot = "D:\Futures-Research-Data"
$FallbackDataRoot = "C:\Futures-Research-Data"
$DataRoot = if (Test-Path "D:\") { $PreferredDataRoot } else { $FallbackDataRoot }
$RunnerName = "TANSEL-DATAHUB"

Write-Host "== DataHub local runner setup =="

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required. Install/login to gh, then run this script again."
}

gh auth status | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run: gh auth login"
}

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null

# Keep the GitHub Actions local workflow aligned with the actual machine path.
gh variable set DATAHUB_LOCAL_ROOT --body ($DataRoot -replace '\\','/') --repo $Repo | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not set DATAHUB_LOCAL_ROOT repository variable."
}
Write-Host "Configured DATAHUB_LOCAL_ROOT=$DataRoot"

$runnerConfig = Join-Path $RunnerRoot ".runner"
if (Test-Path $runnerConfig) {
    Write-Host "Runner is already configured at $RunnerRoot; no destructive reconfiguration performed."
    Write-Host "DataHub root: $DataRoot"
    exit 0
}

$release = gh api repos/actions/runner/releases/latest | ConvertFrom-Json
$asset = $release.assets |
    Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } |
    Select-Object -First 1

if (-not $asset) {
    throw "Could not find the latest Windows x64 GitHub Actions runner archive."
}

$zip = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip

Write-Host "Extracting runner..."
Expand-Archive -Path $zip -DestinationPath $RunnerRoot -Force
Remove-Item $zip -Force

$token = gh api --method POST "repos/$Repo/actions/runners/registration-token" --jq ".token"
if (-not $token) {
    throw "Could not obtain a short-lived runner registration token."
}

Push-Location $RunnerRoot
try {
    $configArgs = @(
        "--url", $RepoUrl,
        "--token", $token,
        "--name", $RunnerName,
        "--labels", "datahub-local",
        "--work", "_work",
        "--unattended",
        "--replace"
    )
    & .\config.cmd @configArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Runner configuration failed."
    }

    if (Test-Path ".\svc.cmd") {
        try {
            & .\svc.cmd install
            & .\svc.cmd start
            Write-Host "Runner installed as a Windows service."
        }
        catch {
            Write-Warning "Service install/start needs an elevated PowerShell. Runner is configured."
            Write-Host "Until service install is done, start it manually with:"
            Write-Host "  cd $RunnerRoot"
            Write-Host "  .\run.cmd"
        }
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "READY"
Write-Host "Runner: $RunnerName"
Write-Host "Label: datahub-local"
Write-Host "DataHub cache: $DataRoot"
Write-Host "Repo: $RepoUrl"
