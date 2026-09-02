# =====================================================
# release.ps1  -  Script de versionado con Docker
# Uso: .\release.ps1 -Version "1.0"
# =====================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [string]$ImageName = "p3-ae1/m5-dispatch-service"
)

$tag = "v$Version"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Releasing $ImageName : $tag" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar que no haya cambios sin commitear
$status = git status --porcelain
if ($status) {
    Write-Host "[ERROR] Hay cambios sin commitear. Hace commit antes de hacer release." -ForegroundColor Red
    exit 1
}

# 2. Crear el Git tag
Write-Host "[1/4] Creando Git tag $tag ..." -ForegroundColor Yellow
git tag -a $tag -m "Release $tag"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El tag $tag ya existe o hubo un error." -ForegroundColor Red
    exit 1
}

# 3. Buildear la imagen Docker con el tag de version
Write-Host "[2/4] Buildeando imagen Docker $ImageName`:$tag ..." -ForegroundColor Yellow
docker build -t "${ImageName}:${tag}" -t "${ImageName}:latest" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Fallo el build de Docker." -ForegroundColor Red
    exit 1
}

# 4. Pushear el Git tag al remoto
Write-Host "[3/4] Pusheando Git tag al remoto..." -ForegroundColor Yellow
git push origin $tag

# 5. Guardar la imagen como archivo .tar para entrega
Write-Host "[4/4] Exportando imagen como releases/$tag.tar ..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "releases" | Out-Null
docker save "${ImageName}:${tag}" -o "releases/$tag.tar"

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Release $tag completado!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Archivos generados:" -ForegroundColor White
Write-Host "  - Imagen Docker : ${ImageName}:${tag}" -ForegroundColor White
Write-Host "  - Archivo tar   : releases/$tag.tar" -ForegroundColor White
Write-Host ""
Write-Host "Para que otro integrante levante el servicio:" -ForegroundColor White
Write-Host "  docker load -i releases/$tag.tar" -ForegroundColor White
Write-Host "  docker compose up" -ForegroundColor White
