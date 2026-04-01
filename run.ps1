param(
    [ValidateSet('smoke', 'load', 'stress', 'spike')]
    [string]$Scenario = 'smoke',

    [string]$TestFile = 'tests/showtime-get.test.js',

    [switch]$Dashboard
)

$k6Path = "$PSScriptRoot\tools\k6-v1.0.0-windows-amd64\k6.exe"

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
