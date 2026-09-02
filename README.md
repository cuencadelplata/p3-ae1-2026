#p3-ae1-2026_MODULO02.SPECS.1:3:5 
Paradigmas 3 AE1 2026

Para correr la aplicación deben estar ejecutandose lo 3 contenedores
    (DB)       -postgres                    puerto: 5433:5432
    (BACKEND)  -p3-ae1-2026-1-api           puerto: 5173:80
    (FRONTEND) -p3-ae1-2026-1-client        puerto: 3000

Tests:
    Antes de ejecutar los test con playwright se debe ejecutar el comando
    
    npx playwright install chromium

