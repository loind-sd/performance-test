<#
.SYNOPSIS
    Setup Grafana: tự động thêm InfluxDB datasource và import k6 dashboard.

.DESCRIPTION
    Script này sử dụng Grafana HTTP API để:
    1. Thêm InfluxDB datasource (kết nối tới k6 database)
    2. Import k6 performance dashboard

.PARAMETER GrafanaUrl
    URL của Grafana instance (mặc định: http://localhost:3000)

.PARAMETER GrafanaUser
    Username đăng nhập Grafana (mặc định: admin)

.PARAMETER GrafanaPassword
    Password đăng nhập Grafana (mặc định: admin)

.EXAMPLE
    .\setup-grafana.ps1
    .\setup-grafana.ps1 -GrafanaUrl "http://localhost:3000" -GrafanaUser admin -GrafanaPassword mypassword
#>

param(
    [string]$GrafanaUrl = "http://localhost:3000",
    [string]$GrafanaUser = "admin",
    [string]$GrafanaPassword = "admin"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Grafana Setup for k6 Performance Test" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --- Auth Header ---
$pair = "${GrafanaUser}:${GrafanaPassword}"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [System.Convert]::ToBase64String($bytes)
$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Basic $base64"
}

# --- Step 1: Check Grafana is reachable ---
Write-Host "[1/3] Checking Grafana connection..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$GrafanaUrl/api/health" -Method Get -TimeoutSec 5
    Write-Host "  ✅ Grafana is running (version: $($health.version))" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Cannot connect to Grafana at $GrafanaUrl" -ForegroundColor Red
    Write-Host "  Make sure Grafana is running on port 3000" -ForegroundColor Red
    exit 1
}

# --- Step 2: Add InfluxDB Datasource ---
Write-Host "[2/3] Configuring InfluxDB datasource..." -ForegroundColor Yellow

# Dùng host.docker.internal vì Grafana chạy trong Docker, InfluxDB expose port 8086 trên host
$datasourceBody = @{
    name      = "k6-influxdb"
    type      = "influxdb"
    access    = "proxy"
    url       = "http://host.docker.internal:8086"
    database  = "k6"
    uid       = "k6-influxdb"
    isDefault = $false
    jsonData  = @{
        httpMode = "GET"
    }
} | ConvertTo-Json -Depth 5

# Check if datasource already exists
try {
    $existing = Invoke-RestMethod -Uri "$GrafanaUrl/api/datasources/uid/k6-influxdb" -Headers $headers -Method Get
    Write-Host "  ⚠️  Datasource 'k6-influxdb' already exists, updating..." -ForegroundColor Yellow
    
    # Update existing datasource
    $updateBody = @{
        name      = "k6-influxdb"
        type      = "influxdb"
        access    = "proxy"
        url       = "http://host.docker.internal:8086"
        database  = "k6"
        uid       = "k6-influxdb"
        isDefault = $false
        jsonData  = @{
            httpMode = "GET"
        }
    } | ConvertTo-Json -Depth 5
    
    Invoke-RestMethod -Uri "$GrafanaUrl/api/datasources/$($existing.id)" -Headers $headers -Method Put -Body $updateBody | Out-Null
    Write-Host "  ✅ Datasource updated successfully" -ForegroundColor Green
} catch {
    # Create new datasource
    try {
        Invoke-RestMethod -Uri "$GrafanaUrl/api/datasources" -Headers $headers -Method Post -Body $datasourceBody | Out-Null
        Write-Host "  ✅ Datasource 'k6-influxdb' created successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ Failed to create datasource: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# --- Step 3: Import Dashboard ---
Write-Host "[3/3] Importing k6 dashboard..." -ForegroundColor Yellow

$dashboardJsonPath = "$PSScriptRoot\grafana\dashboards\k6-performance.json"

if (-not (Test-Path $dashboardJsonPath)) {
    Write-Host "  ❌ Dashboard JSON not found at: $dashboardJsonPath" -ForegroundColor Red
    exit 1
}

$dashboardJson = Get-Content $dashboardJsonPath -Raw | ConvertFrom-Json

$importBody = @{
    dashboard = $dashboardJson
    overwrite = $true
    folderId  = 0
} | ConvertTo-Json -Depth 30

try {
    Invoke-RestMethod -Uri "$GrafanaUrl/api/dashboards/db" -Headers $headers -Method Post -Body $importBody | Out-Null
    Write-Host "  ✅ Dashboard 'k6 Performance Test Results' imported successfully" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Failed to import dashboard: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# --- Done ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  ✅ Setup complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  📊 Open Grafana:     $GrafanaUrl" -ForegroundColor Cyan
Write-Host "  📋 Dashboard:        $GrafanaUrl/d/k6-perf-dashboard" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next step: Run a performance test with -Dashboard flag:" -ForegroundColor Yellow
Write-Host "    .\run.ps1 -Dashboard" -ForegroundColor White
Write-Host "    .\run.ps1 -Scenario load -Dashboard" -ForegroundColor White
Write-Host ""
