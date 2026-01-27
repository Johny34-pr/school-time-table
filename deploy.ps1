# ============================================
# Iskolai Órarend - Deployment Script
# Cél: root@10.204.131.131:/opt/school-timetable
# ============================================

$ErrorActionPreference = "Stop"

# Konfiguráció
$SSH_HOST = "root@10.204.131.131"
$REMOTE_PATH = "/opt/school-timetable"
$LOCAL_PATH = $PSScriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Iskolai Órarend - Telepítés" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Fájlok listája (node_modules és adatbázis nélkül)
$filesToCopy = @(
    "index.html",
    "styles.css",
    "script.js",
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
    "README.md"
)

$serverFiles = @(
    "server/server.js",
    "server/database.js",
    "server/package.json"
)

# 2. Távoli mappa létrehozása
Write-Host "[1/5] Távoli mappák létrehozása..." -ForegroundColor Yellow
ssh $SSH_HOST "mkdir -p $REMOTE_PATH/server"

# 3. Fájlok feltöltése
Write-Host "[2/5] Fájlok feltöltése..." -ForegroundColor Yellow

foreach ($file in $filesToCopy) {
    $localFile = Join-Path $LOCAL_PATH $file
    if (Test-Path $localFile) {
        Write-Host "  -> $file" -ForegroundColor Gray
        scp $localFile "${SSH_HOST}:${REMOTE_PATH}/$file"
    }
}

foreach ($file in $serverFiles) {
    $localFile = Join-Path $LOCAL_PATH $file
    if (Test-Path $localFile) {
        Write-Host "  -> $file" -ForegroundColor Gray
        scp $localFile "${SSH_HOST}:${REMOTE_PATH}/$file"
    }
}

# 4. Régi konténer leállítása (ha fut)
Write-Host "[3/5] Régi konténer leállítása..." -ForegroundColor Yellow
ssh $SSH_HOST "cd $REMOTE_PATH && docker compose down 2>/dev/null || true"

# 5. Docker image építése és indítása
Write-Host "[4/5] Docker image építése és konténer indítása..." -ForegroundColor Yellow
ssh $SSH_HOST "cd $REMOTE_PATH && docker compose up -d --build"

# 6. Státusz ellenőrzése
Write-Host "[5/5] Státusz ellenőrzése..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
ssh $SSH_HOST "docker ps | grep school-timetable"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Telepítés kész!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Az alkalmazás elérhető:" -ForegroundColor Cyan
Write-Host "  http://10.204.131.131:3001" -ForegroundColor White
Write-Host ""
Write-Host "Hasznos parancsok:" -ForegroundColor Cyan
Write-Host "  Logok:    ssh $SSH_HOST 'docker logs -f school-timetable'" -ForegroundColor Gray
Write-Host "  Restart:  ssh $SSH_HOST 'cd $REMOTE_PATH && docker-compose restart'" -ForegroundColor Gray
Write-Host "  Stop:     ssh $SSH_HOST 'cd $REMOTE_PATH && docker-compose down'" -ForegroundColor Gray
Write-Host ""
