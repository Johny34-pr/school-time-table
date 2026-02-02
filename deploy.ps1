# ============================================
# Iskolai Orarend - Deployment Script
# Cel: root@10.204.131.131:/opt/school-timetable
# ============================================

$ErrorActionPreference = "Stop"

# Konfiguracio
$SSH_HOST = "root@10.204.131.131"
$REMOTE_PATH = "/opt/school-timetable"
$LOCAL_PATH = $PSScriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Iskolai Orarend - Telepites" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Fajlok listaja (node_modules es adatbazis nelkul)
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

# 2. Tavoli mappa letrehozasa
Write-Host "[1/5] Tavoli mappak letrehozasa..." -ForegroundColor Yellow
ssh $SSH_HOST "mkdir -p $REMOTE_PATH/server"

# 3. Fajlok feltoltese
Write-Host "[2/5] Fajlok feltoltese..." -ForegroundColor Yellow

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

# 4. Regi kontener leallitasa (ha fut)
Write-Host "[3/5] Regi kontener leallitasa..." -ForegroundColor Yellow
ssh $SSH_HOST "cd $REMOTE_PATH; docker compose down 2>/dev/null; true"

# 5. Docker image epitese es inditasa
Write-Host "[4/5] Docker image epitese es kontener inditasa..." -ForegroundColor Yellow
ssh $SSH_HOST "cd $REMOTE_PATH; docker compose up -d --build"

# 6. Statusz ellenorzese
Write-Host "[5/5] Statusz ellenorzese..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
ssh $SSH_HOST "docker ps | grep school-timetable"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Telepites kesz!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Az alkalmazas elerheto: http://10.204.131.131:3001" -ForegroundColor Cyan
Write-Host ""
