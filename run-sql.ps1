param(
    [ValidateSet('smoke', 'load', 'stress')]
    [string]$Scenario = 'smoke',

    [string]$TestFile = 'tests/sql-query.test.js',

    # Connection string, vd: "sqlserver://sa:pass@localhost:1433?database=mydb"
    # Neu bo trong, k6 doc tu bien moi truong DB_DSN trong file .env
    [string]$DSN = '',

    [switch]$Dashboard
)

$xk6Path = "$PSScriptRoot\tools\k6-xk6-windows-amd64\k6.exe"

if (-not (Test-Path $xk6Path)) {
    Write-Host "Chua co xk6 binary. Chay setup truoc:" -ForegroundColor Red
    Write-Host "  .\setup-xk6.ps1" -ForegroundColor Yellow
    exit 1
}

# Doc file .env neu co
$envFile = "$PSScriptRoot\.env"
if (Test-Path $envFile) {
    Write-Host "Loading .env ..." -ForegroundColor DarkGray
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key   = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

# Override DSN neu truyen vao qua param
if ($DSN -ne '') {
    [System.Environment]::SetEnvironmentVariable('DB_DSN', $DSN, 'Process')
}

if (-not $env:DB_DSN) {
    Write-Host ""
    Write-Host "Thieu DB_DSN. Them vao file .env hoac truyen qua -DSN:" -ForegroundColor Red
    Write-Host '  DB_DSN=sqlserver://sa:password@localhost:1433?database=mydb' -ForegroundColor Yellow
    Write-Host '  DB_DSN=root:password@tcp(localhost:3306)/mydb' -ForegroundColor Yellow
    Write-Host '  DB_DSN=postgres://user:pass@localhost:5432/mydb' -ForegroundColor Yellow
    exit 1
}

$resultsDir = "$PSScriptRoot\results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir | Out-Null }

$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = "$resultsDir\sql_${Scenario}_${timestamp}.json"

$outputArgs = @("--out", "json=$outputFile")
if ($Dashboard) {
    $outputArgs += @("--out", "influxdb=http://localhost:8086/k6")
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  k6 SQL Performance Test Runner (xk6)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Scenario : $Scenario" -ForegroundColor Yellow
Write-Host "  Test     : $TestFile" -ForegroundColor Yellow
Write-Host "  DSN      : $($env:DB_DSN -replace ':([^:@]+)@', ':***@')" -ForegroundColor Yellow
Write-Host "  Output   : $outputFile" -ForegroundColor Yellow
if ($Dashboard) {
    Write-Host "  Dashboard: http://localhost:3000/d/k6-perf-dashboard" -ForegroundColor Magenta
}
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

& $xk6Path run --env SCENARIO=$Scenario @outputArgs $TestFile
