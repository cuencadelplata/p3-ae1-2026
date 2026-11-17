# ==============================================================================
# Script de Ejecución Automatizada de Pruebas de Carga y Estrés con k6
# Módulo 5: Solicitud y Despacho - Plataforma de Movilidad Urbana
# ==============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ModuleDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [M5] INICIANDO SUITE DE PRUEBAS DE ESTRÉS CON K6" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Configurar variables de entorno para el servicio de prueba
$env:PORT = "3005"
$env:AUTH_MODE = "simulated"
$env:M4_MOCK = "true"
$env:NODE_ENV = "production"

# 2. Iniciar el servicio en segundo plano
Write-Host "[1/4] Levantando servicio Módulo 5 en puerto 3005..." -ForegroundColor Yellow
$serverProcess = Start-Process -FilePath "npx" -ArgumentList "ts-node src/index.ts" -WorkingDirectory $ModuleDir -PassThru -NoNewWindow

# 3. Esperar a que el servicio esté ONLINE (healthcheck)
$maxAttempts = 30
$attempt = 0
$healthy = $false

while (-not $healthy -and $attempt -lt $maxAttempts) {
    Start-Sleep -Seconds 1
    $attempt++
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3005/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.status -eq "UP") {
            $healthy = $true
            Write-Host " -> Servidor ONLINE y saludable (intento $attempt): $($response.service)" -ForegroundColor Green
        }
    } catch {
        Write-Host " -> Esperando disponibilidad del servicio ($attempt/$maxAttempts)..." -ForegroundColor Gray
    }
}

if (-not $healthy) {
    Write-Host "[ERROR] El servicio no respondió al healthcheck a tiempo." -ForegroundColor Red
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

try {
    # 4. Localizar ejecutable de k6
    $k6Cmd = "k6"
    if (Test-Path "C:\Program Files\k6\k6.exe") {
        $k6Cmd = "C:\Program Files\k6\k6.exe"
    }

    Write-Host "`n[2/4] Ejecutando Escenario 1: Flujo Completo de Despacho (Ramping VUs hasta 100)..." -ForegroundColor Cyan
    & $k6Cmd run "$ScriptDir\stress-ride-request-flow.js" --summary-export="$ScriptDir\summary-flow.json"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "El Escenario 1 reportó umbrales cruzados o advertencias."
    }

    Write-Host "`n[3/4] Ejecutando Escenario 2: Concurrencia y Bloqueo Distribuido (Exclusión Mutua Atómica)..." -ForegroundColor Cyan
    & $k6Cmd run "$ScriptDir\stress-concurrency-acceptance.js" --summary-export="$ScriptDir\summary-concurrency.json"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "El Escenario 2 reportó umbrales cruzados o advertencias."
    }

    Write-Host "`n[4/4] Ejecutando Escenario 3: Cancelaciones Concurrentes vs Aceptación..." -ForegroundColor Cyan
    & $k6Cmd run "$ScriptDir\stress-cancellation-race.js" --summary-export="$ScriptDir\summary-cancellation.json"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "El Escenario 3 reportó umbrales cruzados o advertencias."
    }

    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host " [M5] TODAS LAS PRUEBAS DE ESTRÉS CON K6 COMPLETADAS" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} finally {
    # 5. Apagar el proceso del servidor limpiamente
    Write-Host "Deteniendo instancia de pruebas de Módulo 5..." -ForegroundColor Gray
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
}
