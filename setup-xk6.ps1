param(
    [string]$K6Version = 'v1.0.0'
)

$xk6Dir  = "$PSScriptRoot\tools\k6-xk6-windows-amd64"
$xk6Path = "$xk6Dir\k6.exe"

if (Test-Path $xk6Path) {
    Write-Host 'xk6 binary da ton tai: ' -NoNewline -ForegroundColor Green
    Write-Host $xk6Path
    Write-Host 'Xoa file de build lai.' -ForegroundColor DarkGray
    exit 0
}

$withArgs = @(
    '--with', 'github.com/grafana/xk6-sql',
    '--with', 'github.com/grafana/xk6-sql-driver-mysql',
    '--with', 'github.com/grafana/xk6-sql-driver-postgres',
    '--with', 'github.com/grafana/xk6-sql-driver-sqlserver'
)

New-Item -ItemType Directory -Force -Path $xk6Dir | Out-Null

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '  xk6 Builder — xk6-sql'                    -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host "  K6 Version : $K6Version"                  -ForegroundColor Yellow
Write-Host '  Drivers    : mysql, postgres, sqlserver'   -ForegroundColor Yellow
Write-Host "  Output     : $xk6Path"                     -ForegroundColor Yellow
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

# ── Option 1: Go ──────────────────────────────────────────────────────────────
$goCmd = Get-Command go -ErrorAction SilentlyContinue
if ($goCmd) {
    Write-Host 'Go found. Cai dat xk6 CLI...' -ForegroundColor Green
    go install go.k6.io/xk6/cmd/xk6@latest
    if ($LASTEXITCODE -ne 0) { Write-Error 'Cai xk6 that bai'; exit 1 }

    $xk6Cmd = Get-Command xk6 -ErrorAction SilentlyContinue
    if (-not $xk6Cmd) {
        $goPath  = (go env GOPATH)
        $goBin   = $goPath + '\bin'
        $env:PATH = $env:PATH + ';' + $goBin
        $xk6Cmd  = Get-Command xk6 -ErrorAction SilentlyContinue
    }
    if (-not $xk6Cmd) {
        Write-Error 'Khong tim thay xk6 sau khi cai. Kiem tra GOPATH/bin trong PATH.'
        exit 1
    }

    Write-Host 'Build xk6...' -ForegroundColor Yellow
    & xk6 build $K6Version @withArgs --output $xk6Path
    if ($LASTEXITCODE -ne 0) { Write-Error 'Build that bai'; exit 1 }

# ── Option 2: Docker ──────────────────────────────────────────────────────────
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host 'Khong co Go. Dung Docker de cross-compile Windows binary...' -ForegroundColor Yellow

    $mountPath = $xk6Dir -replace '\\', '/'
    if ($mountPath -match '^([A-Za-z]):') {
        $mountPath = '/' + $matches[1].ToLower() + $mountPath.Substring(2)
    }

    $dockerArgs = @(
        'run', '--rm',
        '-e', 'GOOS=windows',
        '-e', 'GOARCH=amd64',
        '-v', ($mountPath + ':/output'),
        'grafana/xk6',
        'build', $K6Version
    ) + $withArgs + @('--output', '/output/k6.exe')

    docker @dockerArgs
    if ($LASTEXITCODE -ne 0) { Write-Error 'Docker build that bai'; exit 1 }

# ── Khong co Go hay Docker ────────────────────────────────────────────────────
} else {
    Write-Host ''
    Write-Host 'Khong tim thay Go hoac Docker. Can cai mot trong hai:' -ForegroundColor Red
    Write-Host '  Go     : https://go.dev/dl/'                          -ForegroundColor Yellow
    Write-Host '  Docker : https://www.docker.com/products/docker-desktop' -ForegroundColor Yellow
    exit 1
}

if (Test-Path $xk6Path) {
    Write-Host ''
    Write-Host 'Build thanh cong: ' -NoNewline -ForegroundColor Green
    Write-Host $xk6Path
    Write-Host 'Chay test SQL   : .\run-sql.ps1 -TestFile tests/sql-query.test.js' -ForegroundColor Cyan
} else {
    Write-Error 'Build hoan thanh nhung khong tim thay file output'
    exit 1
}
