param(
    [ValidateSet('smoke', 'load', 'stress', 'spike')]
    [string]$Scenario = 'smoke',

    [string]$TestFile = 'tests/showtime-get.test.js',

    [switch]$Dashboard
)

$k6Version = "v1.0.0"
$k6Dir = "$PSScriptRoot\tools\k6-$k6Version-windows-amd64"
$k6Path = "$k6Dir\k6.exe"

if (-not (Test-Path $k6Path)) {
    Write-Host "k6 not found, downloading $k6Version..." -ForegroundColor Yellow
    $url = "https://github.com/grafana/k6/releases/download/$k6Version/k6-$k6Version-windows-amd64.zip"
    $zip = "$PSScriptRoot\tools\k6.zip"
    New-Item -ItemType Directory -Force -Path "$PSScriptRoot\tools" | Out-Null
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath "$PSScriptRoot\tools" -Force
        Remove-Item $zip
        Write-Host "k6 downloaded successfully." -ForegroundColor Green
    } catch {
        Write-Error "Failed to download k6: $_"
        exit 1
    }
}

if (-not (Test-Path $k6Path)) {
    Write-Error "k6 not found at: $k6Path"
    exit 1
}

# Tạo thư mục results nếu chưa có
$resultsDir = "$PSScriptRoot\results"
if (-not (Test-Path $resultsDir)) {
    New-Item -ItemType Directory -Path $resultsDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = "$resultsDir\${Scenario}_${timestamp}.json"

# Build output arguments
$outputArgs = @("--out", "json=$outputFile")

if ($Dashboard) {
    $influxdbUrl = "http://localhost:8086/k6"
    $outputArgs += @("--out", "influxdb=$influxdbUrl")
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  k6 Performance Test Runner" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Scenario : $Scenario" -ForegroundColor Yellow
Write-Host "  Test     : $TestFile" -ForegroundColor Yellow
Write-Host "  Output   : $outputFile" -ForegroundColor Yellow
if ($Dashboard) {
    Write-Host "  Dashboard: http://localhost:3000/d/k6-perf-dashboard" -ForegroundColor Magenta
}
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

& $k6Path run --env SCENARIO=$Scenario @outputArgs $TestFile
